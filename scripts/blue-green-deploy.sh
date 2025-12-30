#!/bin/bash

# Blue-Green Deployment Script
# Provides zero-downtime deployments by switching between blue and green environments

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NGINX_CONFIG="/etc/nginx/sites-available/hummytummy.com"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to get current active environment
get_active_env() {
    if grep -q "proxy_pass http://backend_blue" "$NGINX_CONFIG"; then
        echo "blue"
    elif grep -q "proxy_pass http://backend_green" "$NGINX_CONFIG"; then
        echo "green"
    else
        echo "blue"  # default
    fi
}

# Function to get inactive environment
get_inactive_env() {
    local active=$(get_active_env)
    if [ "$active" == "blue" ]; then
        echo "green"
    else
        echo "blue"
    fi
}

# Function to check if environment is healthy
check_health() {
    local env=$1
    local port

    if [ "$env" == "blue" ]; then
        port=3000
    else
        port=3001
    fi

    log "Checking health of $env environment on port $port..."

    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if curl -sf "http://localhost:$port/api/health" > /dev/null 2>&1; then
            success "$env environment is healthy"
            return 0
        fi

        attempt=$((attempt + 1))
        log "Health check attempt $attempt/$max_attempts..."
        sleep 2
    done

    error "$env environment health check failed after $max_attempts attempts"
    return 1
}

# Function to switch nginx upstream
switch_nginx() {
    local target_env=$1
    log "Switching nginx to $target_env environment..."

    # Backup current config
    cp "$NGINX_CONFIG" "$NGINX_CONFIG.backup"

    # Update proxy_pass to point to new environment
    if [ "$target_env" == "blue" ]; then
        # Switch backend from 3001 (green) to 3000 (blue)
        sed -i 's/proxy_pass http:\/\/localhost:3001/proxy_pass http:\/\/localhost:3000/g' "$NGINX_CONFIG"
        # Switch frontend from 8081 (green) to 8080 (blue)
        sed -i 's/proxy_pass http:\/\/localhost:8081/proxy_pass http:\/\/localhost:8080/g' "$NGINX_CONFIG"
    else
        # Switch backend from 3000 (blue) to 3001 (green)
        sed -i 's/proxy_pass http:\/\/localhost:3000/proxy_pass http:\/\/localhost:3001/g' "$NGINX_CONFIG"
        # Switch frontend from 8080 (blue) to 8081 (green)
        sed -i 's/proxy_pass http:\/\/localhost:8080/proxy_pass http:\/\/localhost:8081/g' "$NGINX_CONFIG"
    fi

    # Test nginx configuration
    if ! nginx -t > /dev/null 2>&1; then
        error "Nginx configuration test failed"
        cp "$NGINX_CONFIG.backup" "$NGINX_CONFIG"
        return 1
    fi

    # Reload nginx
    systemctl reload nginx

    success "Nginx switched to $target_env environment"
    return 0
}

