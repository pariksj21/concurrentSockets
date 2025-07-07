import { Elysia } from 'elysia'
import { staticPlugin } from '@elysiajs/static'

// Import our utility modules
import { generateRequestId, createRequestLogger, logInfo, logError } from './utils/logger'
import { 
  handleWebSocketOpen, 
  handleWebSocketMessage, 
  handleWebSocketClose,
  WebSocketContext 
} from './utils/websocket'
import { 
  handleLivenessCheck, 
  handleReadinessCheck, 
  handleHealthCheck, 
  handleMetricsEndpoint,
  setReady,
  startupTime 
} from './utils/health'
import { setupSignalHandlers } from './utils/shutdown'

// The elysia app
const app = new Elysia()
  .use(staticPlugin({
    assets: './public',
    prefix: '/static'
  }))
  // Add request ID middleware FIRST
  .derive(({ headers }) => {
    const requestId = headers['x-request-id'] || generateRequestId()
    return { requestId, requestLogger: createRequestLogger(requestId) }
  })
  .ws('/ws/chat/:connectionId', {
    async open(ws) {
      await handleWebSocketOpen(ws as WebSocketContext)
    },
    async message(ws, message) {
      await handleWebSocketMessage(ws as WebSocketContext, message)
    },
    async close(ws) {
      await handleWebSocketClose(ws as WebSocketContext)
    }
  })
  // Liveness probe - always returns OK if the process is running
  .get('/healthz', ({ requestLogger, requestId }) => {
    return handleLivenessCheck(requestLogger, requestId)
  })
  // Readiness probe - returns OK only when ready to serve traffic
  .get('/readyz', ({ requestLogger, requestId }) => {
    const result = handleReadinessCheck(requestLogger, requestId)
    return result.isError ? result.response : result.response
  })
  // Halth check endpoint
  .get('/health', async ({ requestLogger, requestId }) => {
    return await handleHealthCheck(requestLogger, requestId)
  })
  // Metrics endpoint
  .get('/metrics', async ({ requestLogger, requestId }) => {
    return await handleMetricsEndpoint(requestLogger, requestId)
  })
  // Static file serving
  .get('/', () => Bun.file('./public/index.html'))
  .listen({
    port: parseInt(process.env.PORT || '3001'),
    hostname: process.env.HOST || '0.0.0.0'
  })

// Initialize Redis connection (non-blocking)
const initializeRedisConnection = async () => {
  try {
    const redisModule = await import('./utils/redis')
    await redisModule.initializeRedis()
    logInfo('Redis initialized successfully for reconnection support')
  } catch (error) {
    logError('Failed to initialize Redis, continuing without reconnection support', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
  }
}

// Start Redis initialization in background (non-blocking)
// This should not affect application startup
setTimeout(() => {
  initializeRedisConnection().catch((error) => {
    // Redis initialization failed, but application continues normally
    logError('Redis initialization failed during delayed startup', { error })
  })
}, 1000) // Delay Redis initialization to avoid blocking startup

setTimeout(() => {
  setReady(true)
  logInfo('Application ready to serve traffic', {
    event_type: 'application_ready',
    startup_time_ms: Date.now() - startupTime,
    port: parseInt(process.env.PORT || '3001'),
    host: process.env.HOST || '0.0.0.0'
  })
}, 2000) // 2 second startup delay

logInfo('WebSocket server started', { 
  port: parseInt(process.env.PORT || '3001'),
  host: process.env.HOST || '0.0.0.0',
  event_type: 'application_start',
  startup_time: new Date().toISOString()
})

// Setup graceful shutdown handlers
setupSignalHandlers()