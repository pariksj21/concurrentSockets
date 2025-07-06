import { register, collectDefaultMetrics, Counter, Gauge } from 'prom-client'

// Only collect default metrics in production (not in tests)
const shouldCollectDefaults = process.env.NODE_ENV === 'production' || process.env.COLLECT_DEFAULT_METRICS === 'true'
if (shouldCollectDefaults) {
  collectDefaultMetrics()
}

// MUST-HAVE METRICS (as per requirements)

// 1. Active connections
export const wsConnections = new Gauge({
  name: 'websocket_connections_active',
  help: 'Current number of active WebSocket connections'
})

// 2. Total messages
export const wsMessages = new Counter({
  name: 'websocket_messages_total',
  help: 'Total number of WebSocket messages processed'
})

// 3. Error count
export const wsErrors = new Counter({
  name: 'websocket_errors_total',
  help: 'Total number of WebSocket errors'
})

// 4. Shutdown time
export const appShutdownTime = new Gauge({
  name: 'websocket_shutdown_time_seconds',
  help: 'Time taken to shutdown the application in seconds'
})

// Metrics utility functions
export const incrementConnection = () => wsConnections.inc()
export const decrementConnection = () => wsConnections.dec()
export const setConnectionCount = (count: number) => wsConnections.set(count)

export const incrementMessage = () => wsMessages.inc()

export const incrementError = () => wsErrors.inc()

export const recordShutdownTime = (duration: number) => appShutdownTime.set(duration)

// Get all metrics (including default system metrics in production)
export const getMetrics = async () => register.metrics()
export const getContentType = () => register.contentType

// Get only the MUST-HAVE metrics as per requirements
export const getRequiredMetrics = async () => {
  const requiredMetricNames = [
    'websocket_connections_active',
    'websocket_messages_total', 
    'websocket_errors_total',
    'websocket_shutdown_time_seconds'
  ]
  
  const allMetrics = await register.metrics()
  const lines = allMetrics.split('\n')
  const requiredLines: string[] = []
  
  let includeNextLine = false
  
  for (const line of lines) {
    // Include HELP and TYPE lines for our metrics
    if (line.startsWith('# HELP') || line.startsWith('# TYPE')) {
      const metricName = line.split(' ')[2]
      if (requiredMetricNames.includes(metricName)) {
        requiredLines.push(line)
        includeNextLine = true
      }
    }
    // Include metric value lines for our metrics
    else if (requiredMetricNames.some(name => line.startsWith(name))) {
      requiredLines.push(line)
    }
    // Include empty lines after our metrics for proper formatting
    else if (includeNextLine && line.trim() === '') {
      requiredLines.push(line)
      includeNextLine = false
    }
  }
  
  return requiredLines.join('\n')
} 