# Main deployment function
deploy() {
    log "=== Starting Blue-Green Deployment ==="

    # Get current state
    local active_env=$(get_active_env)
    local inactive_env=$(get_inactive_env)

    log "Active environment: $active_env"
    log "Deploying to: $inactive_env"

    # Set port for inactive environment
    local inactive_port
    if [ "$inactive_env" == "blue" ]; then
        inactive_port=3000
    else
        inactive_port=3001
    fi

    # Stop inactive environment containers if running
    log "Stopping $inactive_env environment..."
    docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" stop backend-$inactive_env frontend-$inactive_env 2>/dev/null || true

    # Build new images
    log "Building $inactive_env environment..."
    docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" build backend-$inactive_env frontend-$inactive_env

    # Start inactive environment
    log "Starting $inactive_env environment..."
    docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" up -d backend-$inactive_env frontend-$inactive_env

    # Wait for services to be ready
    log "Waiting for $inactive_env environment to be ready..."
    sleep 10

    # Run database migrations on inactive environment with baseline support
    log "Running database migrations..."
    MIGRATION_OUTPUT=$(docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" exec -T backend-$inactive_env npx prisma migrate deploy 2>&1) && {
        log "Migrations applied successfully"
    } || {
        if echo "$MIGRATION_OUTPUT" | grep -q "P3005"; then
            log "Baseline required - marking existing migrations as applied..."
            # Get list of migrations and mark them as applied
            for migration in $(ls -1 "$PROJECT_ROOT/backend/prisma/migrations" | grep -E '^[0-9]+' | sort); do
                log "Marking migration $migration as applied..."
                docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" exec -T backend-$inactive_env npx prisma migrate resolve --applied "$migration" || true
            done
            # Retry migration deploy
            log "Retrying migration deploy..."
            docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" exec -T backend-$inactive_env npx prisma migrate deploy || {
                error "Database migration failed after baseline: $MIGRATION_OUTPUT"
                return 1
            }
            log "Migrations applied successfully after baseline"
        else
            error "Database migration failed: $MIGRATION_OUTPUT"
            return 1
        fi
    }

    # Health check
    if ! check_health "$inactive_env"; then
        error "Health check failed for $inactive_env environment"
        log "Keeping $active_env environment active"
        docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" stop backend-$inactive_env frontend-$inactive_env
        return 1
    fi

    # Switch traffic to new environment
    if ! switch_nginx "$inactive_env"; then
        error "Failed to switch nginx"
        docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" stop backend-$inactive_env frontend-$inactive_env
        return 1
    fi

    # Verify new environment is serving traffic
    log "Verifying new environment is serving traffic..."
    sleep 3
    if ! curl -sf "https://hummytummy.com/api/health" > /dev/null 2>&1; then
        error "New environment is not serving traffic correctly"
        log "Rolling back to $active_env..."
        switch_nginx "$active_env"
        return 1
    fi

    success "Deployment successful! $inactive_env is now active"

    # Stop old environment after successful switch
    log "Stopping old $active_env environment..."
    docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" stop backend-$active_env frontend-$active_env

    # Show status
    log "=== Deployment Complete ==="
    log "Active environment: $inactive_env"
    log "Inactive environment: $active_env"

    # Clean up backup
    rm -f "$NGINX_CONFIG.backup"

    return 0
}

# Rollback function
rollback() {
    log "=== Starting Rollback ==="

    local active_env=$(get_active_env)
    local inactive_env=$(get_inactive_env)

    log "Current active: $active_env"
    log "Rolling back to: $inactive_env"

    # Start old environment
    log "Starting $inactive_env environment..."
    docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" up -d backend-$inactive_env frontend-$inactive_env

    sleep 10

    # Check if old environment is healthy
    if ! check_health "$inactive_env"; then
        error "Old environment is not healthy. Cannot rollback."
        return 1
    fi

    # Switch traffic back
    if ! switch_nginx "$inactive_env"; then
        error "Failed to switch nginx during rollback"
        return 1
    fi

    success "Rollback successful! $inactive_env is now active"

    # Stop failed environment
    docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" stop backend-$active_env frontend-$active_env

    return 0
}

# Show status
status() {
    local active_env=$(get_active_env)
    local inactive_env=$(get_inactive_env)

    log "=== Blue-Green Deployment Status ==="
    log "Active environment: $active_env"
    log "Inactive environment: $inactive_env"
    echo ""

    log "Container status:"
    docker compose -f "$PROJECT_ROOT/docker-compose.prod.yml" ps

    echo ""
    log "Nginx upstream configuration:"
    grep -A 2 "location /api" "$NGINX_CONFIG" | grep proxy_pass || echo "Not found"
}

# Main script logic
case "${1:-}" in
    deploy)
        deploy
        ;;
    rollback)
        rollback
        ;;
    status)
        status
        ;;
    *)
        echo "Usage: $0 {deploy|rollback|status}"
        echo ""
        echo "Commands:"
        echo "  deploy   - Deploy to inactive environment and switch traffic"
        echo "  rollback - Switch traffic back to previous environment"
        echo "  status   - Show current deployment status"
        exit 1
        ;;
esac

exit $?
