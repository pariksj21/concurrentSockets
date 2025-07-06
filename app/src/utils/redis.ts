import { createClient, RedisClientType } from 'redis'
import { logInfo, logError, logWarn } from './logger'

// Redis client instance
let redisClient: RedisClientType | null = null

// Connection state interface
export interface ConnectionState {
  connectionId: string
  messageCount: number
  lastActivity: number
  metadata?: Record<string, any>
}

// Redis key prefixes
const REDIS_KEY_PREFIX = 'websocket:connection:'
const REDIS_RECONNECT_TTL = 15 * 60 // 15 minutes in seconds

// Initialize Redis connection
export const initializeRedis = async (): Promise<void> => {
  try {
    // Create Redis client with connection options
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://redis:6379',
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            return new Error('Too many retries')
          }
          return Math.min(retries * 100, 3000)
        }
      }
    })

    // Set up event handlers
    redisClient.on('error', (error) => {
      logError('Redis connection error', { error: error.message })
    })

    redisClient.on('connect', () => {
      logInfo('Redis client connected')
    })

    redisClient.on('ready', () => {
      logInfo('Redis client ready')
    })

    redisClient.on('end', () => {
      logWarn('Redis connection ended')
    })

    // Connect to Redis
    await redisClient.connect()
    logInfo('Redis connection established successfully')
  } catch (error) {
    logError('Failed to initialize Redis connection', { error })
    throw error
  }
}

// Get Redis client instance
export const getRedisClient = (): RedisClientType | null => {
  return redisClient
}

// Check if Redis is available
export const isRedisAvailable = (): boolean => {
  return redisClient !== null && redisClient.isReady
}

// Store connection state in Redis
export const storeConnectionState = async (
  connectionId: string,
  messageCount: number,
  metadata?: Record<string, any>
): Promise<boolean> => {
  if (!isRedisAvailable()) {
    logWarn('Redis not available, skipping connection state storage', { connectionId })
    return false
  }

  try {
    const state: ConnectionState = {
      connectionId,
      messageCount,
      lastActivity: Date.now(),
      metadata
    }

    const key = `${REDIS_KEY_PREFIX}${connectionId}`
    await redisClient!.setEx(key, REDIS_RECONNECT_TTL, JSON.stringify(state))
    
    logInfo('Connection state stored in Redis', { 
      connectionId, 
      messageCount, 
      ttl: REDIS_RECONNECT_TTL 
    })
    return true
  } catch (error) {
    logError('Failed to store connection state in Redis', { 
      connectionId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    return false
  }
}

// Retrieve connection state from Redis
export const getConnectionState = async (connectionId: string): Promise<ConnectionState | null> => {
  if (!isRedisAvailable()) {
    logWarn('Redis not available, cannot retrieve connection state', { connectionId })
    return null
  }

  try {
    const key = `${REDIS_KEY_PREFIX}${connectionId}`
    const stateJson = await redisClient!.get(key)
    
    if (!stateJson) {
      logInfo('No stored connection state found', { connectionId })
      return null
    }

    const state: ConnectionState = JSON.parse(stateJson)
    logInfo('Retrieved connection state from Redis', { 
      connectionId, 
      messageCount: state.messageCount,
      lastActivity: new Date(state.lastActivity).toISOString()
    })
    
    return state
  } catch (error) {
    logError('Failed to retrieve connection state from Redis', { 
      connectionId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    return null
  }
}

// Update connection state in Redis
export const updateConnectionState = async (
  connectionId: string,
  messageCount: number,
  metadata?: Record<string, any>
): Promise<boolean> => {
  if (!isRedisAvailable()) {
    return false
  }

  try {
    const key = `${REDIS_KEY_PREFIX}${connectionId}`
    
    // Check if key exists and extend TTL
    const exists = await redisClient!.exists(key)
    if (!exists) {
      // Key expired, treat as new connection
      return await storeConnectionState(connectionId, messageCount, metadata)
    }

    const state: ConnectionState = {
      connectionId,
      messageCount,
      lastActivity: Date.now(),
      metadata
    }

    await redisClient!.setEx(key, REDIS_RECONNECT_TTL, JSON.stringify(state))
    return true
  } catch (error) {
    logError('Failed to update connection state in Redis', { 
      connectionId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    return false
  }
}

// Remove connection state from Redis
export const removeConnectionState = async (connectionId: string): Promise<boolean> => {
  if (!isRedisAvailable()) {
    return false
  }

  try {
    const key = `${REDIS_KEY_PREFIX}${connectionId}`
    const deleted = await redisClient!.del(key)
    
    if (deleted > 0) {
      logInfo('Connection state removed from Redis', { connectionId })
    }
    
    return deleted > 0
  } catch (error) {
    logError('Failed to remove connection state from Redis', { 
      connectionId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    return false
  }
}

// Get TTL for connection state
export const getConnectionStateTTL = async (connectionId: string): Promise<number> => {
  if (!isRedisAvailable()) {
    return -1
  }

  try {
    const key = `${REDIS_KEY_PREFIX}${connectionId}`
    const ttl = await redisClient!.ttl(key)
    return ttl
  } catch (error) {
    logError('Failed to get connection state TTL', { 
      connectionId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    return -1
  }
}

// Get all active connection states (for monitoring)
export const getAllConnectionStates = async (): Promise<ConnectionState[]> => {
  if (!isRedisAvailable()) {
    return []
  }

  try {
    const pattern = `${REDIS_KEY_PREFIX}*`
    const keys = await redisClient!.keys(pattern)
    
    if (keys.length === 0) {
      return []
    }

    const states: ConnectionState[] = []
    for (const key of keys) {
      try {
        const stateJson = await redisClient!.get(key)
        if (stateJson) {
          const state: ConnectionState = JSON.parse(stateJson)
          states.push(state)
        }
      } catch (parseError) {
        logWarn('Failed to parse connection state', { key, error: parseError })
      }
    }

    return states
  } catch (error) {
    logError('Failed to get all connection states', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    return []
  }
}

// Cleanup expired connection states (manual cleanup)
export const cleanupExpiredStates = async (): Promise<number> => {
  if (!isRedisAvailable()) {
    return 0
  }

  try {
    const pattern = `${REDIS_KEY_PREFIX}*`
    const keys = await redisClient!.keys(pattern)
    
    let cleanedCount = 0
    for (const key of keys) {
      const ttl = await redisClient!.ttl(key)
      if (ttl === -2) { // Key doesn't exist
        cleanedCount++
      } else if (ttl === -1) { // Key exists but has no TTL (shouldn't happen)
        await redisClient!.del(key)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      logInfo('Cleaned up expired connection states', { count: cleanedCount })
    }

    return cleanedCount
  } catch (error) {
    logError('Failed to cleanup expired connection states', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    return 0
  }
}

// Close Redis connection
export const closeRedis = async (): Promise<void> => {
  if (redisClient) {
    try {
      await redisClient.quit()
      logInfo('Redis connection closed')
    } catch (error) {
      logError('Error closing Redis connection', { error })
    } finally {
      redisClient = null
    }
  }
}

// Health check for Redis
export const redisHealthCheck = async (): Promise<{ status: 'healthy' | 'unhealthy', latency?: number }> => {
  if (!isRedisAvailable()) {
    return { status: 'unhealthy' }
  }

  try {
    const start = Date.now()
    await redisClient!.ping()
    const latency = Date.now() - start
    
    return { status: 'healthy', latency }
  } catch (error) {
    logError('Redis health check failed', { error })
    return { status: 'unhealthy' }
  }
} 