#!/bin/bash

# PR Staging Cleanup Script
# Removes PR staging environment and cleans up resources

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check required parameter
if [ -z "$1" ]; then
    echo "Usage: $0 <PR_NUMBER>"
    echo "Example: $0 123"
    exit 1
fi

PR_NUMBER=$1
PROJECT_ROOT="/root/kds"
PR_DIR="${PROJECT_ROOT}/pr-${PR_NUMBER}"

log "=== Cleaning up PR #${PR_NUMBER} Staging Environment ==="

# Check if PR directory exists
if [ ! -d "$PR_DIR" ]; then
    warning "PR directory does not exist: $PR_DIR"
    exit 0
fi

cd "$PR_DIR"

# Stop and remove containers
if [ -f "docker-compose.pr.yml" ]; then
    log "Stopping and removing containers..."
    docker compose -f docker-compose.pr.yml down -v || {
        warning "Failed to stop containers cleanly"
    }

    # Remove any orphaned containers
    log "Removing orphaned containers..."
    docker ps -a | grep "pr_${PR_NUMBER}" | awk '{print $1}' | xargs -r docker rm -f || true
else
    warning "docker-compose.pr.yml not found"
fi

# Remove Docker volumes
log "Removing Docker volumes..."
docker volume ls | grep "pr_${PR_NUMBER}" | awk '{print $2}' | xargs -r docker volume rm || {
    warning "Failed to remove some volumes"
}

# Remove PR directory
log "Removing PR directory..."
cd "$PROJECT_ROOT"
rm -rf "$PR_DIR"

# Clean up any dangling images
log "Cleaning up dangling Docker images..."
docker image prune -f > /dev/null 2>&1 || true

success "=== PR #${PR_NUMBER} Staging Environment Cleaned Up ==="

echo ""
log "Summary:"
log "  ✓ Containers stopped and removed"
log "  ✓ Docker volumes removed"
log "  ✓ PR directory removed"
log "  ✓ Dangling images pruned"
echo ""

exit 0
