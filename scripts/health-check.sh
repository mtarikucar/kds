#!/bin/bash

# Comprehensive Health Check Script
# Checks API health, database connectivity, Redis, and services status

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
API_URL="${API_URL:-https://hummytummy.com/api}"
MAX_RESPONSE_TIME=5000  # milliseconds
TIMEOUT=10  # seconds

# Counters
PASSED=0
FAILED=0
WARNINGS=0

log() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[✓]${NC} $1"
    PASSED=$((PASSED + 1))
}

error() {
    echo -e "${RED}[✗]${NC} $1"
    FAILED=$((FAILED + 1))
}

warning() {
    echo -e "${YELLOW}[!]${NC} $1"
    WARNINGS=$((WARNINGS + 1))
}

# Function to check API endpoint
check_api() {
    log "Checking API health endpoint..."

    local start_time=$(date +%s%3N)
    local response=$(curl -s -w "\n%{http_code}\n%{time_total}" "$API_URL/health" --max-time $TIMEOUT 2>&1)
    local end_time=$(date +%s%3N)

    local http_code=$(echo "$response" | tail -2 | head -1)
    local response_time=$(echo "$response" | tail -1)
    local response_time_ms=$(echo "$response_time * 1000" | bc | cut -d. -f1)

    if [ "$http_code" == "200" ]; then
        success "API is responding (HTTP $http_code, ${response_time_ms}ms)"

        if [ "$response_time_ms" -gt "$MAX_RESPONSE_TIME" ]; then
            warning "Response time is slow (${response_time_ms}ms > ${MAX_RESPONSE_TIME}ms)"
        fi
    else
        error "API health check failed (HTTP $http_code)"
        return 1
    fi
}

# Function to check database
check_database() {
    log "Checking database connectivity..."

    local response=$(curl -s "$API_URL/health" --max-time $TIMEOUT 2>&1)

    # Validate JSON response before parsing
    if ! echo "$response" | jq -e . >/dev/null 2>&1; then
        warning "Health endpoint returned invalid JSON response"
        return 0
    fi

    if echo "$response" | jq -e '.database' >/dev/null 2>&1; then
        local db_status=$(echo "$response" | jq -r '.database // "unknown"')

        if [ "$db_status" == "connected" ] || [ "$db_status" == "ok" ]; then
            success "Database is connected"
        else
            error "Database connection issue: $db_status"
            return 1
        fi
    else
        warning "Cannot determine database status from health endpoint"
    fi
}

# Function to check Redis
check_redis() {
    log "Checking Redis connectivity..."

    local response=$(curl -s "$API_URL/health" --max-time $TIMEOUT 2>&1)

    # Validate JSON response before parsing
    if ! echo "$response" | jq -e . >/dev/null 2>&1; then
        warning "Health endpoint returned invalid JSON response"
        return 0
    fi

    if echo "$response" | jq -e '.redis' >/dev/null 2>&1; then
        local redis_status=$(echo "$response" | jq -r '.redis // "unknown"')

        if [ "$redis_status" == "connected" ] || [ "$redis_status" == "ok" ]; then
            success "Redis is connected"
        else
            warning "Redis connection issue: $redis_status"
        fi
    else
        log "Redis status not available in health endpoint"
    fi
}

# Function to check Docker containers
check_containers() {
    log "Checking Docker containers..."

    local containers=$(docker compose -f /root/kds/docker-compose.prod.yml ps -q 2>/dev/null)

    if [ -z "$containers" ]; then
        error "No Docker containers are running"
        return 1
    fi

    local running_count=0
    local total_count=0

    while IFS= read -r container; do
        total_count=$((total_count + 1))
        local status=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null)

        if [ "$status" == "running" ]; then
            running_count=$((running_count + 1))
        fi
    done <<< "$containers"

    if [ "$running_count" -eq "$total_count" ]; then
        success "All Docker containers are running ($running_count/$total_count)"
    elif [ "$running_count" -gt 0 ]; then
        warning "Some containers are not running ($running_count/$total_count)"
    else
        error "No containers are running"
        return 1
    fi
}

