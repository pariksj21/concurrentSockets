import { Elysia } from 'elysia'
import { staticPlugin } from '@elysiajs/static'
import { ElysiaWS } from 'elysia/dist/ws'
import { v4 as uuidv4 } from 'uuid'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client'

// Application state for readiness checks
let isReady = false
let isShuttingDown = false
const startupTime = Date.now()

// Configure structured logging with request ID support
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'websocket-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d'
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d'
    })
  ]
})

// Helper function to create logger with request ID
const createRequestLogger = (requestId: string) => {
  return logger.child({ request_id: requestId })
}

// Prometheus metrics
collectDefaultMetrics()

const wsConnections = new Gauge({
  name: 'websocket_connections_total',
  help: 'Total number of active WebSocket connections'
})

const wsMessages = new Counter({
  name: 'websocket_messages_total',
  help: 'Total number of WebSocket messages processed',
  labelNames: ['type', 'status']
})

const wsConnectionDuration = new Histogram({
  name: 'websocket_connection_duration_seconds',
  help: 'Duration of WebSocket connections in seconds',
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600]
})

const wsMessageLatency = new Histogram({
  name: 'websocket_message_latency_seconds',
  help: 'WebSocket message processing latency in seconds',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
})

const wsErrors = new Counter({
  name: 'websocket_errors_total',
  help: 'Total number of WebSocket errors',
  labelNames: ['type']
})

const appShutdownTime = new Gauge({
  name: 'websocket_shutdown_time_seconds',
  help: 'Time taken to shutdown the application in seconds'
})

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'endpoint', 'status_code']
})

// Store connection message counts
const connectionCounts = new Map<string, number>();

// Store interval IDs for cleanup
const heartbeatIntervals = new Map<string, NodeJS.Timeout>();

// Store active WebSocket connections
const activeConnections = new Map<string, ElysiaWS>();

// WebSocket context interface for proper typing
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

// Function to gracefully close a WebSocket connection with final message
function gracefullyCloseConnection(ws: any, reason: string) {
  const connectionId = ws.data?.params?.connectionId;
  console.log('gracefullyCloseConnection called for connectionId:', connectionId, 'reason:', reason);
  
  if (!connectionId) {
    console.error('Cannot gracefully close connection: missing connectionId');
    return;
  }
  
  const total = connectionCounts.get(connectionId) || 0;
  console.log('Sending final message to connection:', connectionId, 'total messages:', total, 'reason:', reason);
  
  try {
    // Send final message before closing
    ws.send({ total, reason, bye:true });
    console.log('Final message sent successfully to connection:', connectionId);
    
    // Close the connection after a brief delay to ensure message is sent
    setTimeout(() => {
      console.log('Closing connection:', connectionId, 'after delay');
      ws.raw.close(1001, 'Normal closure');
    }, 100);
  } catch (error) {
    console.error('Error sending final message to connection:', connectionId, error);    
    try {
      ws.raw.close(1001, 'Server error');
    } catch (closeError) {
      console.error('Error force closing connection:', connectionId, closeError);
    }
  }
}

