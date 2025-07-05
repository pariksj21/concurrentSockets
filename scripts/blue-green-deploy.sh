#!/bin/bash
set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
HEALTH_CHECK_TIMEOUT=60
HEALTH_CHECK_INTERVAL=5
MAX_HEALTH_CHECKS=12

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to get current active environment
get_current_environment() {
    # Check which container is currently enabled in Traefik
    local blue_running=false
    local green_running=false
    local blue_enabled=false
    local green_enabled=false
    
    # Check if containers are running
    if docker ps --filter "name=websocket-blue" --filter "status=running" --format "{{.Names}}" | grep -q "websocket-blue"; then
        blue_running=true
        if docker inspect websocket-blue | grep -q '"traefik.enable": "true"'; then
            blue_enabled=true
        fi
    fi
    
    if docker ps --filter "name=websocket-green" --filter "status=running" --format "{{.Names}}" | grep -q "websocket-green"; then
        green_running=true
        if docker inspect websocket-green | grep -q '"traefik.enable": "true"'; then
            green_enabled=true
        fi
    fi
    
    # Determine active environment based on what's enabled in Traefik
    if [ "$blue_enabled" = true ] && [ "$green_enabled" = true ]; then
        # Both enabled - this shouldn't happen in normal operation
        echo "both"
    elif [ "$blue_enabled" = true ]; then
        echo "blue"
    elif [ "$green_enabled" = true ]; then
        echo "green"
    elif [ "$blue_running" = true ]; then
        # Blue is running but not enabled - assume it should be active
        echo "blue"
    elif [ "$green_running" = true ]; then
        # Green is running but not enabled - assume it should be active
        echo "green"
    else
        # No containers running - default to blue
        echo "blue"
    fi
}

# Function to check if container is running
is_container_running() {
    local container_name=$1
    docker ps --filter "name=$container_name" --filter "status=running" --format "{{.Names}}" | grep -q "^$container_name$"
}

# Function to check health of a service via internal network
check_internal_health() {
    local container_name=$1
    local max_attempts=$2
    local interval=$3
    
    log "Checking internal health of $container_name..."
    
    for ((i=1; i<=max_attempts; i++)); do
        if docker exec "$container_name" wget --quiet --tries=1 --spider http://0.0.0.0:3001/health 2>/dev/null; then
            success "Internal health check passed on attempt $i"
            return 0
        else
            warning "Internal health check failed on attempt $i/$max_attempts"
            if [ $i -lt $max_attempts ]; then
                sleep $interval
            fi
        fi
    done
    
    error "Internal health check failed after $max_attempts attempts"
    return 1
}

# Function to check health of a service
check_health() {
    local service_url=$1
    local max_attempts=$2
    local interval=$3
    
    log "Checking health of $service_url..."
    
    for ((i=1; i<=max_attempts; i++)); do
        if curl -f -s "$service_url/health" > /dev/null 2>&1; then
            success "Health check passed on attempt $i"
            return 0
        else
            warning "Health check failed on attempt $i/$max_attempts"
            if [ $i -lt $max_attempts ]; then
                sleep $interval
            fi
        fi
    done
    
    error "Health check failed after $max_attempts attempts"
    return 1
}

