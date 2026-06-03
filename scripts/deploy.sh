#!/usr/bin/env bash
# deploy.sh — unified staging + production deployer
#
# Replaces the old deploy-production.sh / test-deploy.sh duo. One
# code path, two ENV configurations. Every step is atomic; any error
# fires the ERR trap which restores the previous image SHAs.
#
# Usage:
#   deploy.sh staging  <commit-sha>
#   deploy.sh prod     <vX.Y.Z>
#   deploy.sh staging-rollback
#   deploy.sh prod-rollback
#
# Notes:
#   * Images come from GHCR (ghcr.io/mtarikucar/kds/{backend,frontend,landing}).
#     The :vX.Y.Z (or :<sha>) tag is the immutable identity; :current is
#     the production pointer that docker-compose reads. We only move
#     :current once verify_and_promote passes.
#   * Migrations run inside the OLD backend container, before any image
#     swap. The Migration Policy (plan §"Migration Policy") guarantees
#     they are additive, so the old client tolerates the new schema for
#     the few seconds between migrate and swap.
#   * Image SHA snapshots live in /var/lib/kds-deploy/last-images-<env>.env
#     and survive across deploys (rollback can be invoked days later).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
STATE_DIR="/var/lib/kds-deploy"

# ====================================================================
# Logging
# ====================================================================

log()  { printf '\033[0;34m[%s]\033[0m %s\n' "$(date +'%H:%M:%S')" "$*"; }
ok()   { printf '\033[0;32m[ OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WRN]\033[0m %s\n' "$*"; }
err()  { printf '\033[0;31m[ERR]\033[0m %s\n' "$*" >&2; }

# step "label" cmd args... — runs cmd, fails loud on non-zero.
step() {
  local label="$1"; shift
  log "▶ $label"
  "$@"
  ok "✓ $label"
}

# ====================================================================
# Per-environment configuration
# ====================================================================

ENV=""
VERSION=""
ACTION=""  # deploy | rollback

# All these are populated by configure_env().
COMPOSE_FILE=""
ENV_FILE=""
POSTGRES_CONTAINER=""
REDIS_CONTAINER=""
BACKEND_CONTAINER=""
FRONTEND_CONTAINER=""
LANDING_CONTAINER=""
MARKETING_CONTAINER=""
BACKEND_IMG=""
FRONTEND_IMG=""
LANDING_IMG=""
MARKETING_IMG=""
API_LOCAL_URL=""
API_PUBLIC_URL=""
FRONTEND_PUBLIC_URL=""
LANDING_PUBLIC_URL=""
MARKETING_PUBLIC_URL=""
HEALTH_BUDGET_SEC=300
BACKUP_RETENTION_DAYS=14
STATE_FILE=""
BACKUP_PREFIX=""

