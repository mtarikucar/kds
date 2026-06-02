#!/usr/bin/env bash
# staging-reset.sh — wipe + re-bootstrap the staging Postgres for the
# v3.0.0 cutover. Runs entirely against the staging host's docker
# containers; no host-level Postgres binaries required.
#
# When to run: the v2→v3 migration left staging's _prisma_migrations
# table in a state Prisma cannot self-recover from (P3005 "schema not
# empty but no migration history"). The user picked the fresh-start
# recovery path, so this script drops the staging DB, recreates it,
# and replays every migration from scratch.
#
# Usage (on the staging host):
#   ssh root@<staging-host>
#   cd /root/kds && git pull origin test
#   ./scripts/staging-reset.sh
#
# After it finishes, trigger a fresh deploy via the GitHub Actions
# "Re-run all jobs" button on the latest commit OR push an empty
# commit. The next deploy.sh will see a clean DB + applied migration
# history and converge.

set -euo pipefail

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-kds_postgres_staging}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-kds_backend_staging}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-restaurant_pos_staging}"

log() { printf '\033[0;34m[reset]\033[0m %s\n' "$*"; }
ok()  { printf '\033[0;32m[reset]\033[0m %s\n' "$*"; }
err() { printf '\033[0;31m[reset]\033[0m %s\n' "$*" >&2; }

# Sanity: both containers must be running. We refuse to silently
# create a DB on the wrong host.
for c in "$POSTGRES_CONTAINER" "$BACKEND_CONTAINER"; do
  if ! docker ps --format '{{.Names}}' | grep -q "^${c}$"; then
    err "Container '$c' is not running. Run \`docker ps\` to verify."
    exit 1
  fi
done

# Belt + suspenders: refuse to run against the prod DB.
if [[ "$DB_NAME" == *"prod"* ]] && [[ "${ALLOW_PROD:-0}" != "1" ]]; then
  err "Refusing — DB_NAME='$DB_NAME' looks like a prod DB. Set ALLOW_PROD=1 to override."
  exit 1
fi

read -r -p "About to DROP DATABASE '$DB_NAME' on '$POSTGRES_CONTAINER'. Type 'reset' to confirm: " confirm
if [[ "$confirm" != "reset" ]]; then
  err "Aborted by operator."
  exit 1
fi

log "Terminating open connections to $DB_NAME…"
docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()" >/dev/null || true

log "Dropping $DB_NAME…"
docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d postgres -c \
  "DROP DATABASE IF EXISTS \"$DB_NAME\""

log "Recreating $DB_NAME…"
docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d postgres -c \
  "CREATE DATABASE \"$DB_NAME\""

log "Applying migrations…"
docker exec "$BACKEND_CONTAINER" npx --no-install prisma migrate deploy

log "Running bootstrap script (idempotent — no-op on empty DB)…"
docker exec "$BACKEND_CONTAINER" npx --no-install ts-node \
  src/common/scripts/bootstrap-v3-tenants.ts || \
  log "Bootstrap finished with no work (expected for fresh DB)."

ok "Staging reset complete. Push a fresh commit or click 'Re-run all jobs' on the latest GH Actions run to redeploy."
