#!/usr/bin/env bash
# backup-database.sh — verified pg_dump backup for KDS.
#
# Two modes:
#   ./backup-database.sh          → infer env (prod if .env.production exists)
#   ./backup-database.sh staging  → force staging
#   ./backup-database.sh prod     → force prod
#
# Hard requirements: backup is created, gzip-verified, contains a
# plausible schema. Failure exits non-zero; the caller (deploy.sh)
# treats that as a deploy abort.
#
# Retention: 14 days for prod, 3 days for staging.
#
# TODO (out of scope, separate issue):
#   - rclone/aws s3 cp off-site upload
#   - WAL streaming for PITR
#   - monthly restore drill runbook

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

log()  { printf '\033[0;34m[backup]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m[backup]\033[0m %s\n' "$*"; }
err()  { printf '\033[0;31m[backup]\033[0m %s\n' "$*" >&2; }

# Pick environment ----------------------------------------------------
ENV="${1:-}"
if [ -z "$ENV" ]; then
  if   [ -f "$PROJECT_ROOT/.env.production" ]; then ENV=prod
  elif [ -f "$PROJECT_ROOT/.env.test" ];       then ENV=staging
  else err "Cannot infer environment — pass 'staging' or 'prod' as arg"; exit 1
  fi
fi

case "$ENV" in
  prod)
    ENV_FILE="$PROJECT_ROOT/.env.production"
    POSTGRES_CONTAINER="kds_postgres_prod"
    DEFAULT_DB="restaurant_pos_prod"
    RETENTION_DAYS=14
    ;;
  staging)
    ENV_FILE="$PROJECT_ROOT/.env.test"
    POSTGRES_CONTAINER="kds_postgres_staging"
    DEFAULT_DB="restaurant_pos_staging"
    RETENTION_DAYS=3
    ;;
  *)
    err "Unknown env: $ENV (expected prod or staging)"
    exit 1
    ;;
esac

BACKUP_DIR="$PROJECT_ROOT/backups/database"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_${ENV}_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Pull DB credentials without leaking them ----------------------------
DB_NAME=""
DB_USER=""
if [ -f "$ENV_FILE" ]; then
  DB_NAME=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d "'\"" || true)
  DB_USER=$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d "'\"" || true)
fi
DB_NAME="${DB_NAME:-$DEFAULT_DB}"
DB_USER="${DB_USER:-postgres}"

# Verify container is up ---------------------------------------------
if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  err "Container '$POSTGRES_CONTAINER' is not running"
  exit 1
fi

# Dump ---------------------------------------------------------------
log "Dumping '$DB_NAME' from $POSTGRES_CONTAINER as user '$DB_USER'"
log "Target: $BACKUP_FILE"

# pg_dump in stream mode → gzip → file. The PIPESTATUS check below
# catches the case where pg_dump fails but gzip succeeds writing an
# empty (or partial) stream.
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  | gzip -c > "$BACKUP_FILE"

dump_rc=${PIPESTATUS[0]}
gzip_rc=${PIPESTATUS[1]}
if [ "$dump_rc" -ne 0 ] || [ "$gzip_rc" -ne 0 ]; then
  err "Pipeline failed: pg_dump=$dump_rc gzip=$gzip_rc"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Verify -------------------------------------------------------------
if ! gzip -t "$BACKUP_FILE"; then
  err "gzip integrity check failed on $BACKUP_FILE"
  rm -f "$BACKUP_FILE"
  exit 1
fi

size_bytes=$(stat -c '%s' "$BACKUP_FILE" 2>/dev/null \
             || stat -f '%z' "$BACKUP_FILE" 2>/dev/null \
             || echo 0)
if [ "$size_bytes" -lt 1024 ]; then
  err "Backup smaller than 1KB ($size_bytes bytes) — abort"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Plain pg_dump (default format -p) ⇒ readable SQL after gunzip.
# A real schema dump has many CREATE statements; an empty dump or a
# connection that died on the first line will have very few.
create_count=$(gzip -dc "$BACKUP_FILE" | grep -cE '^(CREATE TABLE|CREATE INDEX|CREATE TYPE|CREATE SEQUENCE)' || true)
if [ "$create_count" -lt 5 ]; then
  err "Backup has only $create_count CREATE statements — looks bogus"
  rm -f "$BACKUP_FILE"
  exit 1
fi

ok "Backup verified ($size_bytes bytes, $create_count create stmts)"

# Retention ----------------------------------------------------------
pruned=$(find "$BACKUP_DIR" -name "backup_${ENV}_*.sql.gz" -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null | wc -l)
if [ "$pruned" -gt 0 ]; then
  log "Pruned $pruned backup(s) older than ${RETENTION_DAYS}d"
fi

# Summary ------------------------------------------------------------
echo ""
log "Recent ${ENV} backups:"
ls -lh "$BACKUP_DIR" | grep "backup_${ENV}_" | tail -5 | sed 's/^/   /'
