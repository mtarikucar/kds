#!/bin/bash

# Database Backup Script
# Creates a timestamped backup of the production database

set -e

# Determine script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

BACKUP_DIR="${PROJECT_ROOT}/backups/database"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql"

# Create backup directory if it doesn't exist
mkdir -p ${BACKUP_DIR}

# Get database credentials
# Try to get from DATABASE_URL first, then fallback to docker-compose defaults
if [ -f "${PROJECT_ROOT}/.env.production" ]; then
  source ${PROJECT_ROOT}/.env.production
elif [ -f "${PROJECT_ROOT}/.env" ]; then
  source ${PROJECT_ROOT}/.env
fi

# If DATABASE_URL exists, parse it
if [ ! -z "$DATABASE_URL" ]; then
  # Extract database info from DATABASE_URL
  # Format: postgresql://user:password@host:port/database
  DB_URL=${DATABASE_URL}
  DB_USER=$(echo $DB_URL | sed -n 's/.*\/\/\([^:]*\):.*/\1/p')
  DB_PASS=$(echo $DB_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
  DB_HOST=$(echo $DB_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
  DB_PORT=$(echo $DB_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
  DB_NAME=$(echo $DB_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
else
  # Use docker-compose defaults
  DB_USER=${POSTGRES_USER:-postgres}
  DB_PASS=${POSTGRES_PASSWORD:-postgres}
  DB_HOST=${POSTGRES_HOST:-localhost}
  DB_PORT=${POSTGRES_PORT:-5432}
  DB_NAME=${POSTGRES_DB:-restaurant_pos_prod}
fi

echo "📦 Creating database backup..."
echo "Database: ${DB_NAME}"
echo "Host: ${DB_HOST}:${DB_PORT}"
echo "Backup file: ${BACKUP_FILE}"

# Check if running in Docker environment
if command -v docker &> /dev/null && docker ps | grep -q postgres; then
  # Use docker exec to run pg_dump inside postgres container
  # For production, look for kds_postgres_prod first, then fall back to any postgres container
  if docker ps --format '{{.Names}}' | grep -q 'kds_postgres_prod'; then
    POSTGRES_CONTAINER='kds_postgres_prod'
  else
    POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep postgres | grep -v staging | head -1)
    if [ -z "$POSTGRES_CONTAINER" ]; then
      POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep postgres | head -1)
    fi
  fi
  echo "Using Docker container: ${POSTGRES_CONTAINER}"

  docker exec ${POSTGRES_CONTAINER} pg_dump -U ${DB_USER} -d ${DB_NAME} -F p > ${BACKUP_FILE}
elif command -v pg_dump &> /dev/null; then
  # Use local pg_dump
  export PGPASSWORD=${DB_PASS}
  pg_dump -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -F p -f ${BACKUP_FILE} ${DB_NAME}
else
  echo "❌ Error: Neither Docker nor pg_dump available"
  exit 1
fi

# Compress backup
gzip ${BACKUP_FILE}

echo "✅ Backup created successfully: ${BACKUP_FILE}.gz"

# Keep only last 7 days of backups
find ${BACKUP_DIR} -name "backup_*.sql.gz" -mtime +7 -delete

echo "🗑️  Old backups cleaned (keeping last 7 days)"

# List recent backups
echo ""
echo "Recent backups:"
ls -lh ${BACKUP_DIR} | tail -5