# Function to switch Traefik routing
switch_traefik_routing() {
    local new_environment=$1
    local old_environment=$2
    
    log "Switching Traefik routing to $new_environment environment..."
    
    # First, enable new environment in Traefik using environment variables
    log "Enabling $new_environment environment in Traefik..."
    if [ "$new_environment" = "green" ]; then
        # Enable green, keep blue enabled temporarily for overlap
        export GREEN_ENABLED=true
        export BLUE_ENABLED=true
        docker compose --profile green up -d --force-recreate websocket-green
    else
        # Enable blue, keep green enabled temporarily for overlap
        export BLUE_ENABLED=true
        export GREEN_ENABLED=true
        docker compose up -d --force-recreate websocket-blue
    fi
    
    # Wait for Traefik to update its configuration
    log "Waiting for Traefik to update configuration..."
    sleep 10
    
    # Verify the new environment is receiving traffic successfully
    local retry_count=0
    local max_retries=5
    
    while [ $retry_count -lt $max_retries ]; do
        if check_health "http://localhost" 3 2; then
            success "New environment $new_environment is ready and receiving traffic"
            break
        else
            retry_count=$((retry_count + 1))
            log "Health check failed, retrying... ($retry_count/$max_retries)"
            sleep 5
        fi
    done
    
    if [ $retry_count -ge $max_retries ]; then
        error "Failed to switch Traefik routing after $max_retries attempts"
        return 1
    fi
    
    # Now that new environment is confirmed working, disable old environment
    if [ "$old_environment" != "unknown" ] && [ "$old_environment" != "$new_environment" ]; then
        log "Disabling $old_environment environment in Traefik..."
        if [ "$old_environment" = "blue" ]; then
            export BLUE_ENABLED=false
            docker compose up -d --force-recreate websocket-blue
        else
            export GREEN_ENABLED=false
            docker compose --profile green up -d --force-recreate websocket-green
        fi
        
        # Wait a bit for connections to drain to new environment
        log "Waiting for traffic to drain from $old_environment..."
        sleep 15
        
        # Verify traffic is still flowing after disabling old environment
        if check_health "http://localhost" 3 2; then
            success "Traffic successfully switched to $new_environment"
            return 0
        else
            error "Traffic switch failed, rolling back..."
            # Emergency rollback - re-enable old environment
            if [ "$old_environment" = "blue" ]; then
                export BLUE_ENABLED=true
                export GREEN_ENABLED=false
                docker compose up -d --force-recreate websocket-blue
                docker compose --profile green stop websocket-green
            else
                export GREEN_ENABLED=true
                export BLUE_ENABLED=false
                docker compose --profile green up -d --force-recreate websocket-green
                docker compose stop websocket-blue
            fi
            return 1
        fi
    fi
    
    success "Traefik routing switched successfully to $new_environment"
    return 0
}

# Function to deploy to environment
deploy_to_environment() {
    local target_env=$1
    local container_name="websocket-$target_env"
    
    log "Starting deployment to $target_env environment..."
    
    # Build and start the new container
    log "Building and starting $container_name container..."
    
    if [ "$target_env" = "green" ]; then
        docker compose --profile green up -d websocket-green
    else
        docker compose up -d websocket-blue
    fi
    
    if [ $? -ne 0 ]; then
        error "Failed to start $container_name container"
        return 1
    fi
    
    # Wait for container to be ready
    log "Waiting for $container_name to be ready..."
    sleep 10
    
    # Check if container is running
    if ! is_container_running "$container_name"; then
        error "$container_name is not running"
        return 1
    fi
    
    # Health check using internal network
    if ! check_internal_health "$container_name" $MAX_HEALTH_CHECKS $HEALTH_CHECK_INTERVAL; then
        error "Health check failed for $container_name"
        return 1
    fi
    
    success "$target_env environment deployed successfully"
    return 0
}

# Function to perform load test
run_load_test() {
    local target_env=$1
    
    log "Running load test against $target_env environment through Traefik..."
    
    # The target environment should already be running and accessible
    # We'll test it by temporarily enabling it in Traefik
    log "Testing $target_env environment through Traefik..."
    
    # Simple load test using curl through Traefik
    local failed_requests=0
    local total_requests=50
    
    for ((i=1; i<=total_requests; i++)); do
        # Test the container directly through Docker network
        if ! docker exec "websocket-$target_env" wget --quiet --tries=1 --spider http://0.0.0.0:3001/health 2>/dev/null; then
            ((failed_requests++))
        fi
        sleep 0.1
    done
    
    local success_rate=$(( (total_requests - failed_requests) * 100 / total_requests ))
    
    log "Load test completed: $success_rate% success rate ($((total_requests - failed_requests))/$total_requests)"
    
    if [ $success_rate -ge 95 ]; then
        success "Load test passed"
        return 0
    else
        error "Load test failed (success rate: $success_rate%)"
        return 1
    fi
}