# Function to check SSL certificate
check_ssl() {
    log "Checking SSL certificate..."

    local cert_info=$(echo | openssl s_client -servername hummytummy.com -connect hummytummy.com:443 2>/dev/null | openssl x509 -noout -dates 2>/dev/null)

    if [ -n "$cert_info" ]; then
        local expiry_date=$(echo "$cert_info" | grep "notAfter" | cut -d= -f2)
        local expiry_epoch=$(date -d "$expiry_date" +%s)
        local current_epoch=$(date +%s)
        local days_until_expiry=$(( ($expiry_epoch - $current_epoch) / 86400 ))

        if [ "$days_until_expiry" -gt 30 ]; then
            success "SSL certificate is valid (expires in $days_until_expiry days)"
        elif [ "$days_until_expiry" -gt 0 ]; then
            warning "SSL certificate expires soon ($days_until_expiry days)"
        else
            error "SSL certificate has expired!"
            return 1
        fi
    else
        error "Cannot retrieve SSL certificate information"
        return 1
    fi
}

# Function to check disk space
check_disk_space() {
    log "Checking disk space..."

    local usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')

    if [ "$usage" -lt 80 ]; then
        success "Disk space is healthy (${usage}% used)"
    elif [ "$usage" -lt 90 ]; then
        warning "Disk space is getting high (${usage}% used)"
    else
        error "Disk space is critical (${usage}% used)"
        return 1
    fi
}

# Function to check memory usage
check_memory() {
    log "Checking memory usage..."

    local mem_info=$(free | grep Mem)
    local total=$(echo "$mem_info" | awk '{print $2}')
    local used=$(echo "$mem_info" | awk '{print $3}')
    local usage=$(echo "scale=0; $used * 100 / $total" | bc)

    if [ "$usage" -lt 80 ]; then
        success "Memory usage is healthy (${usage}%)"
    elif [ "$usage" -lt 90 ]; then
        warning "Memory usage is high (${usage}%)"
    else
        error "Memory usage is critical (${usage}%)"
        return 1
    fi
}

# Function to check Nginx
check_nginx() {
    log "Checking Nginx status..."

    if systemctl is-active --quiet nginx; then
        success "Nginx is running"

        # Test configuration
        if nginx -t > /dev/null 2>&1; then
            success "Nginx configuration is valid"
        else
            error "Nginx configuration has errors"
            return 1
        fi
    else
        error "Nginx is not running"
        return 1
    fi
}

# Main health check
main() {
    echo ""
    log "=== Starting Comprehensive Health Check ==="
    log "Target: $API_URL"
    log "Time: $(date)"
    echo ""

    # Run all checks
    check_api || true
    check_database || true
    check_redis || true
    check_containers || true
    check_ssl || true
    check_disk_space || true
    check_memory || true
    check_nginx || true

    # Summary
    echo ""
    log "=== Health Check Summary ==="
    success "Passed: $PASSED"

    if [ "$WARNINGS" -gt 0 ]; then
        warning "Warnings: $WARNINGS"
    fi

    if [ "$FAILED" -gt 0 ]; then
        error "Failed: $FAILED"
    fi

    echo ""

    # Exit code based on results
    if [ "$FAILED" -gt 0 ]; then
        error "Health check failed!"
        exit 1
    elif [ "$WARNINGS" -gt 0 ]; then
        warning "Health check passed with warnings"
        exit 0
    else
        success "All health checks passed!"
        exit 0
    fi
}

# Handle arguments
case "${1:-}" in
    api)
        check_api
        ;;
    database)
        check_database
        ;;
    redis)
        check_redis
        ;;
    containers)
        check_containers
        ;;
    ssl)
        check_ssl
        ;;
    nginx)
        check_nginx
        ;;
    *)
        main
        ;;
esac
