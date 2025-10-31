#!/bin/bash

# PR Staging Setup Script
# Creates an isolated staging environment for a Pull Request

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

# Check required parameters
if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <PR_NUMBER> <BRANCH_NAME>"
    echo "Example: $0 123 feature/new-feature"
    exit 1
fi

PR_NUMBER=$1
BRANCH_NAME=$2
PROJECT_ROOT="/root/kds"
PR_DIR="${PROJECT_ROOT}/pr-${PR_NUMBER}"

# Port assignments (8000-9000 range for PRs)
BACKEND_PORT=$((8000 + PR_NUMBER))
FRONTEND_PORT=$((8100 + PR_NUMBER))
POSTGRES_PORT=$((8200 + PR_NUMBER))

log "=== Setting up PR #${PR_NUMBER} Staging Environment ==="
log "Branch: $BRANCH_NAME"
log "Backend Port: $BACKEND_PORT"
log "Frontend Port: $FRONTEND_PORT"
log "Database Port: $POSTGRES_PORT"

# Create PR directory
log "Creating PR directory..."
mkdir -p "$PR_DIR"
cd "$PR_DIR"

# Clone repository if not exists
if [ ! -d ".git" ]; then
    log "Cloning repository..."
    git clone "${PROJECT_ROOT}/.git" .
fi

# Checkout PR branch
log "Checking out branch: $BRANCH_NAME..."
git fetch origin
git checkout "$BRANCH_NAME"
git pull origin "$BRANCH_NAME"

# Create PR-specific docker-compose file
log "Creating PR-specific docker-compose configuration..."
cat > "$PR_DIR/docker-compose.pr.yml" <<EOF
version: '3.8'

services:
  postgres-pr-${PR_NUMBER}:
    image: postgres:15-alpine
    container_name: kds_postgres_pr_${PR_NUMBER}
    restart: unless-stopped
    environment:
      POSTGRES_DB: restaurant_pos_pr_${PR_NUMBER}
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    ports:
      - '${POSTGRES_PORT}:5432'
    volumes:
      - postgres_pr_${PR_NUMBER}_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - kds_pr_${PR_NUMBER}_network

  redis-pr-${PR_NUMBER}:
    image: redis:7-alpine
    container_name: kds_redis_pr_${PR_NUMBER}
    restart: unless-stopped
    volumes:
      - redis_pr_${PR_NUMBER}_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - kds_pr_${PR_NUMBER}_network

  backend-pr-${PR_NUMBER}:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: production
    container_name: kds_backend_pr_${PR_NUMBER}
    restart: unless-stopped
    depends_on:
      postgres-pr-${PR_NUMBER}:
        condition: service_healthy
      redis-pr-${PR_NUMBER}:
        condition: service_healthy
    environment:
      NODE_ENV: staging
      PORT: 3000
      DATABASE_URL: postgresql://postgres:\${POSTGRES_PASSWORD}@postgres-pr-${PR_NUMBER}:5432/restaurant_pos_pr_${PR_NUMBER}
      REDIS_URL: redis://redis-pr-${PR_NUMBER}:6379/0
      JWT_SECRET: \${JWT_SECRET}
      JWT_EXPIRES_IN: 7d
      JWT_REFRESH_SECRET: \${JWT_REFRESH_SECRET}
      JWT_REFRESH_EXPIRES_IN: 30d
      CORS_ORIGIN: http://\${SERVER_HOST}:${FRONTEND_PORT}
      FRONTEND_URL: http://\${SERVER_HOST}:${FRONTEND_PORT}
    ports:
      - '${BACKEND_PORT}:3000'
    networks:
      - kds_pr_${PR_NUMBER}_network

  frontend-pr-${PR_NUMBER}:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      target: production
      args:
        VITE_API_URL: http://\${SERVER_HOST}:${BACKEND_PORT}/api
    container_name: kds_frontend_pr_${PR_NUMBER}
    restart: unless-stopped
    depends_on:
      - backend-pr-${PR_NUMBER}
    ports:
      - '${FRONTEND_PORT}:80'
    networks:
      - kds_pr_${PR_NUMBER}_network

volumes:
  postgres_pr_${PR_NUMBER}_data:
  redis_pr_${PR_NUMBER}_data:

networks:
  kds_pr_${PR_NUMBER}_network:
    driver: bridge
EOF

# Copy environment variables
log "Setting up environment variables..."
cp "${PROJECT_ROOT}/.env" "${PR_DIR}/.env"

# Build and start containers
log "Building Docker images..."
docker compose -f docker-compose.pr.yml build

log "Starting containers..."
docker compose -f docker-compose.pr.yml up -d

# Wait for services to be ready
log "Waiting for services to be ready..."
sleep 15

# Run database migrations
log "Running database migrations..."
docker compose -f docker-compose.pr.yml exec -T backend-pr-${PR_NUMBER} npx prisma migrate deploy || {
    error "Database migration failed"
    exit 1
}

# Health check
log "Performing health check..."
max_attempts=30
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if curl -sf "http://localhost:${BACKEND_PORT}/api/health" > /dev/null 2>&1; then
        success "PR staging environment is healthy!"
        break
    fi

    attempt=$((attempt + 1))
    log "Health check attempt $attempt/$max_attempts..."
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    error "Health check failed after $max_attempts attempts"
    exit 1
fi

# Output summary
echo ""
success "=== PR #${PR_NUMBER} Staging Environment Ready ==="
echo ""
echo "Frontend URL: http://\${SERVER_HOST}:${FRONTEND_PORT}"
echo "Backend API: http://\${SERVER_HOST}:${BACKEND_PORT}/api"
echo "Database: postgres://postgres:***@localhost:${POSTGRES_PORT}/restaurant_pos_pr_${PR_NUMBER}"
echo ""
echo "To view logs:"
echo "  cd $PR_DIR && docker compose -f docker-compose.pr.yml logs -f"
echo ""
echo "To stop:"
echo "  cd $PR_DIR && docker compose -f docker-compose.pr.yml down"
echo ""

exit 0
