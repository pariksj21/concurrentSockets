# Production WebSocket Server

A high-performance, production-ready WebSocket server built with Bun/Elysia featuring comprehensive monitoring, logging, blue-green deployment, and load balancing.

## 🚀 Features

### Core Features
- **High-Performance WebSocket Server**: Built with Bun and Elysia for maximum performance
- **Connection Management**: Handles up to 10,000 concurrent connections with automatic cleanup
- **Message Validation**: Structured message processing with error handling
- **Heartbeat System**: Automatic connection health monitoring
- **Graceful Shutdown**: Proper connection draining and cleanup

### Production Features
- **Structured Logging**: Winston-based logging with daily rotation
- **Metrics Collection**: Prometheus metrics for monitoring
- **Health Checks**: Built-in health endpoints for load balancers
- **Rate Limiting**: Protection against abuse and overload
- **Security Headers**: Comprehensive security configuration

### Infrastructure
- **Docker Support**: Multi-stage production builds
- **Traefik Load Balancer**: WebSocket-optimized reverse proxy with automatic service discovery
- **Blue-Green Deployment**: Zero-downtime deployments
- **Monitoring Stack**: Prometheus + Grafana dashboards
- **Log Aggregation**: ELK stack integration (optional)

## 📋 Requirements

- **Docker & Docker Compose**: Latest versions
- **Bun**: v1.0+ (for local development)
- **k6**: For load testing
- **curl**: For health checks

## 🏗️ Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Client    │────│   Traefik   │────│ WebSocket   │
│             │    │Load Balancer│    │   Server    │
└─────────────┘    └─────────────┘    └─────────────┘
                           │                   │
                           │                   │
                   ┌─────────────┐    ┌─────────────┐
                   │ Prometheus  │    │   Redis     │
                   │ (Metrics)   │    │  (Cache)    │
                   └─────────────┘    └─────────────┘
                           │
                   ┌─────────────┐
                   │   Grafana   │
                   │(Dashboards) │
                   └─────────────┘
```

## 🚀 Quick Start

### 1. Clone and Setup
```bash
git clone <repository-url>
cd concurrentSocket
```

### 2. Start the Stack
```bash
# Start the blue environment (default)
docker compose up -d

# Or start with logging stack
docker compose --profile logging up -d
```

### 3. Verify Deployment
```bash
# Check health
curl http://localhost/health

# Check metrics
curl http://localhost/metrics

# Access web interface
open http://localhost
```

### 4. Monitor
- **Grafana**: http://localhost:3000 (admin/admin123)
- **Prometheus**: http://localhost:9090
- **Kibana**: http://localhost:5601 (if logging profile enabled)

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `MAX_CONNECTIONS` | 10000 | Maximum concurrent connections |
| `HEARTBEAT_INTERVAL` | 30000 | Heartbeat interval (ms) |
| `CONNECTION_TIMEOUT` | 300000 | Connection timeout (ms) |
| `LOG_LEVEL` | info | Logging level |

### Traefik Configuration
The Traefik configuration supports:
- Automatic service discovery via Docker labels
- WebSocket proxy with proper headers
- Rate limiting (10 req/s for API, 5 req/s for WebSocket)
- SSL/TLS termination with Let's Encrypt
- Health check endpoints
- Security headers
- Dashboard at http://localhost:8080

## 📊 Monitoring

### Metrics Available
- `websocket_connections_total`: Active connections
- `websocket_messages_total`: Message throughput
- `websocket_message_latency_seconds`: Message processing time
- `websocket_connection_duration_seconds`: Connection lifetime
- `websocket_errors_total`: Error rates

### Alerts Configured
- High connection count (>8000)
- Connection limit reached (≥10000)
- High error rate (>10 errors/sec)
- High message latency (>1s p95)
- Server down
- High resource usage

## 🔄 Blue-Green Deployment

### Manual Deployment
```bash
# Deploy to green environment
./scripts/blue-green-deploy.sh green

