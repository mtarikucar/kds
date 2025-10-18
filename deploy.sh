#!/bin/bash

# KDS Deployment Script
# Usage: ./deploy.sh [environment] [action]
# Environment: development, staging, production
# Action: deploy, rollback, status, logs

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="/opt/kds"
BACKUP_DIR="$PROJECT_DIR/backups"

# Functions
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_usage() {
    cat << EOF
KDS Deployment Script

Usage:
  ./deploy.sh [environment] [action]

Environments:
  development (dev)  - Development environment (port 3001/5174)
  staging (stage)    - Staging environment (port 3002/5175)
  production (prod)  - Production environment (port 3000/80)

Actions:
  deploy             - Deploy the application
  rollback           - Rollback to previous version
  status             - Show deployment status
  logs               - Show application logs
  backup             - Create database backup
  restart            - Restart services

Examples:
  ./deploy.sh development deploy
  ./deploy.sh staging status
  ./deploy.sh production backup
  ./deploy.sh prod logs

EOF
    exit 1
}

# Check if running as correct user
check_permissions() {
    if [ "$EUID" -ne 0 ] && [ "$(whoami)" != "root" ]; then
        print_warning "Script might need elevated permissions for Docker commands"
    fi
}

# Validate environment
validate_environment() {
    local env=$1
    case $env in
        development|dev)
            ENVIRONMENT="development"
            COMPOSE_FILE="docker-compose.dev.yml"
            ENV_FILE=".env.development"
            BRANCH="develop"
            DB_NAME="restaurant_pos_dev"
            BACKEND_PORT="3001"
            FRONTEND_PORT="5174"
            ;;
        staging|stage)
            ENVIRONMENT="staging"
            COMPOSE_FILE="docker-compose.staging.yml"
            ENV_FILE=".env.staging"
            BRANCH="main"
            DB_NAME="restaurant_pos_staging"
            BACKEND_PORT="3002"
            FRONTEND_PORT="5175"
            ;;
        production|prod)
            ENVIRONMENT="production"
            COMPOSE_FILE="docker-compose.prod.yml"
            ENV_FILE=".env.production"
            BRANCH="main"
            DB_NAME="restaurant_pos_prod"
            BACKEND_PORT="3000"
            FRONTEND_PORT="80"
            ;;
        *)
            print_error "Invalid environment: $env"
            show_usage
            ;;
    esac
}

# Create backup
create_backup() {
    print_info "Creating backup for $ENVIRONMENT environment..."

    mkdir -p "$BACKUP_DIR"
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/backup_${ENVIRONMENT}_${TIMESTAMP}.sql"

    if docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U postgres "$DB_NAME" > "$BACKUP_FILE"; then
        print_success "Backup created: $BACKUP_FILE"

        # Keep only last 10 backups
        ls -t "$BACKUP_DIR"/backup_${ENVIRONMENT}_*.sql 2>/dev/null | tail -n +11 | xargs -r rm
        print_info "Old backups cleaned up"
    else
        print_error "Backup failed!"
        exit 1
    fi
}

# Deploy application
deploy() {
    print_info "Deploying to $ENVIRONMENT environment..."

    # Confirm production deployment
    if [ "$ENVIRONMENT" = "production" ]; then
        read -p "Are you sure you want to deploy to PRODUCTION? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            print_warning "Deployment cancelled"
            exit 0
        fi
    fi

    # Create backup before deployment
    if [ "$ENVIRONMENT" = "production" ] || [ "$ENVIRONMENT" = "staging" ]; then
        create_backup
    fi

    # Pull latest code
    print_info "Pulling latest code from branch: $BRANCH"
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
    git pull origin "$BRANCH"

    # Load environment variables
    print_info "Loading environment variables"
    if [ ! -f "$ENV_FILE" ]; then
        print_error "Environment file not found: $ENV_FILE"
        exit 1
    fi
    cp "$ENV_FILE" .env

    # Build and restart containers
    print_info "Building Docker images"
    docker-compose -f "$COMPOSE_FILE" build

    print_info "Restarting containers"
    docker-compose -f "$COMPOSE_FILE" up -d

    # Wait for services to be ready
    print_info "Waiting for services to be ready..."
    sleep 15

    # Run database migrations
    print_info "Running database migrations"
    if docker-compose -f "$COMPOSE_FILE" exec -T backend npx prisma migrate deploy; then
        print_success "Migrations completed"
    else
        print_error "Migrations failed!"
        exit 1
    fi

    # Health check
    print_info "Performing health check..."
    sleep 5
    if curl -f "http://localhost:$BACKEND_PORT/api" > /dev/null 2>&1; then
        print_success "Health check passed!"
    else
        print_error "Health check failed!"
        exit 1
    fi

    # Show status
    print_info "Deployment status:"
    docker-compose -f "$COMPOSE_FILE" ps

    print_success "Deployment to $ENVIRONMENT completed successfully!"
    print_info "Backend URL: http://localhost:$BACKEND_PORT"
    print_info "Frontend URL: http://localhost:$FRONTEND_PORT"
}

