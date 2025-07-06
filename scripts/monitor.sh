#!/bin/bash

# WebSocket Server Monitoring Script
# Tails container logs for ERROR and prints top-5 metrics every 10s

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
METRICS_URL="http://localhost/metrics"
LOG_TAIL_LINES=50
METRICS_INTERVAL=10
LOG_MONITOR_PID=""

# Logging functions
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

info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

# Function to check if required tools are available
check_dependencies() {
    local missing_deps=()
    
    if ! command -v docker &> /dev/null; then
        missing_deps+=("docker")
    fi
    
    if ! command -v curl &> /dev/null; then
        missing_deps+=("curl")
    fi
    
    if ! command -v grep &> /dev/null; then
        missing_deps+=("grep")
    fi
    
    if ! command -v awk &> /dev/null; then
        missing_deps+=("awk")
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        error "Missing required dependencies: ${missing_deps[*]}"
        echo "Please install the missing tools and try again."
        exit 1
    fi
}

# Function to get active WebSocket container
get_active_container() {
    local containers=($(docker ps --filter "name=websocket-" --format "{{.Names}}" 2>/dev/null))
    
    if [ ${#containers[@]} -eq 0 ]; then
        echo ""
        return 1
    fi
    
    # Return the first running container
    echo "${containers[0]}"
    return 0
}

# Function to tail logs for errors and important events
tail_error_logs() {
    local container_name=$1
    
    if [ -z "$container_name" ]; then
        warning "No active WebSocket container found for log monitoring"
        return 1
    fi
    
    info "Monitoring logs from container: $container_name"
    
    # Tail logs and filter for ERROR and important events
    (docker logs -f --tail="$LOG_TAIL_LINES" "$container_name" 2>&1 | \
    while IFS= read -r line; do
        # Show ERROR messages in red
        if echo "$line" | grep -i "error" >/dev/null 2>&1; then
            echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $line"
        # Show connection events in green
        elif echo "$line" | grep -E "(Connection opened|Connection closed)" >/dev/null 2>&1; then
            echo -e "${GREEN}[$(date '+%H:%M:%S')] CONN:${NC} $line"
        # Show SIGTERM/shutdown events in yellow
        elif echo "$line" | grep -E "(SIGTERM|SIGINT|shutdown|Exiting)" >/dev/null 2>&1; then
            echo -e "${YELLOW}[$(date '+%H:%M:%S')] SHUTDOWN:${NC} $line"
        # Show warning messages in yellow
        elif echo "$line" | grep -i "warn" >/dev/null 2>&1; then
            echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $line"
        fi
    done) &
    
    # Store the PID of the background process
    LOG_MONITOR_PID=$!
}

# Function to fetch and display top metrics
show_top_metrics() {
    local attempt=1
    local max_attempts=3
    
    while [ $attempt -le $max_attempts ]; do
        if metrics_data=$(curl -s "$METRICS_URL" 2>/dev/null); then
            break
        else
            if [ $attempt -eq $max_attempts ]; then
                warning "Failed to fetch metrics after $max_attempts attempts"
                return 1
            fi
            ((attempt++))
            sleep 1
        fi
    done
    
    echo -e "\n${CYAN}=== TOP 5 METRICS ($(date '+%H:%M:%S')) ===${NC}"
    
    # Extract and display key metrics
    echo "$metrics_data" | grep -E "^websocket_|^http_|^process_" | \
    grep -v "^#" | \
    head -20 | \
    while IFS= read -r line; do
        if [[ $line =~ ^([a-zA-Z_]+[a-zA-Z0-9_]*) ]]; then
            metric_name="${BASH_REMATCH[1]}"
            metric_value=$(echo "$line" | awk '{print $2}')
            
            # Color code based on metric type
            case $metric_name in
                *error*|*failed*)
                    echo -e "${RED}  $metric_name: $metric_value${NC}"
                    ;;
                *connection*|*message*)
                    echo -e "${GREEN}  $metric_name: $metric_value${NC}"
                    ;;
                *memory*|*cpu*)
                    echo -e "${YELLOW}  $metric_name: $metric_value${NC}"
                    ;;
                *)
                    echo -e "${CYAN}  $metric_name: $metric_value${NC}"
                    ;;
            esac
        fi
    done | head -5
    
    # Show connection summary
    local connections=$(echo "$metrics_data" | grep "^websocket_connections_active" | awk '{print $2}')
    local total_messages=$(echo "$metrics_data" | grep "^websocket_messages_total" | awk '{print $2}')
    local total_errors=$(echo "$metrics_data" | grep "^websocket_errors_total" | awk '{print $2}')
    
    echo -e "\n${CYAN}=== SUMMARY ===${NC}"
    echo -e "${GREEN}  Active Connections: ${connections:-0}${NC}"
    echo -e "${BLUE}  Total Messages: ${total_messages:-0}${NC}"
    echo -e "${RED}  Total Errors: ${total_errors:-0}${NC}"
    
    echo -e "${CYAN}==================${NC}\n"
}

