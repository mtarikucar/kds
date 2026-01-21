#!/bin/bash

# Simplified Production Deployment Script
# Usage: deploy-production.sh {deploy|rollback|status|backup}

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.production"
IMAGE_TAGS_FILE="$PROJECT_ROOT/.last-deployment-images"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

# Docker compose command
docker_compose() {
    docker compose --env-file "$ENV_FILE" -f "$PROJECT_ROOT/docker-compose.prod.yml" "$@"
}

# Save current image tags for rollback
save_image_tags() {
    log "Saving current image tags for rollback..."
    cat > "$IMAGE_TAGS_FILE" << EOF
BACKEND_IMAGE=$(docker inspect kds_backend_prod --format='{{.Config.Image}}' 2>/dev/null || echo "")
FRONTEND_IMAGE=$(docker inspect kds_frontend_prod --format='{{.Config.Image}}' 2>/dev/null || echo "")
LANDING_IMAGE=$(docker inspect kds_landing_prod --format='{{.Config.Image}}' 2>/dev/null || echo "")
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
EOF
}

# Health check with retries
health_check() {
    local max_attempts=${1:-30}
    local interval=${2:-2}
    local attempt=0

    log "Running health check (max $max_attempts attempts, ${interval}s interval)..."

    while [ $attempt -lt $max_attempts ]; do
        if curl -sf "http://localhost:3000/api/health" > /dev/null 2>&1; then
            success "Health check passed"
            return 0
        fi
        attempt=$((attempt + 1))
        log "Health check attempt $attempt/$max_attempts..."
        sleep $interval
    done

    error "Health check failed after $max_attempts attempts"
    return 1
}

# Database backup
backup() {
    log "=== Creating Database Backup ==="
    if [ -x "$SCRIPT_DIR/backup-database.sh" ]; then
        "$SCRIPT_DIR/backup-database.sh"
    else
        error "backup-database.sh not found or not executable"
        return 1
    fi
}

# Main deployment
deploy() {
    log "=== Starting Production Deployment ==="

    # Step 1: Create database backup
    log "Step 1/5: Creating database backup..."
    backup || {
        warning "Backup failed, but continuing with deployment..."
    }

    # Step 2: Save current image tags for potential rollback
    log "Step 2/5: Saving current state for rollback..."
    save_image_tags

    # Step 3: Run database migrations
    log "Step 3/5: Running database migrations..."

    # Ensure backend is running for migrations
    docker_compose up -d postgres redis
    sleep 5

    # Check if backend container exists and is running
    if docker ps --format '{{.Names}}' | grep -q "kds_backend_prod"; then
        MIGRATION_OUTPUT=$(docker_compose exec -T backend npx prisma migrate deploy 2>&1) && {
            log "Migrations applied successfully"
        } || {
            if echo "$MIGRATION_OUTPUT" | grep -q "P3005"; then
                log "Baseline required - marking existing migrations as applied..."
                for migration in $(ls -1 "$PROJECT_ROOT/backend/prisma/migrations" 2>/dev/null | grep -E '^[0-9]+' | sort); do
                    docker_compose exec -T backend npx prisma migrate resolve --applied "$migration" || true
                done
                docker_compose exec -T backend npx prisma migrate deploy || {
                    error "Migration failed: $MIGRATION_OUTPUT"
                    return 1
                }
            else
                warning "Migration output: $MIGRATION_OUTPUT"
            fi
        }
    else
        log "Backend not running, will run migrations after container start..."
    fi

    # Step 4: Update containers
    log "Step 4/5: Updating containers..."
    docker_compose pull --ignore-pull-failures 2>/dev/null || true
    docker_compose up -d --remove-orphans

    # Wait for containers to start
    log "Waiting for containers to initialize..."
    sleep 10

    # Run migrations if not done before
    if ! docker ps --format '{{.Names}}' | grep -q "kds_backend_prod"; then
        error "Backend container failed to start"
        rollback
        return 1
    fi

    # Step 5: Health check
    log "Step 5/5: Running health checks..."
    if ! health_check 30 2; then
        error "Health check failed, initiating rollback..."
        rollback
        return 1
    fi

    # Verify all services
    log "Verifying all services..."

    local all_healthy=true

    # Check frontend
    if ! curl -sf "http://localhost:8080" > /dev/null 2>&1; then
        warning "Frontend health check failed"
        all_healthy=false
    else
        success "Frontend is healthy"
    fi

    # Check landing
    if ! curl -sf "http://localhost:3100" > /dev/null 2>&1; then
        warning "Landing page health check failed"
        all_healthy=false
    else
        success "Landing is healthy"
    fi

    if [ "$all_healthy" = true ]; then
        success "=== Deployment Completed Successfully ==="
    else
        warning "=== Deployment completed with some services unhealthy ==="
    fi

    status
    return 0
}

