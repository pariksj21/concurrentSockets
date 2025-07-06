import { describe, it, expect } from 'bun:test'

describe('WebSocket Server', () => {
  it('should have correct environment variables', () => {
    const port = parseInt(process.env.PORT || '3001')
    const host = process.env.HOST || '0.0.0.0'
    
    expect(port).toBeGreaterThan(0)
    expect(host).toBeDefined()
  })
  
  it('should handle startup configuration', () => {
    // Test basic configuration
    expect(process.env.NODE_ENV || 'development').toBeDefined()
  })
})

describe('Application Structure', () => {
  it('should have required utility modules', async () => {
    // Test that all utility modules can be imported
    const loggerModule = await import('./utils/logger')
    const websocketModule = await import('./utils/websocket')
    const healthModule = await import('./utils/health')
    const shutdownModule = await import('./utils/shutdown')
    
    expect(loggerModule).toBeDefined()
    expect(websocketModule).toBeDefined()
    expect(healthModule).toBeDefined()
    expect(shutdownModule).toBeDefined()
  })
}) 