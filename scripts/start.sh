#!/bin/bash

# Startup script for Production WebSocket Server
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    success "Docker is running"
}

# Function to check if ports are available
check_ports() {
    local ports=(80 443 3000 9090)
    for port in "${ports[@]}"; do
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            warning "Port $port is already in use"
        else
            log "Port $port is available"
        fi
    done
}

# Function to create necessary directories
create_directories() {
    log "Creating necessary directories..."
    mkdir -p app/logs
    success "Directories created"
}

# SSL certificates are now handled by Traefik automatically
# generate_ssl_certs function removed - Traefik handles SSL via Let's Encrypt

# Function to start the stack
start_stack() {
    local profile=${1:-""}
    
    log "Starting the WebSocket server stack..."
    
    if [ "$profile" = "logging" ]; then
        log "Starting with logging stack (ELK)..."
        docker compose --profile logging up -d
    else
        log "Starting basic stack..."
        docker compose up -d
    fi
    
    if [ $? -eq 0 ]; then
        success "Stack started successfully"
    else
        error "Failed to start stack"
        exit 1
    fi
}

# Function to wait for services to be ready
wait_for_services() {
    log "Waiting for services to be ready..."
    
    # Wait for WebSocket server
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s http://localhost/health > /dev/null 2>&1; then
            success "WebSocket server is ready"
            break
        else
            log "Waiting for WebSocket server... (attempt $attempt/$max_attempts)"
            sleep 2
            ((attempt++))
        fi
    done
    
    if [ $attempt -gt $max_attempts ]; then
        error "WebSocket server failed to start within timeout"
        exit 1
    fi
    
    # Wait for Prometheus
    if curl -f -s http://localhost:9090/-/ready > /dev/null 2>&1; then
        success "Prometheus is ready"
    else
        warning "Prometheus may not be ready yet"
    fi
    
    # Wait for Grafana
    if curl -f -s http://localhost:3000/api/health > /dev/null 2>&1; then
        success "Grafana is ready"
    else
        warning "Grafana may not be ready yet"
    fi
}

# Function to show service URLs
show_urls() {
    echo
    success "🚀 WebSocket Server Stack is running!"
    echo
    echo "📊 Service URLs:"
    echo "  • WebSocket Server: http://localhost"
    echo "  • Health Check:     http://localhost/health"
    echo "  • Metrics:          http://localhost/metrics"
    echo "  • Grafana:          http://localhost:3000 (admin/admin123)"
    echo "  • Prometheus:       http://localhost:9090"
    echo
    echo "🧪 Testing:"
    echo "  • Load Test:        cd app && bun run loadtest"
    echo "  • Blue-Green:       ./scripts/blue-green-deploy.sh green"
    echo
    echo "📋 Management:"
    echo "  • View Logs:        docker compose logs -f"
    echo "  • Stop Stack:       docker compose down"
    echo "  • View Status:      docker compose ps"
    echo
}

# Function to run basic health checks
run_health_checks() {
    log "Running health checks..."
    
    # Check WebSocket server
    if curl -f -s http://localhost/health | grep -q "ok"; then
        success "✓ WebSocket server health check passed"
    else
        error "✗ WebSocket server health check failed"
    fi
    
    # Check metrics endpoint
    if curl -f -s http://localhost/metrics | grep -q "websocket"; then
        success "✓ Metrics endpoint is working"
    else
        warning "⚠ Metrics endpoint may not be working"
    fi
    
    # Check container status
    local running_containers=$(docker compose ps --services --filter "status=running" | wc -l)
    local total_containers=$(docker compose ps --services | wc -l)
    
    if [ "$running_containers" -eq "$total_containers" ]; then
        success "✓ All containers are running ($running_containers/$total_containers)"
    else
        warning "⚠ Some containers may not be running ($running_containers/$total_containers)"
    fi
}

# Main function
main() {
    local profile=${1:-""}
    
    echo "🚀 Starting Production WebSocket Server"
    echo "========================================"
    
    # Pre-flight checks
    check_docker
    check_ports
    
    # Setup
    create_directories
    
    # Start services
    start_stack "$profile"
    
    # Wait for readiness
    wait_for_services
    
    # Health checks
    run_health_checks
    
    # Show information
    show_urls
    
    success "Startup completed successfully!"
}

# Handle script arguments
case "${1:-}" in
    "logging")
        main "logging"
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [logging]"
        echo
        echo "Options:"
        echo "  logging    Start with ELK logging stack"
        echo "  help       Show this help message"
        exit 0
        ;;
    *)
        main
        ;;
esac 