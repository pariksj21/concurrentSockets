import { ElysiaWS } from 'elysia/dist/ws'
import { incrementConnection, decrementConnection, incrementMessage, recordMessageLatency, recordConnectionDuration } from './metrics'
import { logInfo, logError, logWarn } from './logger'
import { 
  getConnectionState, 
  storeConnectionState, 
  updateConnectionState, 
  removeConnectionState,
  isRedisAvailable 
} from './redis'

// Store connection message counts
export const connectionCounts = new Map<string, number>()

// Store interval IDs for cleanup
export const heartbeatIntervals = new Map<string, NodeJS.Timeout>()

// Store active WebSocket connections
export const activeConnections = new Map<string, ElysiaWS>()

// Store connection start times for duration tracking
export const connectionStartTimes = new Map<string, number>()

// WebSocket context interface for proper typing
export interface WebSocketContext extends ElysiaWS {
  data: {
    params: {
      connectionId: string;
    };
    query?: {
      previousSession?: string;
    };
  };
}

// Function to gracefully close a WebSocket connection with final message
export async function gracefullyCloseConnection(ws: any, reason: string) {
  const connectionId = ws.data?.params?.connectionId;
  
  if (!connectionId) {
    logError('Cannot gracefully close connection: missing connectionId');
    return;
  }
  
  const total = connectionCounts.get(connectionId) || 0;
  logInfo('Gracefully closing connection', { connectionId, total, reason });
  
  try {
    // Store final state in Redis before closing
    await storeConnectionState(connectionId, total, {
      disconnectedAt: new Date().toISOString(),
      reason: reason
    });

    // Send final message before closing
    ws.send({ 
      type: 'shutdown',
      total, 
      reason, 
      bye: true,
      timestamp: new Date().toISOString()
    });
    
    // Close the connection after a brief delay to ensure message is sent
    setTimeout(() => {
      logInfo('Closing connection after delay', { connectionId });
      ws.raw.close(1001, 'Normal closure');
    }, 100);
  } catch (error) {
    logError('Error during graceful connection close', { connectionId, error });
    try {
      ws.raw.close(1001, 'Server error');
    } catch (closeError) {
      logError('Error force closing connection', { connectionId, error: closeError });
    }
  }
}

// Function to send heartbeat to all active connections
export function startHeartbeat(ws: WebSocketContext) {
  const intervalId = setInterval(() => {
    try {
      ws.send({ type: "heartbeat", timestamp: new Date().toISOString() });
    } catch (error) {
      // Connection might be closed
      clearInterval(intervalId);
    }
  }, 30000); // 30 seconds
  return intervalId;
}

// WebSocket event handlers
export const handleWebSocketOpen = async (ws: WebSocketContext) => {
  const { connectionId } = ws.data.params;
  let messageCount = 0;
  let isReconnection = false;
  
  // Record connection start time for duration tracking
  connectionStartTimes.set(connectionId, Date.now());

  try {
    // Check if this is a reconnection by looking up state in Redis
    // This will gracefully return null if Redis is unavailable    
    const storedState = await getConnectionState(connectionId);
    console.log('storedState', storedState);
    
    if (storedState && isRedisAvailable()) {
      // This is a reconnection - restore previous state
      messageCount = storedState.messageCount;
      isReconnection = true;
      
      logInfo('Connection reconnected', { 
        connectionId, 
        previousMessageCount: messageCount,
        lastActivity: new Date(storedState.lastActivity).toISOString()
      });

      // Send reconnection message to client
      try {
        ws.send({
          type: 'reconnection',
          message: 'Connection re-established',
          previousCount: messageCount,
          timestamp: new Date().toISOString()
        });
      } catch (sendError) {
        logError('Failed to send reconnection message', { connectionId, error: sendError });
      }
    } else {
      // New connection
      messageCount = 0;
      logInfo('New connection established', { connectionId });
      
      // Send welcome message
      try {
        ws.send({
          type: 'welcome',
          message: 'Connection established',
          count: messageCount,
          timestamp: new Date().toISOString()
        });
      } catch (sendError) {
        logError('Failed to send welcome message', { connectionId, error: sendError });
      }
    }

    // Store/update connection state in both memory and Redis
    connectionCounts.set(connectionId, messageCount);
    
    // Store in Redis for future reconnections
    await storeConnectionState(connectionId, messageCount, {
      connectedAt: new Date().toISOString(),
      isReconnection
    });

  } catch (error) {
    logError('Error during connection open handling', { connectionId, error });
    // Fall back to treating as new connection
    messageCount = 0;
    connectionCounts.set(connectionId, messageCount);
  }

  // Start heartbeat for this connection
  const intervalId = startHeartbeat(ws);
  heartbeatIntervals.set(connectionId, intervalId);

  // Track active connection
  activeConnections.set(connectionId, ws);

  // Update metrics
  incrementConnection();

  logInfo('Connection opened successfully', { 
    connectionId, 
    messageCount,
    isReconnection,
    activeConnections: activeConnections.size 
  });
}

