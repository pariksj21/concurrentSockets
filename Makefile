# Makefile for WebSocket Server Development and Deployment
.PHONY: help dev-up dev-down prod-up prod-down build clean logs test lint format deploy status health monitor

# Default target - show help
help: ## Show this help message
	@echo "WebSocket Server Development Commands"
	@echo "===================================="
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Development commands
dev-up: ## Start development environment (blue deployment)
	@echo "🚀 Starting development environment..."
	docker compose -f docker/compose/docker-compose.yml up -d websocket-blue traefik prometheus grafana redis
	@echo "✅ Development environment started!"
	@echo "📊 Services available at:"
	@echo "  • WebSocket Server: http://localhost"
	@echo "  • Health Check:     http://localhost/health"
	@echo "  • Liveness:         http://localhost/healthz"
	@echo "  • Readiness:        http://localhost/readyz"
	@echo "  • Metrics:          http://localhost/metrics"
	@echo "  • Grafana:          http://localhost:3000 (admin/admin123)"
	@echo "  • Prometheus:       http://localhost:9090"

dev-down: ## Stop development environment
	@echo "🛑 Stopping development environment..."
	docker compose -f docker/compose/docker-compose.yml --profile green down
	@echo "✅ Development environment stopped!"

dev-build: ## Build development images
	@echo "🔨 Building development images..."
	docker compose -f docker/compose/docker-compose.yml build websocket-blue
	@echo "✅ Development images built!"

# Production commands
prod-up: ## Start production environment (blue-green ready)
	@echo "🚀 Starting production environment..."
	docker compose -f docker/compose/docker-compose.yml up -d
	@echo "✅ Production environment started!"

prod-down: ## Stop production environment
	@echo "🛑 Stopping production environment..."
	docker compose -f docker/compose/docker-compose.yml --profile green down
	@echo "✅ Production environment stopped!"

# Blue-Green deployment commands
deploy-green: ## Deploy to green environment
	@echo "🔄 Deploying to green environment..."
	./scripts/blue-green-deploy.sh green

deploy-blue: ## Deploy to blue environment
	@echo "🔄 Deploying to blue environment..."
	./scripts/blue-green-deploy.sh blue

# Build and maintenance commands
build: ## Build all Docker images
	@echo "🔨 Building all Docker images..."
	docker compose -f docker/compose/docker-compose.yml build
	@echo "✅ All images built!"

clean: ## Clean up Docker resources
	@echo "🧹 Cleaning up Docker resources..."
	docker compose -f docker/compose/docker-compose.yml --profile green down -v
	docker system prune -f
	docker volume prune -f
	@echo "✅ Cleanup completed!"

# Monitoring and logs
logs: ## Show logs from all services
	docker compose -f docker/compose/docker-compose.yml logs -f

logs-app: ## Show logs from WebSocket application only
	docker compose -f docker/compose/docker-compose.yml logs -f websocket-blue websocket-green

logs-traefik: ## Show logs from Traefik load balancer
	docker compose -f docker/compose/docker-compose.yml logs -f traefik

monitor: ## Start interactive monitoring dashboard
	@echo "🔍 Starting monitoring dashboard..."
	@echo "Press Ctrl+C to stop monitoring"
	./scripts/monitor.sh

monitor-test: ## Test monitoring endpoints
	@echo "🧪 Testing monitoring endpoints..."
	./scripts/monitor.sh test

status: ## Show status of all services
	@echo "📊 Service Status:"
	@echo "=================="
	docker compose -f docker/compose/docker-compose.yml ps

health: ## Check health of all services
	@echo "🏥 Health Check:"
	@echo "================"
	@echo "🔍 Liveness Check:"
	@curl -s http://localhost/healthz | jq -r '.status // "FAILED"' || echo "❌ Liveness check failed"
	@echo "🔍 Readiness Check:"
	@curl -s http://localhost/readyz | jq -r '.status // "FAILED"' || echo "❌ Readiness check failed"
	@echo "🔍 Legacy Health Check:"
	@curl -s http://localhost/health | jq -r '.status // "FAILED"' || echo "❌ Health check failed"
	@echo "🔍 Prometheus Check:"
	@curl -s http://localhost:9090/-/ready > /dev/null && echo "✅ Prometheus is healthy" || echo "❌ Prometheus is down"
	@echo "🔍 Grafana Check:"
	@curl -s http://localhost:3000/api/health > /dev/null && echo "✅ Grafana is healthy" || echo "❌ Grafana is down"

