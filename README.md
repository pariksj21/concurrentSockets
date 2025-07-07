# Production WebSocket Server

A high-performance, production-ready WebSocket server built with Bun/Elysia featuring comprehensive monitoring, logging, alerting, blue-green deployment, and load balancing.

## 🚀 Why Bun?

This project leverages **Bun** as its runtime environment, a choice driven by factors that 
make it ideal for high-performance WebSocket servers:

### Performance Benefits
- **Lightning-Fast Startup**: Bun starts up faster than most other runtimes, enabling rapid 
deployment and scaling
- **Superior Memory Usage**: Significantly lower memory footprint per connection, allowing us 
to handle 10,000+ concurrent WebSocket connections easily
- **Optimized I/O**: Built-in WebSocket support with native performance, eliminating the 
overhead of external libraries
- **Zero-Copy Operations**: Advanced memory management reduces CPU usage and improves 
throughput

### WebSocket Optimization
- **Native WebSocket API**: First-class WebSocket support without additional dependencies
- **Connection Pooling**: Efficient connection management with automatic cleanup
- **Message Parsing**: Optimized JSON parsing and serialization for real-time messaging
- **Event Loop Efficiency**: Single-threaded event loop optimized for high-concurrency 
scenarios

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose (latest versions)
- Bun v1.0+ (for local development)
- k6 (for load testing)

### One-Line Stack Deployment
```bash
make start
```
This will build and start the development environment with all necessary services (WebSocket server, Traefik, Prometheus, Grafana, Redis).

### Load Testing
```bash
make test
```
This runs a comprehensive load test suite that includes:
- Ramp test: Gradual increase to 1000 users
- Stress test: Sustained 2000 users for 10 minutes
- Spike test: Sudden spike to 5000 users

### Blue-Green Deployment
```bash
# Deploy to green environment
make deploy-green

# Deploy to blue environment
make deploy-blue
```

## 🔍 Key Features

- **High Performance**: Handles 10,000+ concurrent WebSocket connections
- **Production Ready**: Includes monitoring, logging, and alerting
- **Zero-Downtime Deployment**: Blue-green deployment strategy
- **Comprehensive Monitoring**: Prometheus metrics and Grafana dashboards

## 📊 Service URLs

Run `make urls` to see all available service endpoints, or access them directly:
- WebSocket Server: http://localhost
- Grafana: http://localhost:3000 (admin/admin123)
- Prometheus: http://localhost:9090
- Health Check: http://localhost/health
- Metrics: http://localhost/metrics

## 🛠️ Common Commands

```bash
# Start development environment
make start

# Stop all services
make stop

# View logs
make logs

# Check service health
make health

# Monitor metrics
make monitor

# Run tests
make test
```

For detailed technical documentation, architecture, and advanced configuration, see [Design Documentation](docs/design.md).