# Rollback to previous images
rollback() {
    log "=== Starting Rollback ==="

    if [ ! -f "$IMAGE_TAGS_FILE" ]; then
        error "No previous deployment found. Cannot rollback."
        return 1
    fi

    source "$IMAGE_TAGS_FILE"

    if [ -z "$BACKEND_IMAGE" ] || [ -z "$FRONTEND_IMAGE" ] || [ -z "$LANDING_IMAGE" ]; then
        error "Previous image tags are incomplete. Cannot rollback."
        return 1
    fi

    log "Rolling back to images from $TIMESTAMP"
    log "  Backend:  $BACKEND_IMAGE"
    log "  Frontend: $FRONTEND_IMAGE"
    log "  Landing:  $LANDING_IMAGE"

    # Export for docker-compose
    export BACKEND_IMAGE
    export FRONTEND_IMAGE
    export LANDING_IMAGE

    # Restart with previous images
    docker_compose up -d --remove-orphans

    # Wait and health check
    sleep 10
    if health_check 20 2; then
        success "=== Rollback Completed Successfully ==="
    else
        error "=== Rollback completed but health check failed ==="
        return 1
    fi

    status
    return 0
}

# Show status
status() {
    log "=== Production Deployment Status ==="
    echo ""

    log "Container Status:"
    docker_compose ps
    echo ""

    log "Image Tags:"
    echo "  Backend:  $(docker inspect kds_backend_prod --format='{{.Config.Image}}' 2>/dev/null || echo 'N/A')"
    echo "  Frontend: $(docker inspect kds_frontend_prod --format='{{.Config.Image}}' 2>/dev/null || echo 'N/A')"
    echo "  Landing:  $(docker inspect kds_landing_prod --format='{{.Config.Image}}' 2>/dev/null || echo 'N/A')"
    echo ""

    log "Service Health:"
    echo -n "  Backend (3000):  "
    curl -sf "http://localhost:3000/api/health" > /dev/null 2>&1 && echo -e "${GREEN}Healthy${NC}" || echo -e "${RED}Unhealthy${NC}"
    echo -n "  Frontend (8080): "
    curl -sf "http://localhost:8080" > /dev/null 2>&1 && echo -e "${GREEN}Healthy${NC}" || echo -e "${RED}Unhealthy${NC}"
    echo -n "  Landing (3100):  "
    curl -sf "http://localhost:3100" > /dev/null 2>&1 && echo -e "${GREEN}Healthy${NC}" || echo -e "${RED}Unhealthy${NC}"
    echo ""

    if [ -f "$IMAGE_TAGS_FILE" ]; then
        source "$IMAGE_TAGS_FILE"
        log "Last deployment: ${TIMESTAMP:-unknown}"
    fi
}

# Show usage
usage() {
    echo "Usage: $0 {deploy|rollback|status|backup}"
    echo ""
    echo "Commands:"
    echo "  deploy   - Full production deployment with backup, migrations, and health checks"
    echo "  rollback - Rollback to previous deployment images"
    echo "  status   - Show current deployment status"
    echo "  backup   - Create database backup"
    echo ""
    echo "Example:"
    echo "  $0 deploy    # Deploy latest images"
    echo "  $0 status    # Check current status"
    echo "  $0 rollback  # Rollback on failure"
}

# Main script
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
    backup)
        backup
        ;;
    *)
        usage
        exit 1
        ;;
esac

exit $?
