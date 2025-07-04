import { Elysia } from 'elysia'
import { staticPlugin } from '@elysiajs/static'
import { ElysiaWS } from 'elysia/dist/ws'
import { findAlias } from 'elysia/dist/sucrose';

// Store connection message counts
const connectionCounts = new Map<string, number>();

// Store interval IDs for cleanup
const heartbeatIntervals = new Map<string, NodeJS.Timeout>();

// Store active WebSocket connections
const activeConnections = new Map<string, ElysiaWS>();

interface WebSocketContext extends ElysiaWS {
  data: {
    params: {
      connectionId: string;
    };
    query?: {
      previousSession?: string;
    };
  };
}

// Function to send heartbeat to all active connections
function startHeartbeat(ws: WebSocketContext) {
  const intervalId = setInterval(() => {
    try {
      ws.send({ message: "Heartbeat " + new Date().toISOString() });
    } catch (error) {
      // Connection might be closed
      clearInterval(intervalId);
    }
  }, 30000); // 30 seconds
  return intervalId;
}

const app = new Elysia()
  .use(staticPlugin())
  .ws('/ws/chat/:connectionId', {
    open(ws) {
      const { connectionId } = ws.data.params;
      const previousSession = ws.data.query?.previousSession;

      // Resume previous session count if available
      if (previousSession && connectionCounts.has(previousSession)) {
        connectionCounts.set(connectionId, connectionCounts.get(previousSession)!);
        connectionCounts.delete(previousSession);
      } else {
        connectionCounts.set(connectionId, 0);
      }

      // Start heartbeat for this connection
      const intervalId = startHeartbeat(ws);
      heartbeatIntervals.set(connectionId, intervalId);

      // Track active connection
      activeConnections.set(connectionId, ws);

      console.log('Connection opened:', connectionId);
      console.log('Active connections:', activeConnections.size);
    },
    message(ws, message) {
      const { connectionId } = ws.data.params;

      // Increment message count
      const currentCount = (connectionCounts.get(connectionId) || 0) + 1;
      connectionCounts.set(connectionId, currentCount);

      // Send count response
      ws.send({ count: currentCount });
    },
    close(ws) {
      const { connectionId } = ws.data.params;

      // Send final message
      const total = connectionCounts.get(connectionId) || 0;
      try {
        ws.send({ bye: true, total });
      } catch (error) {
        console.error('Error sending final message:', error);
      }

      // Cleanup
      clearInterval(heartbeatIntervals.get(connectionId));
      heartbeatIntervals.delete(connectionId);
      connectionCounts.delete(connectionId);
      activeConnections.delete(connectionId);

      console.log('Connection closed:', connectionId);
      console.log('Active connections:', activeConnections.size);
    }
  })
  .get('/', () => Bun.file('./public/index.html'))
  .listen(3001);

// Handle graceful shutdown
// process.on('SIGINT', async () => {
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal. Starting graceful shutdown...');
  
  console.log('Active connections:', activeConnections.size);
  console.log('Active heartbeat intervals:', heartbeatIntervals.size);

  // Close all WebSocket connections with code 1001
  for (const [connectionId, ws] of activeConnections.entries()) {
    console.log('Closing connection:', connectionId);
    try {
      // Send final message
      ws.send({ bye: true, reason: 'server_shutdown' });            
      // Close the WebSocket with code 1001 (Going Away)
      ws.raw.close(1001, 'Server shutting down');
    } catch (error) {
      console.error('Error during connection cleanup:', connectionId, error);
    }
    finally {
      // Clear heartbeat interval
      clearInterval(heartbeatIntervals.get(connectionId));
    }
  }

  // Give time for in-flight messages and close operations
  setTimeout(() => {
    console.log('Exiting process...');
    process.exit(0);
  }, 10000); // 10 seconds
});