configure_env() {
  local arg="${1:?usage: deploy.sh <staging|prod|staging-rollback|prod-rollback> [version]}"
  VERSION="${2:-}"

  case "$arg" in
    prod)             ENV=prod;    ACTION=deploy   ;;
    staging)          ENV=staging; ACTION=deploy   ;;
    prod-rollback)    ENV=prod;    ACTION=rollback ;;
    staging-rollback) ENV=staging; ACTION=rollback ;;
    *)
      err "Unknown command: $arg"
      err "Expected: staging | prod | staging-rollback | prod-rollback"
      exit 1
      ;;
  esac

  local ghcr_base="ghcr.io/mtarikucar/kds"

  if [ "$ENV" = "prod" ]; then
    COMPOSE_FILE="$PROJECT_ROOT/docker-compose.prod.yml"
    ENV_FILE="$PROJECT_ROOT/.env.production"
    POSTGRES_CONTAINER="kds_postgres_prod"
    REDIS_CONTAINER="kds_redis_prod"
    BACKEND_CONTAINER="kds_backend_prod"
    FRONTEND_CONTAINER="kds_frontend_prod"
    LANDING_CONTAINER="kds_landing_prod"
    MARKETING_CONTAINER="kds_marketing_prod"
    BACKEND_IMG="$ghcr_base/backend"
    FRONTEND_IMG="$ghcr_base/frontend"
    LANDING_IMG="$ghcr_base/landing"
    MARKETING_IMG="$ghcr_base/marketing"
    API_LOCAL_URL="http://localhost:3000/api/health"
    API_PUBLIC_URL="https://hummytummy.com/api/health"
    FRONTEND_PUBLIC_URL="https://hummytummy.com"
    LANDING_PUBLIC_URL="https://hummytummy.com/landing"
    MARKETING_PUBLIC_URL="https://marketing.hummytummy.com"
    HEALTH_BUDGET_SEC=300
    BACKUP_RETENTION_DAYS=14
    BACKUP_PREFIX="prod"
  else
    COMPOSE_FILE="$PROJECT_ROOT/docker-compose.staging.yml"
    ENV_FILE="$PROJECT_ROOT/.env.test"
    POSTGRES_CONTAINER="kds_postgres_staging"
    REDIS_CONTAINER="kds_redis_staging"
    BACKEND_CONTAINER="kds_backend_staging"
    FRONTEND_CONTAINER="kds_frontend_staging"
    LANDING_CONTAINER="kds_landing_staging"
    MARKETING_CONTAINER="kds_marketing_staging"
    BACKEND_IMG="$ghcr_base/backend-staging"
    FRONTEND_IMG="$ghcr_base/frontend-staging"
    LANDING_IMG="$ghcr_base/landing-staging"
    MARKETING_IMG="$ghcr_base/marketing-staging"
    API_LOCAL_URL="http://localhost:3002/api/health"
    API_PUBLIC_URL="https://staging.hummytummy.com/api/health"
    FRONTEND_PUBLIC_URL="https://staging.hummytummy.com"
    LANDING_PUBLIC_URL="https://staging.hummytummy.com/landing"
    MARKETING_PUBLIC_URL=""
    # Bumped from the original 180s → 300s (route-mapping past 180s on
    # cold boots) → 600s. Run 26431353670 showed the HummyTummy-sized
    # image still hadn't responded to /api/health at the 300s mark.
    # NestJS now registers hundreds of routes from marketplace +
    # hardware-store + fiscal + caller + integration-gateway +
    # outbound-webhooks plus Prisma client introspection across 50+
    # tables and onModuleInit DB reads, so the cold path runs ~3-4 min.
    # 600s leaves comfortable margin; if a future boot exceeds that,
    # it's a real signal worth investigating.
    HEALTH_BUDGET_SEC=600
    BACKUP_RETENTION_DAYS=3
    BACKUP_PREFIX="staging"
  fi

  STATE_FILE="$STATE_DIR/last-images-${ENV}.env"
}

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# ====================================================================
# Steps
# ====================================================================

preflight() {
  command -v docker >/dev/null || { err "docker not on PATH"; return 1; }
  docker compose version >/dev/null 2>&1 || { err "docker compose v2 required"; return 1; }
  command -v curl >/dev/null  || { err "curl not on PATH"; return 1; }
  command -v gzip >/dev/null  || { err "gzip not on PATH"; return 1; }

  [ -f "$ENV_FILE" ]     || { err "env file missing: $ENV_FILE"; return 1; }
  [ -f "$COMPOSE_FILE" ] || { err "compose file missing: $COMPOSE_FILE"; return 1; }

  # State dir lives outside the repo so `git checkout` can't wipe it.
  if ! mkdir -p "$STATE_DIR" 2>/dev/null; then
    err "Cannot create $STATE_DIR — run once as root: sudo install -d -o $(id -un) $STATE_DIR"
    return 1
  fi

  # For deploys we need a version; for rollbacks we don't (state file
  # carries the SHAs we'll restore to).
  if [ "$ACTION" = "deploy" ] && [ -z "$VERSION" ]; then
    err "VERSION required for deploy (got empty)"
    return 1
  fi
}

