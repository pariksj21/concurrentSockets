# Testing and Monitoring Setup

## Overview
This project includes comprehensive testing and monitoring capabilities as part of the CI/CD pipeline.

## Testing with Bun Test

### Test Structure
- **Unit Tests**: Located in `app/src/` with `.test.ts` extension
- **Integration Tests**: Cross-module functionality testing
- **Test Framework**: Bun's built-in test runner

### Test Files
1. `src/index.test.ts` - Main application tests
2. `src/utils/logger.test.ts` - Logger utility tests
3. `src/utils/health.test.ts` - Health check endpoint tests
4. `src/integration.test.ts` - Integration tests across modules

### Running Tests
```bash
# Run all tests
cd app && bun test

# Run tests in watch mode
bun test --watch

# Run specific test file
bun test src/index.test.ts
```

### Test Coverage
- Environment configuration validation
- Module import verification
- Logger functionality
- Health endpoint handlers
- Application startup sequence
- Error handling

## Monitoring with Monitor Script

### Monitor Script (`scripts/monitor.sh`)
The monitor script provides real-time monitoring of the WebSocket server:

**Features:**
- **Error Log Monitoring**: Tails container logs for ERROR, WARN, and connection events
- **Metrics Collection**: Hits `/metrics` endpoint every 10 seconds
- **Top-5 Metrics Display**: Shows the most important metrics with color coding
- **Health Status**: Periodic health and readiness checks
- **Connection Summary**: Active connections, total messages, and error counts

### Usage
```bash
# Start monitoring (runs continuously)
./scripts/monitor.sh

# Test monitoring endpoints
./scripts/monitor.sh test

# Get help
./scripts/monitor.sh help
```

### Metrics Displayed
1. **Process Metrics**: CPU usage, memory consumption, start time
2. **WebSocket Metrics**: Connection counts, message totals, error counts
3. **HTTP Metrics**: Request counts, response times
4. **System Metrics**: Resource utilization

## CI/CD Pipeline Integration

### GitHub Actions Workflow
The CI/CD pipeline (`.github/workflows/ci-cd.yml`) includes:

1. **Build and Test Job**:
   - Dependency installation
   - Code linting
   - **Bun test execution** (replaces pytest)
   - Application building
   - Artifact uploading

2. **Docker Build Job**:
   - Docker image building
   - Container health testing
   - Image artifact storage

3. **Monitor and Test Job** (NEW):
   - Service deployment for testing
   - **20-second monitor script execution**
   - Traffic generation for testing
   - **Log collection and archiving**
   - Container cleanup

4. **Deploy Job**:
   - Production deployment (main branch only)
   - Depends on successful monitoring tests

### Artifacts Generated
- **Build Artifacts**: Compiled application code
- **Docker Images**: Container images for deployment
- **Monitor Logs**: 20-second monitoring session logs including:
  - WebSocket server logs
  - Redis logs
  - Container status
  - Monitor script output
  - System metrics

### Pipeline Flow
```
Push/PR → Build & Test → Docker Build → Monitor Test → Deploy
                ↓           ↓            ↓
            Run bun test  Test container  20s monitoring
                ↓           ↓            ↓
            Upload build  Save image   Archive logs
```

## Key Features Implemented

### ✅ Requirements Fulfilled
1. **Testing**: Comprehensive bun test suite (replacing pytest)
2. **Monitoring**: Script tails ERROR logs, hits /metrics, shows top-5 counters every 10s
3. **CI/CD**: GitHub Actions pipeline with build-test-monitor-deploy flow
4. **Artifacts**: Automated log and artifact archiving

### Monitoring Output Example
```
=== TOP 5 METRICS (21:51:01) ===
  process_cpu_user_seconds_total: 10.84
  process_cpu_system_seconds_total: 7.07
  websocket_connections_total: 5
  websocket_messages_total: 1234
  websocket_errors_total: 0

=== SUMMARY ===
  Active Connections: 5
  Total Messages: 1234
  Total Errors: 0
```

### Test Output Example
```
bun test v1.0.22
✓ WebSocket Server > should have correct environment variables
✓ Logger Utils > should generate unique request IDs
✓ Health Utils > should handle liveness check
✓ Integration Tests > should validate server configuration

17 pass, 0 fail, 50 expect() calls
```

## Development Workflow

1. **Local Development**:
   ```bash
   # Run tests during development
   cd app && bun test --watch
   
   # Test monitoring locally
   ./scripts/monitor.sh test
   ```

2. **CI/CD Testing**:
   - Push to branch triggers full pipeline
   - Monitor job runs for 20 seconds
   - All logs archived for analysis

3. **Production Deployment**:
   - Only after successful monitoring tests
   - Automated artifact deployment
   - Health check verification

This setup ensures robust testing and monitoring throughout the development lifecycle. 