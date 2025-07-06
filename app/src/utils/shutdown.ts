import { generateRequestId, createRequestLogger, logger } from './logger'
import { recordShutdownTime } from './metrics'
import { cleanupAllConnections } from './websocket'
import { setShuttingDown, setReady } from './health'
import { closeRedis } from './redis'

// Graceful shutdown handler
export async function gracefulShutdown(signal: string) {
  const shutdownStartTime = Date.now()
  const shutdownRequestId = generateRequestId()
  const shutdownLogger = createRequestLogger(shutdownRequestId)
  
  shutdownLogger.info(`Received ${signal}, starting graceful shutdown...`, {
    event_type: 'shutdown_start',
    signal: signal,
  })
  
  setShuttingDown(true)
  setReady(false)
  
  try {
    // Close all WebSocket connections gracefully
    cleanupAllConnections()
    
    // Close Redis connection
    await closeRedis()
    
    const shutdownDuration = (Date.now() - shutdownStartTime) / 1000
    recordShutdownTime(shutdownDuration)
    
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

// Setup signal handlers
export function setupSignalHandlers() {
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
} 