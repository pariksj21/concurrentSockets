import { setConnectionCount, getRequiredMetrics, getContentType } from './metrics'
import { activeConnections } from './websocket'
import { redisHealthCheck, isRedisAvailable } from './redis'

// Application state for readiness checks
export let isReady = false
export let isShuttingDown = false
export const startupTime = Date.now()

// State management functions
export const setReady = (ready: boolean) => { isReady = ready }
export const setShuttingDown = (shutting: boolean) => { isShuttingDown = shutting }

// Health check handlers
export const handleLivenessCheck = (requestLogger: any, requestId: string) => {
  requestLogger.debug('Liveness check requested')
  
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    uptime: process.uptime(),
    check_type: 'liveness'
  }
}

export const handleReadinessCheck = (requestLogger: any, requestId: string) => {
  requestLogger.debug('Readiness check requested')
  
  if (isShuttingDown) {
    return {
      response: new Response(JSON.stringify({
        status: 'not_ready',
        reason: 'shutting_down',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        check_type: 'readiness'
      }), { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }),
      isError: true
    }
  }
  
  if (!isReady) {
    return {
      response: new Response(JSON.stringify({
        status: 'not_ready',
        reason: 'starting_up',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        startup_time_ms: Date.now() - startupTime,
        check_type: 'readiness'
      }), { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }),
      isError: true
    }
  }
  
  return {
    response: {
      status: 'ready',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      connections: activeConnections.size,
      uptime: process.uptime(),
      startup_time_ms: Date.now() - startupTime,
      check_type: 'readiness'
    },
    isError: false
  }
}

export const handleHealthCheck = async (requestLogger: any, requestId: string) => {
  requestLogger.debug('Health check requested')
  
  // Sync Prometheus gauge with actual connection count
  setConnectionCount(activeConnections.size)
  
  // Check Redis health (safely)
  let redisInfo: {
    available: boolean;
    status: string;
    latency?: number;
  } = {
    available: false,
    status: 'unavailable'
  }
  
  try {
    if (isRedisAvailable()) {
      const redisHealth = await redisHealthCheck()
      redisInfo = {
        available: true,
        status: redisHealth.status,
        latency: redisHealth.latency
      }
    }
  } catch (error) {
    // Redis health check failed, but don't break the health endpoint
    redisInfo = {
      available: false,
      status: 'error'
    }
  }
  
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    connections: activeConnections.size,
    uptime: process.uptime(),
    redis: redisInfo
  }
}

export const handleMetricsEndpoint = async (requestLogger: any, requestId: string) => {
  requestLogger.debug('Metrics requested')
  
  // Sync Prometheus gauge with actual connection count before exposing metrics
  setConnectionCount(activeConnections.size)
  
  const metrics = await getRequiredMetrics()
  
  return new Response(metrics, {
    headers: { 'Content-Type': getContentType() }
  })
} 