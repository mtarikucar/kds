#!/bin/bash

# Database Backup Script
# Creates a timestamped backup of the production database

set -e

BACKUP_DIR="/opt/kds/backups/database"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql"

# Create backup directory if it doesn't exist
mkdir -p ${BACKUP_DIR}

# Get database credentials from .env.production
source /opt/kds/.env.production

# Extract database info from DATABASE_URL
# Format: postgresql://user:password@host:port/database
DB_URL=${DATABASE_URL}
DB_USER=$(echo $DB_URL | sed -n 's/.*\/\/\([^:]*\):.*/\1/p')
DB_PASS=$(echo $DB_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
DB_HOST=$(echo $DB_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo $DB_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DB_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

echo "📦 Creating database backup..."
echo "Database: ${DB_NAME}"
echo "Host: ${DB_HOST}:${DB_PORT}"
echo "Backup file: ${BACKUP_FILE}"

# Create backup using pg_dump
export PGPASSWORD=${DB_PASS}
pg_dump -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -F p -f ${BACKUP_FILE} ${DB_NAME}

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