// Function to send heartbeat to all active connections
function startHeartbeat(ws: WebSocketContext) {
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

// The elysia app
const app = new Elysia()
  .use(staticPlugin({
    assets: './public',
    prefix: '/static'
  }))
  // Add request ID middleware FIRST
  .derive(({ headers }) => {
    const requestId = headers['x-request-id'] || uuidv4()
    return { requestId, requestLogger: createRequestLogger(requestId) }
  })
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

      // Update metrics
      wsConnections.inc()

      console.log('Connection opened:', connectionId);
      console.log('Active connections:', activeConnections.size);
    },
    message(ws, message) {
      const { connectionId } = ws.data.params;

      // Handle special disconnect message
      if (typeof message === 'object' && message !== null && 'disconnect' in message) {
        // Send final message before client disconnects
        const total = connectionCounts.get(connectionId) || 0;
        ws.send({ total, reason: 'client_requested_disconnect' });
        return;
      }

      // Increment message count
      const currentCount = (connectionCounts.get(connectionId) || 0) + 1;
      connectionCounts.set(connectionId, currentCount);

      // Send count response
      ws.send({ count: currentCount });

      // Update metrics
      wsMessages.inc({ type: 'message', status: 'processed' })
    },
    close(ws) {
      const { connectionId } = ws.data.params;

      // Cleanup - connection is already closing/closed, so we can't send messages
      clearInterval(heartbeatIntervals.get(connectionId));
      heartbeatIntervals.delete(connectionId);
      connectionCounts.delete(connectionId);
      activeConnections.delete(connectionId);

      // Update metrics
      wsConnections.dec()

      console.log('Connection closed:', connectionId);
      console.log('Active connections:', activeConnections.size);
    }
  })
  // Liveness probe - always returns OK if the process is running
  .get('/healthz', ({ requestLogger, requestId }) => {
    requestLogger.debug('Liveness check requested')
    httpRequests.inc({ method: 'GET', endpoint: '/healthz', status_code: '200' })
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      uptime: process.uptime(),
      check_type: 'liveness'
    }
  })
  // Readiness probe - returns OK only when ready to serve traffic
  .get('/readyz', ({ requestLogger, requestId }) => {
    requestLogger.debug('Readiness check requested')
    
    if (isShuttingDown) {
      httpRequests.inc({ method: 'GET', endpoint: '/readyz', status_code: '503' })
      return new Response(JSON.stringify({
        status: 'not_ready',
        reason: 'shutting_down',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        check_type: 'readiness'
      }), { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    if (!isReady) {
      httpRequests.inc({ method: 'GET', endpoint: '/readyz', status_code: '503' })
      return new Response(JSON.stringify({
        status: 'not_ready',
        reason: 'starting_up',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        startup_time_ms: Date.now() - startupTime,
        check_type: 'readiness'
      }), { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    httpRequests.inc({ method: 'GET', endpoint: '/readyz', status_code: '200' })
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      connections: activeConnections.size,
      uptime: process.uptime(),
      startup_time_ms: Date.now() - startupTime,
      check_type: 'readiness'
    }
  })
  // Legacy health check endpoint
  .get('/health', ({ requestLogger, requestId }) => {
    requestLogger.debug('Health check requested')
    httpRequests.inc({ method: 'GET', endpoint: '/health', status_code: '200' })
    
    // Sync Prometheus gauge with actual connection count
    wsConnections.set(activeConnections.size)
    
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      connections: activeConnections.size,
      uptime: process.uptime()
    }
  })
  // Metrics endpoint
  .get('/metrics', async ({ requestLogger, requestId }) => {
    requestLogger.debug('Metrics requested')
    
    // Sync Prometheus gauge with actual connection count before exposing metrics
    wsConnections.set(activeConnections.size)
    
    const metrics = await register.metrics()
    httpRequests.inc({ method: 'GET', endpoint: '/metrics', status_code: '200' })
    return new Response(metrics, {
      headers: { 'Content-Type': register.contentType }
    })
  })
  // Static file serving
  .get('/', () => Bun.file('./public/index.html'))
  .listen({
    port: parseInt(process.env.PORT || '3001'),
    hostname: process.env.HOST || '0.0.0.0'
  })

// Mark as ready after successful startup
setTimeout(() => {
  isReady = true
  logger.info('Application ready to serve traffic', {
    event_type: 'application_ready',
    startup_time_ms: Date.now() - startupTime,
    port: parseInt(process.env.PORT || '3001'),
    host: process.env.HOST || '0.0.0.0'
  })
}, 2000) // 2 second startup delay

logger.info('WebSocket server started', { 
  port: parseInt(process.env.PORT || '3001'),
  host: process.env.HOST || '0.0.0.0',
  event_type: 'application_start',
  startup_time: new Date().toISOString()
})

// Graceful shutdown handlers
async function gracefulShutdown(signal: string) {
  const shutdownStartTime = Date.now()
  const shutdownRequestId = uuidv4()
  const shutdownLogger = createRequestLogger(shutdownRequestId)
  
  shutdownLogger.info(`Received ${signal}, starting graceful shutdown...`, {
    event_type: 'shutdown_start',
    signal: signal,
    active_connections: activeConnections.size
  })
  
  isShuttingDown = true
  isReady = false
  
  try {
    // Close all WebSocket connections gracefully
    for (const [connectionId, ws] of activeConnections.entries()) {
      console.log('Closing connection:', connectionId);
      try {
        // Use the graceful close function to send final message
        gracefullyCloseConnection(ws, 'server_shutdown');
      } catch (error) {
        console.error('Error during connection cleanup:', connectionId, error);
        // Force close if graceful close fails
        ws.raw.close(1001, 'Server shutting down');
      }
      finally {
        // Clear heartbeat interval
        clearInterval(heartbeatIntervals.get(connectionId));
      }
    }
    
    // Clean up all tracking maps
    activeConnections.clear()
    heartbeatIntervals.clear()
    connectionCounts.clear()
    
    const shutdownDuration = (Date.now() - shutdownStartTime) / 1000
    appShutdownTime.set(shutdownDuration)
    
    shutdownLogger.info('Graceful shutdown completed', {
      event_type: 'shutdown_complete',
      shutdown_duration_seconds: shutdownDuration
    })
    
    // Give time for in-flight messages and close operations
    setTimeout(() => {
      console.log('Exiting process...');
      process.exit(0);
    }, 10000); // 10 seconds
  } catch (error) {
    shutdownLogger.error('Error during graceful shutdown', { 
      error,
      event_type: 'shutdown_error'
    })
    process.exit(1)
  }
}

process.on('SIGTERM', () => {
  console.log('SIGTERM received')
  gracefulShutdown('SIGTERM')
})
process.on('SIGINT', () => {
  console.log('SIGINT received')
  gracefulShutdown('SIGINT')
})

// Unhandled error handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { 
    reason, 
    promise,
    event_type: 'unhandled_rejection'
  })
})

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { 
    error,
    event_type: 'uncaught_exception'
  })
  process.exit(1)
})