backup_database() {
  local backup_dir="$PROJECT_ROOT/backups/database"
  mkdir -p "$backup_dir"
  local ts; ts=$(date +%Y%m%d_%H%M%S)
  local backup_file="$backup_dir/backup_${BACKUP_PREFIX}_${ts}.sql.gz"

  if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
    err "Postgres container '$POSTGRES_CONTAINER' not running — cannot back up"
    return 1
  fi

  # Pull DB name from env file without leaking secrets to the shell.
  local db_name db_user
  db_name=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2- | tr -d "'\"" || true)
  db_user=$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2- | tr -d "'\"" || true)
  db_name="${db_name:-restaurant_pos_prod}"
  db_user="${db_user:-postgres}"

  log "pg_dump '$db_name' → $backup_file"
  docker exec "$POSTGRES_CONTAINER" pg_dump -U "$db_user" -d "$db_name" \
    | gzip -c > "$backup_file"

  gzip -t "$backup_file" || { err "Archive failed gzip verify"; rm -f "$backup_file"; return 1; }

  local size_bytes
  size_bytes=$(stat -c '%s' "$backup_file" 2>/dev/null || stat -f '%z' "$backup_file" 2>/dev/null || echo 0)
  if [ "$size_bytes" -lt 1024 ]; then
    err "Backup smaller than 1KB ($size_bytes bytes) — refusing to proceed"
    rm -f "$backup_file"
    return 1
  fi

  # Cheap sanity: at least 5 CREATE statements implies the schema is
  # actually in the dump. Anything below that and we're looking at an
  # empty DB or a connection that died mid-dump.
  local create_count
  create_count=$(gzip -dc "$backup_file" | grep -cE '^(CREATE TABLE|CREATE INDEX|CREATE TYPE)' || true)
  if [ "$create_count" -lt 5 ]; then
    err "Backup contains only $create_count CREATE statements — looks bogus"
    rm -f "$backup_file"
    return 1
  fi
  ok "Backup verified: $backup_file ($size_bytes bytes, $create_count create stmts)"

  # Retention: keep the last N days. find on Linux uses -mtime +N (older than N).
  find "$backup_dir" -name "backup_${BACKUP_PREFIX}_*.sql.gz" -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete \
    | sed 's/^/[doctor] pruned /' || true
}

snapshot_image_ids() {
  : > "$STATE_FILE"
  local saved=0
  for entry in "BACKEND $BACKEND_CONTAINER" "FRONTEND $FRONTEND_CONTAINER" "LANDING $LANDING_CONTAINER" "MARKETING $MARKETING_CONTAINER"; do
    local role="${entry%% *}"
    local container="${entry##* }"
    local sha
    sha=$(docker inspect "$container" --format '{{.Image}}' 2>/dev/null || echo "")
    if [ -n "$sha" ]; then
      echo "${role}_PREV_IMAGE=$sha" >> "$STATE_FILE"
      log "Snapshot: $container → $sha"
      saved=$((saved + 1))
    else
      warn "$container not running — no prior SHA to snapshot"
    fi
  done
  log "Snapshot complete: $saved/4 containers (file: $STATE_FILE)"
}