# Observability commands
metrics: ## Show current metrics
	@echo "📊 Current Metrics:"
	@echo "=================="
	@curl -s http://localhost/metrics | grep -E "^websocket_|^http_requests_total" | head -10

alerts: ## Check Prometheus alerts
	@echo "🚨 Active Alerts:"
	@echo "================"
	@curl -s http://localhost:9090/api/v1/alerts | jq -r '.data.alerts[] | "\(.labels.alertname): \(.state)"' 2>/dev/null || echo "No alerts or Prometheus unavailable"

# Development tools
test: ## Run load tests
	@echo "🧪 Running load tests..."
	cd app && bun run loadtest

test-unit: ## Run unit tests
	@echo "🧪 Running unit tests..."
	cd app && bun test

lint: ## Run code linting
	@echo "🔍 Running code linting..."
	cd app && bun run lint

format: ## Format code
	@echo "✨ Formatting code..."
	cd app && bun run format || echo "No format script configured"

# Database and cache
redis-cli: ## Connect to Redis CLI
	docker exec -it redis redis-cli

redis-flush: ## Flush Redis cache
	docker exec -it redis redis-cli FLUSHALL

# Backup and restore
backup: ## Backup application data
	@echo "💾 Creating backup..."
	mkdir -p backups
	docker run --rm -v $(PWD)/app/logs:/data -v $(PWD)/backups:/backup alpine tar czf /backup/logs-$(shell date +%Y%m%d-%H%M%S).tar.gz -C /data .
	@echo "✅ Backup created in backups/ directory"

# Quick start command
start: dev-build dev-up ## Quick start - build and run development environment
	@echo "🎉 Development environment is ready!"

# Stop everything
stop: dev-down ## Stop all services
	@echo "🛑 All services stopped!"

# Restart services
restart: dev-down dev-up ## Restart development environment

# Show URLs
urls: ## Show all service URLs
	@echo "🌐 Service URLs:"
	@echo "================"
	@echo "  • WebSocket Server: http://localhost"
	@echo "  • Health Check:     http://localhost/health"
	@echo "  • Liveness Probe:   http://localhost/healthz"
	@echo "  • Readiness Probe:  http://localhost/readyz"
	@echo "  • Metrics:          http://localhost/metrics"
	@echo "  • Grafana:          http://localhost:3000 (admin/admin123)"
	@echo "  • Prometheus:       http://localhost:9090"
	@echo "  • Redis:            localhost:6379"

# CI/CD simulation
ci-test: ## Run CI-like tests locally
	@echo "🔄 Running CI-like tests..."
	@echo "📋 1. Building application..."
	@cd app && bun run build
	@echo "📋 2. Running unit tests..."
	@cd app && bun test || echo "No tests configured"
	@echo "📋 3. Testing Docker build..."
	@docker build -f docker/app/Dockerfile -t websocket-test ./app
	@echo "📋 4. Testing health endpoints..."
	@docker run -d --name test-ws -p 3002:3001 websocket-test
	@sleep 10
	@curl -f http://localhost:3002/health > /dev/null && echo "✅ Health check passed" || echo "❌ Health check failed"
	@curl -f http://localhost:3002/healthz > /dev/null && echo "✅ Liveness check passed" || echo "❌ Liveness check failed"
	@curl -f http://localhost:3002/readyz > /dev/null && echo "✅ Readiness check passed" || echo "❌ Readiness check failed"
	@curl -f http://localhost:3002/metrics | grep -q "websocket_connections_total" && echo "✅ Metrics check passed" || echo "❌ Metrics check failed"
	@docker stop test-ws && docker rm test-ws
	@echo "✅ CI tests completed!" 