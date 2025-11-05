#!/bin/bash

# Test Environment Deployment Script
# Deploys to staging.hummytummy.com (port 3002 backend, 5175 frontend)

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BRANCH="test"
ENV_FILE="$PROJECT_ROOT/.env.test"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.staging.yml"
BACKUP_DIR="$PROJECT_ROOT/backups/database"
HEALTH_CHECK_URL="http://localhost:3002/api/health"
MAX_HEALTH_RETRIES=30
HEALTH_CHECK_INTERVAL=2

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if script is run from project root or scripts dir
cd "$PROJECT_ROOT"
log_info "Working directory: $PROJECT_ROOT"

# Function: Pull latest code
pull_latest() {
    log_info "Pulling latest code from $BRANCH branch..."

    # Fetch latest changes
    git fetch origin "$BRANCH"

    # Get current commit before pull
    CURRENT_COMMIT=$(git rev-parse HEAD)

    # Checkout and pull
    git checkout "$BRANCH"
    git pull origin "$BRANCH"

    NEW_COMMIT=$(git rev-parse HEAD)

    if [ "$CURRENT_COMMIT" != "$NEW_COMMIT" ]; then
        log_success "Code updated: $CURRENT_COMMIT -> $NEW_COMMIT"
        echo "$CURRENT_COMMIT" > /tmp/kds_test_last_commit
    else
        log_info "No new commits, code is up to date"
    fi
}

# Function: Copy environment file
copy_env() {
    log_info "Copying test environment file..."

    if [ ! -f "$ENV_FILE" ]; then
        log_error "Environment file not found: $ENV_FILE"
        exit 1
    fi

    cp "$ENV_FILE" "$PROJECT_ROOT/.env"
    log_success "Environment file copied"
}

# Function: Create database backup
backup_database() {
    log_info "Creating database backup..."

    mkdir -p "$BACKUP_DIR"
    BACKUP_FILE="$BACKUP_DIR/backup_test_$(date +%Y%m%d_%H%M%S).sql.gz"

    docker exec kds_postgres_staging pg_dump \
        -U postgres \
        -d restaurant_pos_staging \
        | gzip > "$BACKUP_FILE"

    if [ -f "$BACKUP_FILE" ]; then
        log_success "Database backup created: $BACKUP_FILE"

        # Keep only last 3 test backups
        ls -t "$BACKUP_DIR"/backup_test_*.sql.gz | tail -n +4 | xargs -r rm
    else
        log_warning "Database backup failed, continuing anyway..."
    fi
}

# Function: Build and start containers
deploy_containers() {
    log_info "Building and deploying containers..."

    # Build images
    log_info "Building Docker images..."
    docker-compose -f "$COMPOSE_FILE" --env-file "$PROJECT_ROOT/.env" build --no-cache

    # Stop existing containers
    log_info "Stopping existing containers..."
    docker-compose -f "$COMPOSE_FILE" down || true

    # Start new containers
    log_info "Starting containers..."
    docker-compose -f "$COMPOSE_FILE" --env-file "$PROJECT_ROOT/.env" up -d

    log_success "Containers deployed"
}

# Function: Run database migrations
run_migrations() {
    log_info "Running database migrations..."

    # Wait for backend to be ready
    sleep 10

    docker exec kds_backend_staging npx prisma migrate deploy || {
        log_warning "Migration failed or no new migrations to apply"
    }

    log_success "Migrations completed"
}

# Function: Health check
health_check() {
    log_info "Performing health check..."

    for i in $(seq 1 $MAX_HEALTH_RETRIES); do
        if curl -sf "$HEALTH_CHECK_URL" > /dev/null 2>&1; then
            log_success "Health check passed! Backend is healthy"
            return 0
        fi

        log_info "Health check attempt $i/$MAX_HEALTH_RETRIES failed, retrying in ${HEALTH_CHECK_INTERVAL}s..."
        sleep $HEALTH_CHECK_INTERVAL
    done

    log_error "Health check failed after $MAX_HEALTH_RETRIES attempts"
    return 1
}

# Function: Rollback
rollback() {
    log_error "Deployment failed! Rolling back..."

    if [ -f /tmp/kds_test_last_commit ]; then
        LAST_COMMIT=$(cat /tmp/kds_test_last_commit)
        log_info "Rolling back to commit: $LAST_COMMIT"
        git checkout "$LAST_COMMIT"

        # Rebuild with old code
        docker-compose -f "$COMPOSE_FILE" --env-file "$PROJECT_ROOT/.env" build
        docker-compose -f "$COMPOSE_FILE" --env-file "$PROJECT_ROOT/.env" up -d

        log_success "Rollback completed"
    else
        log_warning "No previous commit found, manual intervention required"
    fi

    exit 1
}

# Function: Show status
show_status() {
    log_info "Test Environment Status:"
    echo ""
    docker-compose -f "$COMPOSE_FILE" ps
    echo ""
    log_info "Backend: http://localhost:3002/api/health"
    log_info "Frontend: http://localhost:5175"
    log_info "Public URL: https://staging.hummytummy.com"
}

# Main deployment function
deploy() {
    log_info "=========================================="
    log_info "Starting Test Environment Deployment"
    log_info "Branch: $BRANCH"
    log_info "Environment: TEST (staging.hummytummy.com)"
    log_info "=========================================="
    echo ""

    # Deployment steps
    pull_latest || rollback
    copy_env || rollback
    backup_database  # Don't fail on backup error
    deploy_containers || rollback
    run_migrations || rollback

    # Health check
    if ! health_check; then
        rollback
    fi

    echo ""
    log_success "=========================================="
    log_success "Test Deployment Completed Successfully!"
    log_success "=========================================="
    echo ""
    show_status
}

# Handle script arguments
case "${1:-deploy}" in
    deploy)
        deploy
        ;;
    status)
        show_status
        ;;
    rollback)
        rollback
        ;;
    health)
        health_check && log_success "Health check passed" || log_error "Health check failed"
        ;;
    *)
        echo "Usage: $0 {deploy|status|rollback|health}"
        exit 1
        ;;
esac
