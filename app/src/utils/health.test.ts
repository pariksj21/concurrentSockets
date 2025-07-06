import { describe, it, expect } from 'bun:test'
import { 
  handleLivenessCheck, 
  handleReadinessCheck,
  handleHealthCheck,
  setReady,
  startupTime
} from './health'

describe('Health Utils', () => {
  it('should handle liveness check', () => {
    const mockLogger = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {}
    }
    
    const result = handleLivenessCheck(mockLogger, 'test-request-id')
    
    expect(result).toBeDefined()
    expect(result.status).toBe('ok')
  })
  
  it('should handle readiness check', () => {
    const mockLogger = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {}
    }
    
    const result = handleReadinessCheck(mockLogger, 'test-request-id')
    
    expect(result).toBeDefined()
    expect(result.isError).toBeDefined()
    expect(result.response).toBeDefined()
  })
  
  it('should handle health check', async () => {
    const mockLogger = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {}
    }
    
    const result = await handleHealthCheck(mockLogger, 'test-request-id')
    
    expect(result).toBeDefined()
    expect(result.status).toBeDefined()
  })
  
  it('should handle readiness state', () => {
    // Test setting ready state
    expect(() => setReady(true)).not.toThrow()
    expect(() => setReady(false)).not.toThrow()
  })
  
  it('should have startup time', () => {
    expect(startupTime).toBeDefined()
    expect(typeof startupTime).toBe('number')
    expect(startupTime).toBeGreaterThan(0)
  })
}) 