import { check } from 'k6';
import ws from 'k6/ws';
import { sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';
import { Trend, Counter } from 'k6/metrics';

// Custom metrics
const connectionTimeTrend = new Trend('connection_time');
const messageLatencyTrend = new Trend('message_latency');
const wsMessagesReceived = new Counter('ws_msgs_received');
const wsErrors = new Counter('ws_errors');

export const options = {
    stages: [
        { duration: '30s', target: 5000 }, 
        { duration: '30s', target: 5000 }, 
        { duration: '10s', target: 0 },
    ],
    thresholds: {
        'connection_time': ['p(95)<1000'],      // 95% of connections within 1s
        'message_latency': ['p(95)<1000'],      // 95% of messages should be processed within 1s
        'ws_msgs_received': ['count>10000'],    // Should receive good number of messages
        'ws_errors': ['count<100']              // Less than 100 errors
    }
};

export default function () {
    const connectionId = randomString(8);
    const url = `ws://localhost:3001/ws/chat/${connectionId}`;
    
    const startTime = new Date().getTime();
    let msgCount = 0;
    let isConnected = false;
    let lastMessageTime = startTime;

    const response = ws.connect(url, {}, function (socket) {
        const connectTime = new Date().getTime() - startTime;
        connectionTimeTrend.add(connectTime);
        isConnected = true;

        socket.on('open', () => {
            console.log('Connected:', connectionId);
            
            // Send a message every 2 seconds
            socket.setInterval(() => {
                lastMessageTime = new Date().getTime();
                socket.send('Test message');
            }, 2000);
        });

        socket.on('message', (data) => {
            const now = new Date().getTime();
            const messageLatency = now - lastMessageTime;
            messageLatencyTrend.add(messageLatency);
            
            const parsed = JSON.parse(data);
            console.log("Message received:", parsed);
            msgCount++;
            wsMessagesReceived.add(1);
            
            check(parsed, {
                'has count or heartbeat': (obj) => obj.count !== undefined || obj.message?.includes('Heartbeat'),
                'message latency acceptable': () => messageLatency < 1000 // Check if message was processed within 1 second
            });
        });

        socket.on('close', () => {
            console.log('Disconnected:', connectionId);
        });

        socket.on('error', (e) => {
            console.error('Socket error:', connectionId, e);
            wsErrors.add(1);
            check(null, {
                'no connection errors': () => false
            });
        });
    });

    check(response, { 
        'status is 101': (r) => r && r.status === 101,
        'connection successful': () => isConnected
    });

    // Keep connection alive for test duration
    sleep(60);

    // Report metrics
    check(null, {
        'received messages': () => msgCount > 0,
        'message rate acceptable': () => msgCount >= 5 // At least 5 messages per connection
    });
} 