export const handleWebSocketMessage = async (ws: WebSocketContext, message: any) => {
  const { connectionId } = ws.data.params;
  const messageStartTime = Date.now();

  // Handle special disconnect message
  if (typeof message === 'object' && message !== null && 'disconnect' in message) {
    // Send final message before client disconnects
    const total = connectionCounts.get(connectionId) || 0;
    try {
      ws.send({ 
        type: 'disconnect_ack',
        total, 
        reason: 'client_requested_disconnect',
        timestamp: new Date().toISOString()
      });
    } catch (sendError) {
      logError('Failed to send disconnect acknowledgment', { connectionId, error: sendError });
    }
    return;
  }

  // Increment message count
  const currentCount = (connectionCounts.get(connectionId) || 0) + 1;
  connectionCounts.set(connectionId, currentCount);

  // Update state in Redis (async, non-blocking)
  updateConnectionState(connectionId, currentCount, {
    lastMessage: message,
    lastMessageAt: new Date().toISOString()
  }).catch(error => {
    logWarn('Failed to update connection state in Redis', { connectionId, error });
  });

  // Send count response
  try {
    ws.send({ 
      type: 'message_response',
      count: currentCount,
      timestamp: new Date().toISOString()
    });
  } catch (sendError) {
    logError('Failed to send message response', { connectionId, error: sendError });
  }

  // Record message processing latency
  const messageLatency = (Date.now() - messageStartTime) / 1000; // Convert to seconds
  recordMessageLatency(messageLatency);

  // Update metrics
  incrementMessage();

  logInfo('Message processed', { 
    connectionId, 
    messageCount: currentCount,
    messageType: typeof message,
    latencyMs: Date.now() - messageStartTime
  });
}

export const handleWebSocketClose = async (ws: WebSocketContext) => {
  const { connectionId } = ws.data.params;

  // Get final message count before cleanup
  const finalCount = connectionCounts.get(connectionId) || 0;
  
  // Record connection duration
  const connectionStartTime = connectionStartTimes.get(connectionId);
  if (connectionStartTime) {
    const duration = (Date.now() - connectionStartTime) / 1000; // Convert to seconds
    recordConnectionDuration(duration);
    connectionStartTimes.delete(connectionId);
  }

  // Store final state in Redis for potential reconnection
  try {
    await storeConnectionState(connectionId, finalCount, {
      disconnectedAt: new Date().toISOString(),
      reason: 'connection_closed'
    });
    logInfo('Connection state saved for potential reconnection', { 
      connectionId, 
      finalCount 
    });
  } catch (error) {
    logWarn('Failed to store connection state on close', { connectionId, error });
  }

  // Cleanup local state - connection is already closing/closed
  clearInterval(heartbeatIntervals.get(connectionId));
  heartbeatIntervals.delete(connectionId);
  connectionCounts.delete(connectionId);
  activeConnections.delete(connectionId);

  // Update metrics
  decrementConnection();

  logInfo('Connection closed', { 
    connectionId, 
    finalCount,
    activeConnections: activeConnections.size 
  });
}

// Cleanup function for graceful shutdown
export const cleanupAllConnections = () => {
  logInfo('Cleaning up all WebSocket connections...');
  
  for (const [connectionId, ws] of activeConnections.entries()) {
    console.log('Closing connection:', connectionId);
    try {
      gracefullyCloseConnection(ws, 'server_shutdown');
    } catch (error) {
      console.error('Error during connection cleanup:', connectionId, error);
      // Force close if graceful close fails
      try {
        ws.raw.close(1001, 'Server shutting down');
      } catch (closeError) {
        logError('Error force closing connection', { connectionId, error: closeError });
      }
    } finally {
      // Clear heartbeat interval
      const intervalId = heartbeatIntervals.get(connectionId);
      if (intervalId) {
        clearInterval(intervalId);
      }
    }
  }
  
  // Clean up all tracking maps
  activeConnections.clear();
  heartbeatIntervals.clear();
  connectionCounts.clear();
  connectionStartTimes.clear();
}