# Rollback to previous version
rollback() {
    print_warning "Rolling back $ENVIRONMENT environment..."

    # Confirm rollback
    read -p "Are you sure you want to rollback $ENVIRONMENT? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        print_warning "Rollback cancelled"
        exit 0
    fi

    # Stop current containers
    print_info "Stopping current containers"
    docker-compose -f "$COMPOSE_FILE" down

    # Checkout previous commit
    print_info "Rolling back to previous commit"
    git checkout HEAD~1

    # Restore backup
    if [ "$ENVIRONMENT" = "production" ] || [ "$ENVIRONMENT" = "staging" ]; then
        LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/backup_${ENVIRONMENT}_*.sql 2>/dev/null | head -n 1)
        if [ -n "$LATEST_BACKUP" ]; then
            read -p "Restore database from backup: $LATEST_BACKUP? (yes/no): " restore_confirm
            if [ "$restore_confirm" = "yes" ]; then
                print_info "Restoring database from backup"
                docker-compose -f "$COMPOSE_FILE" up -d postgres
                sleep 10
                cat "$LATEST_BACKUP" | docker-compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d "$DB_NAME"
                print_success "Database restored"
            fi
        fi
    fi

    # Restart containers
    print_info "Starting previous version"
    docker-compose -f "$COMPOSE_FILE" up -d

    print_success "Rollback completed"
}

# Show deployment status
show_status() {
    print_info "Status for $ENVIRONMENT environment:"
    echo ""

    # Show running containers
    docker-compose -f "$COMPOSE_FILE" ps
    echo ""

    # Show Git information
    print_info "Git Information:"
    echo "Branch: $(git branch --show-current)"
    echo "Commit: $(git log -1 --oneline)"
    echo ""

    # Show environment file
    print_info "Environment: $ENV_FILE"
    echo ""

    # Show port information
    print_info "Service URLs:"
    echo "Backend:  http://localhost:$BACKEND_PORT"
    echo "Frontend: http://localhost:$FRONTEND_PORT"
}

# Show logs
show_logs() {
    print_info "Showing logs for $ENVIRONMENT environment..."
    docker-compose -f "$COMPOSE_FILE" logs -f --tail=100
}

# Restart services
restart_services() {
    print_info "Restarting services for $ENVIRONMENT environment..."
    docker-compose -f "$COMPOSE_FILE" restart
    print_success "Services restarted"
}

# Main script
main() {
    if [ $# -lt 2 ]; then
        show_usage
    fi

    check_permissions
    validate_environment "$1"

    # Change to project directory
    cd "$PROJECT_DIR" || {
        print_error "Project directory not found: $PROJECT_DIR"
        exit 1
    }

    print_info "Environment: $ENVIRONMENT"
    print_info "Compose file: $COMPOSE_FILE"
    echo ""

    # Execute action
    case $2 in
        deploy)
            deploy
            ;;
        rollback)
            rollback
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs
            ;;
        backup)
            create_backup
            ;;
        restart)
            restart_services
            ;;
        *)
            print_error "Invalid action: $2"
            show_usage
            ;;
    esac
}

# Run main function
main "$@"