pull_versioned_images() {
  # GHCR login if creds are present in env (CI sets these; on the box
  # we expect `docker login ghcr.io` to be cached already).
  if [ -n "${GHCR_USER:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  fi

  for img in "$BACKEND_IMG" "$FRONTEND_IMG" "$LANDING_IMG" "$MARKETING_IMG"; do
    log "docker pull $img:$VERSION"
    docker pull "$img:$VERSION"
  done
}

ensure_data_layer() {
  dc up -d postgres redis
  # 60s was the original budget; a `redis:7.2-alpine` recreate on a
  # fresh `start_period` setup overran it, so we give the data layer
  # 3 minutes. healthcheck interval is 10s with 5 retries = 50s in
  # the steady state, and start_period adds another 20s. 180s keeps
  # us comfortably above worst case without making a real failure
  # wait too long.
  local i=0 deadline=180
  local pg=starting redis_status=starting
  while [ $i -lt $deadline ]; do
    pg=$(docker inspect "$POSTGRES_CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo "starting")
    redis_status=$(docker inspect "$REDIS_CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo "starting")
    if [ "$pg" = "healthy" ] && [ "$redis_status" = "healthy" ]; then
      ok "postgres + redis healthy (took ~${i}s)"
      return 0
    fi
    sleep 3
    i=$((i + 3))
  done
  err "Data layer not healthy after ${deadline}s (postgres=$pg redis=$redis_status)"
  return 1
}

run_migration_doctor() {
  local db_name db_user
  db_name=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d "'\"" || true)
  db_user=$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d "'\"" || true)
  db_name="${db_name:-restaurant_pos_prod}"
  db_user="${db_user:-postgres}"
  # New-system DBs are provisioned with `prisma db push` (empty migration
  # ledger), so the doctor must baseline on first contact. It only does so
  # after proving via `migrate diff` that the live schema already equals
  # prisma/schema.prisma — so this is a no-op on an established DB (there
  # applied_migs>0 and the baseline branch is never reached). Override with
  # DOCTOR_AUTO_BASELINE=0 to restore the strict manual-baseline behaviour.
  DOCTOR_AUTO_BASELINE="${DOCTOR_AUTO_BASELINE:-1}" \
  "$SCRIPT_DIR/db-migration-doctor.sh" \
    "$BACKEND_CONTAINER" "$PROJECT_ROOT/backend" \
    "$POSTGRES_CONTAINER" "$db_user" "$db_name"
}

run_migrations_in_existing_backend() {
  # Migration runs inside the OLD container (additive-only policy
  # ensures the old client tolerates the new schema). If the old
  # container isn't usable — first deploy ever, OR it is crash-looping
  # / unhealthy — we skip here and let swap_backend() migrate inside the
  # freshly-started new container (it runs `prisma migrate deploy` too).
  #
  # NOTE: a crash-looping container still appears in `docker ps` with
  # status "Restarting", so a name-match guard would pass and then the
  # `docker exec` below would fail with "container is restarting, wait
  # until the container is running" — aborting the deploy before the new
  # image is ever swapped in, i.e. the deploy could not recover from a
  # crash-looped backend. Gate on actual State.Status instead.
  local status
  status=$(docker inspect -f '{{.State.Status}}' "$BACKEND_CONTAINER" 2>/dev/null || echo "missing")
  if [ "$status" != "running" ]; then
    log "Existing backend status=$status (not cleanly running) — migrations deferred to post-swap"
    return 0
  fi
  log "Applying pending migrations inside running $BACKEND_CONTAINER"
  docker exec "$BACKEND_CONTAINER" npx --no-install prisma migrate deploy
}

retag_to_current() {
  # Atomic swap of the :current pointer. docker tag is a metadata-only
  # operation; the daemon swaps the ref under a global lock.
  local img="$1"
  docker tag "$img:$VERSION" "$img:current"
}

verify_running_image() {
  local container="$1" repo="$2"
  local expected_sha
  expected_sha=$(docker image inspect "$repo:$VERSION" --format '{{.Id}}' 2>/dev/null || echo "")
  [ -n "$expected_sha" ] || { err "Image $repo:$VERSION not found locally"; return 1; }

  local running_sha
  running_sha=$(docker inspect "$container" --format '{{.Image}}' 2>/dev/null || echo "")
  if [ "$running_sha" != "$expected_sha" ]; then
    err "$container is NOT running $repo:$VERSION"
    err "  expected: $expected_sha"
    err "  running : $running_sha"
    return 1
  fi
  ok "$container is on $repo:$VERSION"
}

wait_until_healthy() {
  local url="$1" budget="${2:-$HEALTH_BUDGET_SEC}"
  local interval=5
  local attempts=$(( budget / interval ))
  local i=0
  log "Polling $url (≤ ${budget}s)"
  while [ $i -lt $attempts ]; do
    if curl -sf -o /dev/null --max-time 5 "$url"; then
      ok "$url healthy after $(( i * interval ))s"
      return 0
    fi
    sleep "$interval"
    i=$((i + 1))
  done
  err "$url did not respond within ${budget}s"
  # Forensic dump: when the backend never opens its listener, the
  # rollback path will recreate the container and we lose its logs.
  # Capture them here while the container still exists so the workflow
  # log includes the smoking gun. Best-effort — never let log capture
  # mask the original failure.
  if [[ "$url" == *":3002/api/health"* ]] || [[ "$url" == *":3000/api/health"* ]]; then
    log "─── backend logs (last 200) on health-probe failure ───"
    docker logs "$BACKEND_CONTAINER" --tail 200 2>&1 | sed 's/^/  /' || true
    log "─── backend container inspect (state) ───"
    docker inspect "$BACKEND_CONTAINER" --format '{{.State.Status}} pid={{.State.Pid}} exitCode={{.State.ExitCode}} oomKilled={{.State.OOMKilled}} error={{.State.Error}}' 2>&1 || true
    log "─── end forensic dump ───"
  fi
  return 1
}

swap_backend() {
  retag_to_current "$BACKEND_IMG"
  dc up -d --force-recreate backend
  # Compose returns immediately; give Docker a moment to swap containers.
  sleep 3
  verify_running_image "$BACKEND_CONTAINER" "$BACKEND_IMG"
  wait_until_healthy "$API_LOCAL_URL" "$HEALTH_BUDGET_SEC"
  # Re-run the doctor against the freshly-started backend. The
  # pre-swap pass (step 6) is a best-effort early warning; if the
  # backend container wasn't running at that point — first deploy,
  # or coming back from a hard stop — it skipped. Now we have a
  # live container, so this pass is the authoritative one.
  run_migration_doctor
  # Doctor only invokes migrate deploy when it auto-recovers a
  # failed migration. Pending-but-clean migrations are left for us
  # to apply explicitly here.
  log "Applying any pending migrations in new backend"
  docker exec "$BACKEND_CONTAINER" npx --no-install prisma migrate deploy
}

swap_app_containers() {
  retag_to_current "$FRONTEND_IMG"
  retag_to_current "$LANDING_IMG"
  retag_to_current "$MARKETING_IMG"
  dc up -d --force-recreate frontend landing marketing
  sleep 3
  verify_running_image "$FRONTEND_CONTAINER" "$FRONTEND_IMG"
  verify_running_image "$LANDING_CONTAINER"  "$LANDING_IMG"
  verify_running_image "$MARKETING_CONTAINER" "$MARKETING_IMG"
}

verify_and_promote() {
  # Public-facing smoke probes. These exercise the full stack
  # (nginx/cloudflare → frontend container → backend container → DB).
  wait_until_healthy "$API_PUBLIC_URL"      60
  wait_until_healthy "$FRONTEND_PUBLIC_URL" 60
  # Landing probe is best-effort — its URL layout has changed in the
  # past and we don't want a 301 to fail the deploy.
  wait_until_healthy "$LANDING_PUBLIC_URL"  30 || warn "Landing probe non-200 (likely a redirect)"
  # Marketing probe is prod-only + best-effort (staging has no subdomain).
  [ -n "$MARKETING_PUBLIC_URL" ] && { wait_until_healthy "$MARKETING_PUBLIC_URL" 30 || warn "Marketing probe non-200"; }

  # SSL cert expiry — warn at 14d, error at 3d.
  local host="${API_PUBLIC_URL#https://}"; host="${host%%/*}"
  local exp_str exp_ts now_ts days
  exp_str=$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null \
            | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || echo "")
  if [ -n "$exp_str" ]; then
    exp_ts=$(date -d "$exp_str" +%s 2>/dev/null || echo 0)
    now_ts=$(date +%s)
    days=$(( (exp_ts - now_ts) / 86400 ))
    if [ "$days" -le 3 ]; then
      err "SSL certificate expires in $days days — RENEW NOW"
      return 1
    elif [ "$days" -le 14 ]; then
      warn "SSL certificate expires in $days days"
    else
      ok "SSL certificate valid for $days more days"
    fi
  fi

  # :current already moved by swap_*. Image immutability proof:
  for img in "$BACKEND_IMG" "$FRONTEND_IMG" "$LANDING_IMG" "$MARKETING_IMG"; do
    local cur_sha ver_sha
    cur_sha=$(docker image inspect "$img:current" --format '{{.Id}}' 2>/dev/null || echo "")
    ver_sha=$(docker image inspect "$img:$VERSION" --format '{{.Id}}' 2>/dev/null || echo "")
    if [ "$cur_sha" != "$ver_sha" ] || [ -z "$cur_sha" ]; then
      err "$img:current does not match $img:$VERSION (cur=$cur_sha ver=$ver_sha)"
      return 1
    fi
  done
  ok "All :current tags point at $VERSION"
}

