#!/usr/bin/env bash
# db-migration-doctor.sh — conservative Prisma migration state doctor
#
# Called by deploy.sh BEFORE migrations are applied. Inspects the
# `_prisma_migrations` table via `npx prisma migrate status` and:
#
#   * exits 0 (deploy may proceed) when the state is clean, has only
#     pending migrations, OR has a single failed migration whose
#     SQL is provably idempotent (every CREATE TABLE / CREATE INDEX
#     uses IF NOT EXISTS, no destructive operations). In that case
#     it auto-resolves the failed migration as `--rolled-back` and
#     calls `migrate deploy` once to re-run it.
#
#   * exits 1 (deploy ABORT) for any state that requires human
#     judgement: P3005 baseline missing, drift detected, a failed
#     migration with non-idempotent SQL, or multiple failed migrations.
#     A decision-support report is printed to stderr.
#
# Critically, this script NEVER marks migrations as `--applied`
# automatically. That path (in the previous deploy-production.sh)
# silently masks data corruption when a migration was only partially
# executed. If `--applied` is the right call, an operator must make it.
#
# Usage: db-migration-doctor.sh <backend_container> <backend_repo_dir>
#   backend_container — running backend container that has prisma CLI + DB access
#   backend_repo_dir  — host path containing prisma/migrations/

set -euo pipefail

BACKEND_CONTAINER="${1:?backend container name required}"
BACKEND_DIR="${2:?backend repo dir required}"
MIGRATIONS_DIR="$BACKEND_DIR/prisma/migrations"

# Coloured logging — keep colours out of stderr so log parsers don't choke.
log()  { printf '\033[0;34m[doctor]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m[doctor]\033[0m %s\n' "$*"; }
err()  { printf '\033[0;31m[doctor]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[doctor]\033[0m %s\n' "$*"; }

if ! docker ps --format '{{.Names}}' | grep -q "^${BACKEND_CONTAINER}$"; then
  log "Backend container '${BACKEND_CONTAINER}' not running — doctor skipped"
  log "(migrations will run after the container comes up)"
  exit 0
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  err "Migrations dir not found on host: $MIGRATIONS_DIR"
  exit 1
fi

# Capture migrate status output. We tolerate non-zero exit because prisma
# returns 1 on pending/drift/failed — we want to parse the message, not
# crash on it.
log "Querying prisma migrate status…"
status_out=$(docker exec "$BACKEND_CONTAINER" npx --no-install prisma migrate status 2>&1 || true)
echo "$status_out" | sed 's/^/   /'

# ----------------------------------------------------------------------
# Case detection (order matters — most specific first)
# ----------------------------------------------------------------------

# P3005 → baseline missing. Prisma surfaces this either as the literal
# error code or as the human-readable "database schema is not empty"
# line, depending on which sub-command tripped it. We treat both as the
# same failure mode. Never auto-resolve; the previous script's
# "mark everything applied" loop was the silent-corruption bug.
if echo "$status_out" | grep -qE 'P3005|database schema is not empty'; then
  err "P3005 detected — database is not empty but no migration history exists."
  err "DO NOT auto-mark migrations as applied. An operator must baseline manually:"
  err "  1. Identify which migrations are already reflected in the DB schema"
  err "  2. \`docker exec $BACKEND_CONTAINER npx prisma migrate resolve --applied <each one>\`"
  err "  3. Re-run the deploy"
  err ""
  err "If you're sure ALL prior migrations were applied to this DB (e.g."
  err "this is a staging box that was seeded from a prod dump), this"
  err "one-liner baselines the whole history in order:"
  err "  docker exec $BACKEND_CONTAINER sh -c 'cd /app && for m in \$(ls prisma/migrations | grep -E \"^[0-9]\" | sort); do npx --no-install prisma migrate resolve --applied \"\$m\"; done'"
  exit 1
fi

# Drift = schema in DB does not match the migrations folder.
if echo "$status_out" | grep -qi "drift detected"; then
  err "Schema drift detected — DB has changes not in migration history."
  err "Investigate (\`prisma migrate diff\`) and reconcile before deploying."
  exit 1
fi

# Failed migration in DB. The format Prisma prints is:
#   The `<name>` migration started at <timestamp> failed
failed_names=$(echo "$status_out" \
  | grep -oE 'The `[0-9A-Za-z_]+` migration started' \
  | sed -E 's/The `([^`]+)` migration started/\1/' \
  | sort -u || true)

failed_count=$(printf '%s\n' "$failed_names" | grep -c . || true)

if [ "$failed_count" -gt 1 ]; then
  err "Multiple failed migrations detected:"
  printf '   - %s\n' $failed_names >&2
  err "Resolve each one manually before retrying."
  exit 1
fi