# Function to gracefully drain connections
drain_connections() {
    local old_env=$1
    local container_name="websocket-$old_env"
    
    log "Draining connections from $old_env environment..."
    
    # Check if container is still running
    if ! is_container_running "$container_name"; then
        log "$old_env environment is already stopped"
        return 0
    fi
    
    # Send SIGTERM to gracefully shutdown
    log "Sending graceful shutdown signal to $container_name..."
    docker kill --signal=SIGTERM "$container_name" 2>/dev/null || true
    
    # Wait for graceful shutdown with longer timeout for WebSocket connections
    local wait_time=60
    log "Waiting ${wait_time}s for graceful shutdown of WebSocket connections..."
    
    local elapsed=0
    while [ $elapsed -lt $wait_time ]; do
        if ! is_container_running "$container_name"; then
            success "Container $container_name shut down gracefully"
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
        log "Waiting for graceful shutdown... ${elapsed}s/${wait_time}s"
    done
    
    # Force stop if still running
    if is_container_running "$container_name"; then
        warning "Container still running after ${wait_time}s, forcing stop..."
        docker stop "$container_name"
        if [ $? -eq 0 ]; then
            success "Container $container_name stopped"
        else
            error "Failed to stop container $container_name"
            return 1
        fi
    fi
    
    success "Connections drained from $old_env environment"
    return 0
}

# Function to rollback deployment
rollback() {
    local current_env=$1
    local previous_env=$2
    
    error "Rolling back deployment..."
    
    # Switch back to previous environment
    if switch_traefik_routing "$previous_env" "$current_env"; then
        success "Rollback completed successfully"
        
        # Start previous environment if not running
        if ! is_container_running "websocket-$previous_env"; then
            log "Starting previous environment container..."
            if [ "$previous_env" = "green" ]; then
                docker compose --profile green up -d websocket-green
            else
                docker compose up -d websocket-blue
            fi
        fi
        
        return 0
    else
        error "Rollback failed"
        return 1
    fi
}

# Main deployment function
main() {
    local target_env=$1
    
    if [ -z "$target_env" ]; then
        echo "Usage: $0 [blue|green]"
        exit 1
    fi
    
    if [ "$target_env" != "blue" ] && [ "$target_env" != "green" ]; then
        error "Invalid environment. Use 'blue' or 'green'"
        exit 1
    fi
    
    # Get current environment
    local current_env=$(get_current_environment)
    log "Current active environment: $current_env"
    log "Target environment: $target_env"
    
    if [ "$current_env" = "$target_env" ]; then
        warning "Target environment is already active"
        exit 0
    fi
    
    # Ensure we're in the project directory
    cd "$PROJECT_DIR"
    
    # Deploy to target environment
    if ! deploy_to_environment "$target_env"; then
        error "Deployment failed"
        exit 1
    fi
    
    # Run load test against new environment
    if ! run_load_test "$target_env"; then
        error "Load test failed, rolling back..."
        rollback "$target_env" "$current_env"
        exit 1
    fi
    
    # Switch traffic to new environment
    if ! switch_traefik_routing "$target_env" "$current_env"; then
        error "Failed to switch traffic, rolling back..."
        rollback "$target_env" "$current_env"
        exit 1
    fi
    
    # Verify switch was successful
    sleep 5
    if ! check_health "http://localhost" 3 2; then
        error "Health check failed after switch, rolling back..."
        rollback "$target_env" "$current_env"
        exit 1
    fi
    
    # Drain connections from old environment
    if [ "$current_env" != "unknown" ]; then
        drain_connections "$current_env"
    fi
    
    success "Blue-green deployment completed successfully!"
    log "Active environment: $target_env"
    log "Previous environment: $current_env (stopped)"
}

# Run main function
main "$@" 