restore_image_ids() {
  if [ ! -f "$STATE_FILE" ]; then
    err "No snapshot at $STATE_FILE — cannot auto-rollback"
    return 1
  fi
  # shellcheck disable=SC1090
  source "$STATE_FILE"

  local restored=0
  if [ -n "${BACKEND_PREV_IMAGE:-}" ]; then
    log "Pinning backend :current → ${BACKEND_PREV_IMAGE}"
    docker tag "$BACKEND_PREV_IMAGE"  "$BACKEND_IMG:current"  || warn "backend retag failed"
    restored=$((restored + 1))
  fi
  if [ -n "${FRONTEND_PREV_IMAGE:-}" ]; then
    log "Pinning frontend :current → ${FRONTEND_PREV_IMAGE}"
    docker tag "$FRONTEND_PREV_IMAGE" "$FRONTEND_IMG:current" || warn "frontend retag failed"
    restored=$((restored + 1))
  fi
  if [ -n "${LANDING_PREV_IMAGE:-}" ]; then
    log "Pinning landing :current → ${LANDING_PREV_IMAGE}"
    docker tag "$LANDING_PREV_IMAGE"  "$LANDING_IMG:current"  || warn "landing retag failed"
    restored=$((restored + 1))
  fi
  if [ -n "${MARKETING_PREV_IMAGE:-}" ]; then
    log "Pinning marketing :current → ${MARKETING_PREV_IMAGE}"
    docker tag "$MARKETING_PREV_IMAGE" "$MARKETING_IMG:current" || warn "marketing retag failed"
    restored=$((restored + 1))
  fi

  if [ "$restored" -eq 0 ]; then
    err "Snapshot is empty — manual recovery required"
    return 1
  fi

  # marketing:current only exists after the first successful swap. On a deploy
  # that aborts before the swap (e.g. the migration doctor), the tag isn't
  # present yet, and recreating the service would make compose try to pull a
  # non-existent :current and fail the whole rollback. Recreate the core trio
  # unconditionally (prior behaviour); fold marketing in only when it resolves.
  if docker image inspect "$MARKETING_IMG:current" >/dev/null 2>&1; then
    dc up -d --force-recreate backend frontend landing marketing
  else
    warn "marketing :current absent (pre-first-deploy) — rolling back core services only"
    dc up -d --force-recreate backend frontend landing
  fi
  sleep 5
  wait_until_healthy "$API_LOCAL_URL" "$HEALTH_BUDGET_SEC" || warn "Post-rollback API not healthy"

  warn "Rollback complete. NOTE: image state is at previous SHA, DB state is forward."
  warn "If a migration applied in this failed deploy is incompatible with the prior image,"
  warn "manual DB intervention is required."
}

