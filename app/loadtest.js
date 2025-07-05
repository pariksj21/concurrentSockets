import { check } from 'k6';
import ws from 'k6/ws';
import { sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';
import { Trend, Counter, Rate } from 'k6/metrics';

// Custom metrics
const connectionTimeTrend = new Trend('connection_time');
const messageLatencyTrend = new Trend('message_latency');
const wsMessagesReceived = new Counter('ws_msgs_received');
const wsMessagesSent = new Counter('ws_msgs_sent');
const wsErrors = new Counter('ws_errors');
const wsConnectionsSuccessful = new Counter('ws_connections_successful');
const wsConnectionsFailed = new Counter('ws_connections_failed');
const wsConnectionRate = new Rate('ws_connection_success_rate');

export const options = {
    scenarios: {
        // Ramp up scenario
        ramp_up: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '5s', target: 100 },
                { duration: '5s', target: 200 },
                { duration: '5s', target: 500 },
                { duration: '5s', target: 1000 },
                { duration: '5s', target: 0 },
            ],
        },
        // Stress test scenario
        stress_test: {
            executor: 'constant-vus',
            vus: 1000,
            duration: '5m',
            startTime: '10m',
        },
        // Spike test scenario
        spike_test: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 2000 },
                { duration: '1m', target: 2000 },
                { duration: '30s', target: 0 },
            ],
            startTime: '16m',
        }
    },
    thresholds: {
        // Connection performance
        'connection_time': ['p(95)<2000', 'p(99)<5000'],
        'ws_connection_success_rate': ['rate>0.95'],
        
        // Message performance
        'message_latency': ['p(95)<1000', 'p(99)<2000'],
        
        // Volume thresholds
        'ws_msgs_received': ['count>10000'],
        'ws_msgs_sent': ['count>10000'],
        
        // Error thresholds
        'ws_errors': ['count<100'],
        'ws_connections_failed': ['count<50'],
        
        // HTTP checks for health endpoint
        'http_req_duration': ['p(95)<200'],
        'http_req_failed': ['rate<0.01'],
    }
};

export default function () {
    const connectionId = randomString(8);
    // Pass connectionId as path parameter
    const url = `ws://localhost/ws/chat/${connectionId}`;
    
    const startTime = new Date().getTime();
    let msgCount = 0;
    let isConnected = false;
    let lastMessageTime = startTime;
    let connectionEstablished = false;

    const response = ws.connect(url, {
        headers: {
            'User-Agent': 'k6-load-test/1.0',
            'X-Test-Session': `session-${__VU}-${__ITER}`,
        }
    }, function (socket) {
        const connectTime = new Date().getTime() - startTime;
        connectionTimeTrend.add(connectTime);
        isConnected = true;
        connectionEstablished = true;
        wsConnectionsSuccessful.add(1);
        wsConnectionRate.add(true);

        socket.on('open', () => {
            console.log(`[VU ${__VU}] Connected: ${connectionId}`);
            
            // Send initial message - server expects any message and responds with count
            const initialMessage = `Hello from VU ${__VU} iteration ${__ITER}`;
            
            socket.send(initialMessage);
            lastMessageTime = new Date().getTime();
            wsMessagesSent.add(1);
            
            // Send periodic messages
            socket.setInterval(() => {
                if (socket.readyState === 1) { // 1 = OPEN state
                    const message = `Message ${msgCount + 1} from VU ${__VU}: ${randomString(20)}`;
                    
                    lastMessageTime = new Date().getTime();
                    socket.send(message);
                    wsMessagesSent.add(1);
                }
            }, 1000 + Math.random() * 2000); // Random interval between 1-3 seconds
        });

        socket.on('message', (data) => {
            const now = new Date().getTime();
            
            try {
                // Server sends JSON with count field
                const parsed = JSON.parse(data);
                msgCount++;
                wsMessagesReceived.add(1);
                
                // Calculate latency
                const messageLatency = now - lastMessageTime;
                messageLatencyTrend.add(messageLatency);
                
                console.log(`[VU ${__VU}] Message #${msgCount}: count=${parsed.count}`);
                
                // Validate message structure - server sends { count: number }
                check(parsed, {
                    'has count field': (obj) => obj.count !== undefined,
                    'count is number': (obj) => typeof obj.count === 'number',
                    'count is positive': (obj) => obj.count > 0,
                    'message latency acceptable': () => messageLatency < 2000,
                });
                
            } catch (error) {
                // Handle potential goodbye message or other non-JSON responses
                if (data.includes('bye')) {
                    console.log(`[VU ${__VU}] Received goodbye message: ${data}`);
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.bye && parsed.total) {
                            console.log(`[VU ${__VU}] Final message count: ${parsed.total}`);
                        }
                    } catch (e) {
                        // Ignore parse errors for goodbye messages
                    }
                } else {
                    wsErrors.add(1);
                    console.error(`[VU ${__VU}] Failed to parse message: ${error}, data: ${data}`);
                }
            }
        });

        socket.on('close', (code, reason) => {
            console.log(`[VU ${__VU}] Disconnected: ${connectionId}, code: ${code}, reason: ${reason || 'No reason'}`);
            
            // Validate close codes
            check(null, {
                'clean disconnect': () => code === 1000 || code === 1001,
                'received messages': () => msgCount > 0,
            });
        });

        socket.on('error', (e) => {
            console.error(`[VU ${__VU}] Socket error: ${connectionId}, error: ${e}`);
            wsErrors.add(1);
            wsConnectionsFailed.add(1);
            wsConnectionRate.add(false);
            
            check(null, {
                'no connection errors': () => false
            });
        });
        
        // Send a final message before closing
        socket.setTimeout(() => {
            if (socket.readyState === 1) { // 1 = OPEN state
                const finalMessage = `Final message from VU ${__VU}`;
                
                socket.send(finalMessage);
                wsMessagesSent.add(1);
                
                // Close connection gracefully
                socket.close(1000, 'Test completed');
            }
        }, 28000); // Close before k6 timeout
    });

    // Check connection response
    check(response, { 
        'status is 101': (r) => r && r.status === 101,
        'connection successful': () => connectionEstablished
    });

    if (!connectionEstablished) {
        wsConnectionsFailed.add(1);
        wsConnectionRate.add(false);
    }

    // Keep connection alive for test duration
    sleep(30);

    // Final validation
    check(null, {
        'connection was established': () => connectionEstablished,
        'received messages': () => msgCount > 0,
        'message rate acceptable': () => msgCount >= 3, // Lower expectation
        'no excessive errors': () => wsErrors.count < msgCount * 0.1, // Less than 10% error rate
    });
    
    console.log(`[VU ${__VU}] Test completed - Messages sent: ${wsMessagesSent.count}, Messages received: ${msgCount}`);
} 