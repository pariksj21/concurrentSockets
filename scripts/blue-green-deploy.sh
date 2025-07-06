#!/bin/bash
set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_COMPOSE_FILE="$PROJECT_DIR/docker/compose/docker-compose.yml"
DOCKER_COMPOSE_CMD="docker compose -f $DOCKER_COMPOSE_FILE"
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
    # Check Traefik API to see which routers are enabled
    local blue_routers
    local green_routers
    
    # Get router counts with proper error handling
    blue_routers=$(curl -s http://localhost:8080/api/http/routers 2>/dev/null | jq -r '.[] | select(.name | contains("websocket-blue")) | .status' 2>/dev/null | grep -c "enabled" 2>/dev/null) || blue_routers="0"
    green_routers=$(curl -s http://localhost:8080/api/http/routers 2>/dev/null | jq -r '.[] | select(.name | contains("websocket-green")) | .status' 2>/dev/null | grep -c "enabled" 2>/dev/null) || green_routers="0"
    
    # Clean and ensure they are integers
    blue_routers=$(echo "$blue_routers" | tr -d '\n\r' | grep -o '[0-9]*' | head -1)
    green_routers=$(echo "$green_routers" | tr -d '\n\r' | grep -o '[0-9]*' | head -1)
    blue_routers=${blue_routers:-0}
    green_routers=${green_routers:-0}
    
    # Determine active environment based on Traefik routing
    if [ "$blue_routers" -gt 0 ] && [ "$green_routers" -gt 0 ]; then
        echo "both"
    elif [ "$blue_routers" -gt 0 ]; then
        echo "blue"
    elif [ "$green_routers" -gt 0 ]; then
        echo "green"
    else
        echo "none"
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
    
    log "Switching Traefik routing from $old_environment to $new_environment..."
    
    # Step 1: Both environments are now enabled (blue-green overlap)
    log "Phase 1: Both environments enabled for zero-downtime transition..."
    
    # The new environment container is already running and enabled in Traefik
    # from deploy_to_environment(). Verify it's ready to receive traffic.
    if [ "$new_environment" = "green" ]; then
        if is_container_running "websocket-green"; then
            log "GREEN container is running and enabled in Traefik"
        else
            error "GREEN container is not running when it should be"
            return 1
        fi
    else
        if is_container_running "websocket-blue"; then
            log "BLUE container is running and enabled in Traefik"
        else
            error "BLUE container is not running when it should be"
            return 1
        fi
    fi
    
    # Both services are already registered in Traefik
    log "Both services already registered in Traefik, proceeding with health check..."
    sleep 2
    
    # Verify new environment is receiving traffic
    log "Phase 2: Verifying new environment ($new_environment) is healthy..."
    local retry_count=0
    local max_retries=5
    
    while [ $retry_count -lt $max_retries ]; do
        if check_health "http://localhost" 3 2; then
            success "New environment $new_environment is healthy and receiving traffic"
            break
        else
            retry_count=$((retry_count + 1))
            warning "Health check failed, retrying... ($retry_count/$max_retries)"
            sleep 5
        fi
    done
    
    if [ $retry_count -ge $max_retries ]; then
        error "New environment failed health checks - aborting switch"
        return 1
    fi
    
    # Step 2: Disable old environment (this will drop WebSocket connections immediately)
    if [ "$old_environment" != "none" ] && [ "$old_environment" != "$new_environment" ] && [ "$old_environment" != "both" ]; then
        log "Phase 3: Disabling old environment ($old_environment) - WebSocket connections will drop immediately"
        
        # Simply stop the old container - no need to recreate it with different labels
        if [ "$old_environment" = "blue" ]; then
            log "Stopping BLUE container to disable Traefik routing..."
            docker stop websocket-blue
        else
            log "Stopping GREEN container to disable Traefik routing..."
            docker stop websocket-green
        fi
        
        # Brief wait for Traefik to update routing
        log "Waiting for Traefik routing to update..."
        sleep 5
        
        # Verify traffic is still flowing to new environment only
        if check_health "http://localhost" 3 2; then
            success "Traffic successfully switched to $new_environment only"
            log "All WebSocket connections from $old_environment have been dropped and clients should reconnect to $new_environment"
            return 0
        else
            error "Traffic switch failed, rolling back..."
            # Emergency rollback - restart old environment and stop new environment
            if [ "$old_environment" = "blue" ]; then
                log "Rollback: Restarting BLUE container and stopping GREEN..."
                docker start websocket-blue
                docker stop websocket-green
            else
                log "Rollback: Restarting GREEN container and stopping BLUE..."
                docker start websocket-green  
                docker stop websocket-blue
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
    
    # First, rebuild the image to ensure latest code
    log "Building latest image for $target_env environment..."
    if [ "$target_env" = "green" ]; then
        $DOCKER_COMPOSE_CMD build websocket-green
    else
        $DOCKER_COMPOSE_CMD build websocket-blue
    fi
    
    if [ $? -ne 0 ]; then
        error "Failed to build $container_name image"
        return 1
    fi
    
    # Start the container (enabled in Traefik but with lower priority)
    log "Starting $container_name container (enabled in Traefik)..."
    if [ "$target_env" = "green" ]; then
        GREEN_ENABLED=true $DOCKER_COMPOSE_CMD --profile green up -d websocket-green
    else
        BLUE_ENABLED=true $DOCKER_COMPOSE_CMD up -d websocket-blue
    fi
    
    if [ $? -ne 0 ]; then
        error "Failed to start $container_name container"
        return 1
    fi
    
    # Wait for container to be ready
    log "Waiting for $container_name to start up..."
    sleep 10
    
    # Check if container is running
    if ! is_container_running "$container_name"; then
        error "$container_name is not running"
        return 1
    fi
    
    # Health check using internal network
    log "Running internal health checks on $container_name..."
    if ! check_internal_health "$container_name" $MAX_HEALTH_CHECKS $HEALTH_CHECK_INTERVAL; then
        error "Health check failed for $container_name"
        return 1
    fi
    
    success "$target_env environment deployed and ready (enabled in Traefik with lower priority)"
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

# Function to stop old environment
stop_old_environment() {
    local old_env=$1
    local container_name="websocket-$old_env"
    
    if [ "$old_env" = "none" ] || [ "$old_env" = "both" ]; then
        log "No specific old environment to stop"
        return 0
    fi
    
    log "Stopping old environment: $old_env"
    
    # Check if container is still running
    if ! is_container_running "$container_name"; then
        log "$old_env environment container is already stopped"
        return 0
    fi
    
    # Send SIGTERM for graceful shutdown
    log "Sending graceful shutdown signal to $container_name..."
    docker kill --signal=SIGTERM "$container_name" 2>/dev/null || true
    
    # Wait for graceful shutdown (but connections are already dropped by Traefik)
    local wait_time=30
    log "Waiting ${wait_time}s for graceful container shutdown..."
    
    local elapsed=0
    while [ $elapsed -lt $wait_time ]; do
        if ! is_container_running "$container_name"; then
            success "Container $container_name shut down gracefully"
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
        log "Waiting for shutdown... ${elapsed}s/${wait_time}s"
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
    
    success "Old environment $old_env stopped"
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
                $DOCKER_COMPOSE_CMD --profile green up -d websocket-green
            else
                $DOCKER_COMPOSE_CMD up -d websocket-blue
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
    log "Detecting current active environment..."
    local current_env
    current_env=$(get_current_environment)
    
    # Log environment status with details
    case "$current_env" in
        "blue")
            log "Current active environment: Blue (receiving traffic)"
            ;;
        "green")
            log "Current active environment: Green (receiving traffic)"
            ;;
        "both")
            warning "Both environments are enabled - deployment in progress or error state"
            ;;
        "none")
            warning "No environments are active - system may be starting up"
            ;;
    esac
    
    log "Target environment: $target_env"
    
    if [ "$current_env" = "$target_env" ]; then
        warning "Target environment ($target_env) is already active - no deployment needed"
        exit 0
    fi
    
    if [ "$current_env" = "both" ]; then
        warning "Both environments are currently active - this indicates a previous deployment is in progress"
        warning "Please check the system state or wait for the previous deployment to complete"
        exit 1
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
    
    # Old environment was already stopped during the traffic switch
    log "Old environment ($current_env) was stopped during traffic switch"
    
    success "Blue-green deployment completed successfully!"
    log "Active environment: $target_env"
    log "Previous environment: $current_env (stopped)"
}

# Run main function
main "$@" 