#!/bin/bash

# Deployment Rollback Script
# Rolls back to the previous Docker images and database state

set -e

BACKUP_DIR="/opt/kds/backups/database"

echo "⚠️  Starting deployment rollback..."

# Stop current containers
echo "🛑 Stopping current containers..."
cd /opt/kds
docker-compose -f docker-compose.prod.yml stop

# Find the latest backup
LATEST_BACKUP=$(ls -t ${BACKUP_DIR}/backup_*.sql.gz | head -1)

if [ -z "$LATEST_BACKUP" ]; then
    echo "❌ No backup found. Cannot rollback database."
    echo "⚠️  Restarting containers with current state..."
    docker-compose -f docker-compose.prod.yml up -d
    exit 1
fi

echo "📦 Latest backup: ${LATEST_BACKUP}"

# Ask for confirmation (in interactive mode)
if [ -t 0 ]; then
    read -p "Do you want to restore from this backup? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        echo "Rollback cancelled."
        docker-compose -f docker-compose.prod.yml up -d
        exit 0
    fi
fi

# Restore database
echo "🔄 Restoring database from backup..."

# Get database credentials
source /opt/kds/.env.production

# Extract database info
DB_URL=${DATABASE_URL}
DB_USER=$(echo $DB_URL | sed -n 's/.*\/\/\([^:]*\):.*/\1/p')
DB_PASS=$(echo $DB_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
DB_HOST=$(echo $DB_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo $DB_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DB_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

# Decompress and restore
export PGPASSWORD=${DB_PASS}
gunzip -c ${LATEST_BACKUP} | psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME}

echo "✅ Database restored from backup"

# Restart containers
echo "🚀 Restarting containers..."
docker-compose -f docker-compose.prod.yml up -d

# Wait and check health
echo "⏳ Waiting for services to be ready..."
sleep 15

# Health check
if curl -f http://localhost:3000/api/health; then
    echo "✅ Rollback completed successfully!"
else
    echo "❌ Health check failed after rollback"
    exit 1
fi