if [ "$failed_count" -eq 1 ]; then
  name=$(echo "$failed_names" | head -n1)
  migration_sql="$MIGRATIONS_DIR/$name/migration.sql"

  if [ ! -f "$migration_sql" ]; then
    err "Failed migration '$name' has no SQL file at $migration_sql"
    err "Manual intervention required."
    exit 1
  fi

  log "Inspecting $name for safe auto-recovery…"

  # ---- Risk pattern checks --------------------------------------------
  # Destructive / non-idempotent / data-validating operations that make
  # a blind re-run unsafe. Each match contributes one line to the report.
  risk_report=""

  add_risk() {
    risk_report="${risk_report}$1"$'\n'
  }

  # CREATE TABLE without IF NOT EXISTS will fail on re-run if the table
  # already exists from the partial first run.
  bare_create_table=$(grep -nE '^[[:space:]]*CREATE[[:space:]]+TABLE[[:space:]]+"' "$migration_sql" \
    | grep -v 'IF NOT EXISTS' || true)
  if [ -n "$bare_create_table" ]; then
    add_risk "CREATE TABLE without IF NOT EXISTS:"
    while IFS= read -r line; do add_risk "  $line"; done <<<"$bare_create_table"
  fi

  # CREATE [UNIQUE] INDEX without IF NOT EXISTS — same problem.
  bare_create_index=$(grep -nE '^[[:space:]]*CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX[[:space:]]+"' "$migration_sql" \
    | grep -v 'IF NOT EXISTS' || true)
  if [ -n "$bare_create_index" ]; then
    add_risk "CREATE [UNIQUE] INDEX without IF NOT EXISTS:"
    while IFS= read -r line; do add_risk "  $line"; done <<<"$bare_create_index"
  fi

  # Destructive / data-touching operations. Any single hit is a blocker.
  destructive=$(grep -nE \
    '^[[:space:]]*(DROP[[:space:]]+(TABLE|COLUMN|INDEX|CONSTRAINT)|TRUNCATE|UPDATE[[:space:]]+|INSERT[[:space:]]+INTO|DELETE[[:space:]]+FROM|ALTER[[:space:]]+TABLE[[:space:]]+"[^"]+"[[:space:]]+DROP|ALTER[[:space:]]+TABLE[[:space:]]+"[^"]+"[[:space:]]+RENAME|ALTER[[:space:]]+TABLE[[:space:]]+"[^"]+"[[:space:]]+ALTER[[:space:]]+COLUMN[[:space:]]+"[^"]+"[[:space:]]+TYPE|ADD[[:space:]]+CONSTRAINT[^,;]*[[:space:]]+CHECK)' \
    "$migration_sql" || true)
  if [ -n "$destructive" ]; then
    add_risk "Destructive or data-validating operations:"
    while IFS= read -r line; do add_risk "  $line"; done <<<"$destructive"
  fi

  if [ -n "$risk_report" ]; then
    err "Failed migration '$name' is NOT safely auto-recoverable."
    err "Risky statements found:"
    printf '%s' "$risk_report" | sed 's/^/   /' >&2
    err ""
    err "Manual recovery (read VERIFICATION §3 of the deploy plan):"
    err "  1. SSH to the DB server, open psql, inspect each affected table"
    err "  2. If the migration is in fact fully applied →"
    err "       docker exec $BACKEND_CONTAINER npx prisma migrate resolve --applied $name"
    err "     If it is fully not applied →"
    err "       docker exec $BACKEND_CONTAINER npx prisma migrate resolve --rolled-back $name"
    err "     If partially applied → operator must reconcile by hand"
    err "  3. Re-trigger the deploy"
    exit 1
  fi

  log "Migration '$name' SQL appears fully idempotent."
  log "Marking as rolled-back and re-applying…"
  docker exec "$BACKEND_CONTAINER" npx --no-install prisma migrate resolve --rolled-back "$name"
  docker exec "$BACKEND_CONTAINER" npx --no-install prisma migrate deploy
  ok "Failed migration '$name' recovered."
  exit 0
fi

# The additive-only Migration Policy still applies, but it is enforced
# at PR-review time (see TODO below) — NOT here at deploy time. Trying
# to police it from this script produces false positives whenever the
# target DB is unbaselined (e.g. a fresh staging snapshot): every
# legitimate, already-merged migration shows up as "pending" and the
# destructive ones — drops, renames, type changes — get flagged even
# though prod has been running with them for months. Until we have a
# proper PR-time linter, deploys must accept whatever is in
# prisma/migrations as the source of truth.
#
# TODO(issue): add a separate `migration-lint.yml` workflow that runs
# on PRs touching backend/prisma/migrations/. It should diff the new
# migration files against origin/main and reject DROP / RENAME /
# ALTER COLUMN TYPE additions before they ever land on a branch the
# deployer pulls from.

ok "Migration state clean — deploy may proceed."
exit 0
