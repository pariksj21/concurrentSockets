import { describe, it, expect } from 'bun:test'
import { generateRequestId, createRequestLogger, logInfo, logError } from './logger'

describe('Logger Utils', () => {
  it('should generate unique request IDs', () => {
    const id1 = generateRequestId()
    const id2 = generateRequestId()
    
    expect(id1).toBeDefined()
    expect(id2).toBeDefined()
    expect(id1).not.toBe(id2)
    expect(id1.length).toBeGreaterThan(0)
  })
  
  it('should create request logger', () => {
    const requestId = generateRequestId()
    const logger = createRequestLogger(requestId)
    
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
  })
  
  it('should handle log info calls', () => {
    // Test that logInfo doesn't throw
    expect(() => logInfo('Test message')).not.toThrow()
    expect(() => logInfo('Test message', { key: 'value' })).not.toThrow()
  })
  
  it('should handle log error calls', () => {
    // Test that logError doesn't throw
    expect(() => logError('Test error')).not.toThrow()
    expect(() => logError('Test error', { error: 'details' })).not.toThrow()
  })
}) 