# Hook for future Slack/Discord/PagerDuty integration. Intentionally
# a no-op today so deploys don't depend on a webhook secret existing.
notify_failure() {
  : # _ env _ version _ line_number
  # Example future implementation:
  #   if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  #     curl -sS -X POST -H 'Content-Type: application/json' \
  #       -d "{\"text\":\":fire: $1 deploy failed at $2 (line $3)\"}" \
  #       "$SLACK_WEBHOOK_URL" >/dev/null || true
  #   fi
}

# ====================================================================
# Entry points
# ====================================================================

run_deploy() {
  log "=== Deploy: $ENV @ $VERSION ==="
  step "1/10 Preflight"                  preflight
  step "2/10 Backup database"            backup_database
  step "3/10 Snapshot image SHAs"        snapshot_image_ids
  step "4/10 Pull new images"            pull_versioned_images
  step "5/10 Postgres + Redis up"        ensure_data_layer
  step "6/10 Migration doctor"           run_migration_doctor
  step "7/10 Migrate (existing backend)" run_migrations_in_existing_backend
  step "8/10 Swap backend"               swap_backend
  step "9/10 Swap frontend + landing"    swap_app_containers
  step "10/10 Verify + promote :current" verify_and_promote
  ok "=== Deploy SUCCESS: $ENV @ $VERSION ==="
}

run_rollback() {
  log "=== Rollback requested: $ENV ==="
  step "Preflight"          preflight
  step "Restore image SHAs" restore_image_ids
  ok "=== Rollback DONE ==="
}

on_failure() {
  # BASH_LINENO[0] is the line in this script that triggered ERR.
  local line="${BASH_LINENO[0]:-?}"
  err "❌ FAILED at line $line — running rollback"
  set +e   # rollback itself must not re-trigger the trap
  restore_image_ids
  notify_failure "$ENV" "${VERSION:-?}" "$line"
  exit 1
}

# ====================================================================
# Main
# ====================================================================

configure_env "$@"

# Install ERR trap ONLY for deploys. Rollback shouldn't recurse if
# the rollback itself fails (we'd just spin forever).
if [ "$ACTION" = "deploy" ]; then
  trap on_failure ERR
  run_deploy
else
  run_rollback
fi