# Deploy to blue environment
./scripts/blue-green-deploy.sh blue
```

### Deployment Process
1. **Deploy**: Start new environment container
2. **Health Check**: Verify new environment is healthy
3. **Load Test**: Run smoke tests against new environment
4. **Switch Traffic**: Update Traefik routing configuration
5. **Verify**: Confirm traffic is flowing to new environment
6. **Drain**: Gracefully shutdown old environment
7. **Rollback**: Automatic rollback on any failure

### Deployment Features
- Automatic health checks
- Load testing verification
- Automatic rollback on failure
- Graceful connection draining
- Zero-downtime switching

## 🧪 Testing

### Load Testing
```bash
# Run comprehensive load test
cd app && bun run loadtest

# Custom k6 test
k6 run --vus 1000 --duration 5m loadtest.js
```

### Test Scenarios
1. **Ramp Up**: Gradual increase to 1000 users
2. **Stress Test**: Sustained 2000 users for 10 minutes
3. **Spike Test**: Sudden spike to 5000 users

### Performance Targets
- Connection time: p95 < 2s
- Message latency: p95 < 1s
- Success rate: >95%
- Error rate: <1%

## 🔍 Troubleshooting

### Common Issues

#### High Memory Usage
```bash
# Check memory usage
docker stats websocket-blue

# Check connection count
curl http://localhost/metrics | grep websocket_connections_total
```

#### Connection Issues
```bash
# Check Traefik logs
docker logs traefik-lb

# Check WebSocket server logs
docker logs websocket-blue
```

#### Performance Issues
```bash
# Check metrics in Grafana
open http://localhost:3000

# Run performance test
cd app && bun run loadtest
```

### Log Locations
- Application logs: `./app/logs/`
- Traefik logs: Container logs via `docker logs traefik-lb`
- System metrics: Prometheus at http://localhost:9090

## 🛠️ Development

### Local Development
```bash
cd app
bun install
bun run dev
```

### Building
```bash
cd app
bun run build
```

### Testing
```bash
cd app
bun test
```

## 🔒 Security

### Features Implemented
- Rate limiting on all endpoints
- Security headers (HSTS, CSP, etc.)
- Input validation and sanitization
- Error handling without information leakage
- Non-root container execution
- Network isolation

### SSL/TLS
For production, Traefik can automatically obtain SSL certificates via Let's Encrypt, or you can provide custom certificates by mounting them into the container.

## 📈 Performance Tuning

### Server Optimization
- Connection pooling and reuse
- Efficient message parsing
- Memory-optimized data structures
- Automatic cleanup of stale connections

### Traefik Optimization
- Automatic service discovery
- HTTP/2 support
- Compression middleware
- Circuit breaker patterns
- Health check integration

### System Optimization
- File descriptor limits increased
- TCP optimization for WebSockets
- Memory limits and reservations
- CPU resource allocation

## 🚨 Alerts and Monitoring

### Critical Alerts
- Server down
- Connection limit reached
- High error rate

### Warning Alerts
- High connection count
- High latency
- High resource usage

### Metrics Retention
- Prometheus: 30 days
- Logs: 14 days (application), 30 days (errors)

## 📝 API Documentation

### WebSocket Endpoints

#### `/ws/chat/:connectionId`
Establishes a WebSocket connection for real-time communication.

**Messages:**
- `connection_established`: Sent when connection is established
- `heartbeat`: Periodic health check (every 30s)
- `message_response`: Response to client messages
- `error`: Error notifications
- `goodbye`: Sent before connection closes

### HTTP Endpoints

#### `GET /health`
Returns server health status and connection count.

#### `GET /metrics`
Prometheus metrics endpoint (restricted access).

#### `GET /`
Serves the test client interface.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
1. Check the troubleshooting guide
2. Review logs and metrics
3. Create an issue with detailed information

---