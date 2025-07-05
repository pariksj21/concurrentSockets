import { describe, it, expect, beforeAll, afterAll } from 'bun:test'

// Mock server for testing
let server: any

describe('Health Endpoints', () => {
  beforeAll(async () => {
    // Import and start the server
    // Note: This would need to be adapted based on how you want to structure your tests
    console.log('Setting up test server...')
  })

  afterAll(async () => {
    // Cleanup
    if (server) {
      server.stop()
    }
  })

  it('should respond to /health endpoint', async () => {
    const response = await fetch('http://localhost:3001/health')
    expect(response.status).toBe(200)
    
    const data = await response.json()
    expect(data.status).toBe('ok')
    expect(data.timestamp).toBeDefined()
    expect(data.connections).toBeDefined()
    expect(data.uptime).toBeDefined()
  })

  it('should respond to /healthz (liveness) endpoint', async () => {
    const response = await fetch('http://localhost:3001/healthz')
    expect(response.status).toBe(200)
    
    const data = await response.json()
    expect(data.status).toBe('ok')
    expect(data.check_type).toBe('liveness')
    expect(data.request_id).toBeDefined()
  })

  it('should respond to /readyz (readiness) endpoint', async () => {
    const response = await fetch('http://localhost:3001/readyz')
    // Could be 200 (ready) or 503 (not ready)
    expect([200, 503]).toContain(response.status)
    
    const data = await response.json()
    expect(data.check_type).toBe('readiness')
    expect(data.request_id).toBeDefined()
    
    if (response.status === 200) {
      expect(data.status).toBe('ready')
    } else {
      expect(data.status).toBe('not_ready')
      expect(data.reason).toBeDefined()
    }
  })

  it('should respond to /metrics endpoint', async () => {
    const response = await fetch('http://localhost:3001/metrics')
    expect(response.status).toBe(200)
    
    const text = await response.text()
    expect(text).toContain('websocket_connections_total')
    expect(text).toContain('websocket_messages_total')
    expect(text).toContain('websocket_errors_total')
  })

  it('should include request_id in structured responses', async () => {
    const response = await fetch('http://localhost:3001/healthz', {
      headers: {
        'X-Request-ID': 'test-request-123'
      }
    })
    
    const data = await response.json()
    expect(data.request_id).toBe('test-request-123')
  })
}) 