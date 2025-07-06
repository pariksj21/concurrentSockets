import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client'

// Initialize default metrics collection
collectDefaultMetrics()

// WebSocket-specific metrics
export const wsConnections = new Gauge({
  name: 'websocket_connections_total',
  help: 'Total number of active WebSocket connections'
})

export const wsMessages = new Counter({
  name: 'websocket_messages_total',
  help: 'Total number of WebSocket messages processed',
  labelNames: ['type', 'status']
})

export const wsConnectionDuration = new Histogram({
  name: 'websocket_connection_duration_seconds',
  help: 'Duration of WebSocket connections in seconds',
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600]
})

export const wsMessageLatency = new Histogram({
  name: 'websocket_message_latency_seconds',
  help: 'WebSocket message processing latency in seconds',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
})

export const wsErrors = new Counter({
  name: 'websocket_errors_total',
  help: 'Total number of WebSocket errors',
  labelNames: ['type']
})

// Application metrics
export const appShutdownTime = new Gauge({
  name: 'websocket_shutdown_time_seconds',
  help: 'Time taken to shutdown the application in seconds'
})

export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'endpoint', 'status_code']
})

// Metrics utility functions
export const incrementConnection = () => wsConnections.inc()
export const decrementConnection = () => wsConnections.dec()
export const setConnectionCount = (count: number) => wsConnections.set(count)

export const incrementMessage = (type: string, status: string) => 
  wsMessages.inc({ type, status })

export const incrementHttpRequest = (method: string, endpoint: string, statusCode: string) =>
  httpRequests.inc({ method, endpoint, status_code: statusCode })

export const recordShutdownTime = (duration: number) => appShutdownTime.set(duration)

export const getMetrics = async () => register.metrics()
export const getContentType = () => register.contentType 