# Function to show health status
show_health_status() {
    local health_data
    local readiness_data
    
    # Check liveness
    if health_data=$(curl -s "http://localhost/healthz" 2>/dev/null); then
        local status=$(echo "$health_data" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        if [ "$status" = "ok" ]; then
            echo -e "${GREEN}✓ Liveness: OK${NC}"
        else
            echo -e "${RED}✗ Liveness: $status${NC}"
        fi
    else
        echo -e "${RED}✗ Liveness: UNREACHABLE${NC}"
    fi
    
    # Check readiness
    if readiness_data=$(curl -s "http://localhost/readyz" 2>/dev/null); then
        local status=$(echo "$readiness_data" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        if [ "$status" = "ready" ]; then
            echo -e "${GREEN}✓ Readiness: READY${NC}"
        else
            local reason=$(echo "$readiness_data" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4)
            echo -e "${YELLOW}⚠ Readiness: $status ($reason)${NC}"
        fi
    else
        echo -e "${RED}✗ Readiness: UNREACHABLE${NC}"
    fi
}

# Function to handle cleanup on exit
cleanup() {
    log "Stopping monitoring..."
    # Kill background processes
    if [ -n "$LOG_MONITOR_PID" ]; then
        kill "$LOG_MONITOR_PID" 2>/dev/null || true
    fi
    jobs -p | xargs -r kill 2>/dev/null || true
    exit 0
}

# Main monitoring function
main() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                   WebSocket Server Monitor                   ║"
    echo "║                                                              ║"
    echo "║  • Tails logs for ERROR, WARN, and connection events        ║"
    echo "║  • Shows top-5 metrics every ${METRICS_INTERVAL}s                           ║"
    echo "║  • Displays health status                                   ║"
    echo "║  • Press Ctrl+C to stop                                     ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}\n"
    
    # Check dependencies
    check_dependencies
    
    # Set up signal handlers
    trap cleanup SIGINT SIGTERM
    
    # Get active container
    local container_name
    if ! container_name=$(get_active_container); then
        error "No active WebSocket containers found"
        echo "Please start the WebSocket server and try again."
        exit 1
    fi
    
    success "Found active container: $container_name"
    
    # Show initial health status
    show_health_status
    echo
    
    # Start log monitoring in background
    tail_error_logs "$container_name"
    
    # Main monitoring loop
    local iteration=0
    while true; do
        ((iteration++))
        
        # Show metrics every METRICS_INTERVAL seconds
        show_top_metrics
        
        # Show health status every 30 seconds
        if [ $((iteration % 3)) -eq 0 ]; then
            echo -e "${CYAN}=== HEALTH STATUS ===${NC}"
            show_health_status
            echo
        fi
        
        sleep "$METRICS_INTERVAL"
    done
}

# Handle command line arguments
case "${1:-}" in
    "help"|"-h"|"--help")
        echo "WebSocket Server Monitor"
        echo "========================"
        echo
        echo "Usage: $0 [options]"
        echo
        echo "Options:"
        echo "  help, -h, --help    Show this help message"
        echo "  test                Run a quick test of metrics endpoint"
        echo
        echo "This script monitors the WebSocket server by:"
        echo "  1. Tailing container logs for ERROR, WARN, and connection events"
        echo "  2. Fetching and displaying top-5 metrics every ${METRICS_INTERVAL}s"
        echo "  3. Showing health status periodically"
        echo
        echo "Requirements:"
        echo "  - Docker (for log access)"
        echo "  - curl (for metrics and health checks)"
        echo "  - Active WebSocket container"
        echo
        exit 0
        ;;
    "test")
        echo "Testing metrics endpoint..."
        check_dependencies
        if show_top_metrics; then
            success "Metrics endpoint is working!"
        else
            error "Metrics endpoint test failed"
            exit 1
        fi
        echo
        echo "Testing health endpoints..."
        show_health_status
        exit 0
        ;;
    "")
        main
        ;;
    *)
        error "Unknown option: $1"
        echo "Use '$0 help' for usage information."
        exit 1
        ;;
esac 