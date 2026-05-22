#!/usr/bin/env bash
# Compatibility shim — defer to the unified deploy.sh.
# This file exists so older runbooks / cron jobs / SSH muscle memory
# keep working while we cut over to the unified script.
#
# Remove one release after v2.8.77 ships cleanly.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<EOF
deploy-production.sh — DEPRECATED shim. Use deploy.sh directly.

Usage:
  deploy-production.sh deploy <vX.Y.Z>   → ./deploy.sh prod <vX.Y.Z>
  deploy-production.sh rollback           → ./deploy.sh prod-rollback
  deploy-production.sh backup             → ./backup-database.sh prod
  deploy-production.sh status             → docker compose -f docker-compose.prod.yml ps
EOF
}

cmd="${1:-}"
shift || true

case "$cmd" in
  deploy)
    version="${1:?usage: deploy-production.sh deploy <vX.Y.Z>}"
    exec "$SCRIPT_DIR/deploy.sh" prod "$version"
    ;;
  rollback)
    exec "$SCRIPT_DIR/deploy.sh" prod-rollback
    ;;
  backup)
    exec "$SCRIPT_DIR/backup-database.sh" prod
    ;;
  status)
    docker compose -f "$(dirname "$SCRIPT_DIR")/docker-compose.prod.yml" ps
    ;;
  ""|-h|--help|help)
    usage
    [ -z "$cmd" ] && exit 1 || exit 0
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage >&2
    exit 1
    ;;
esac
