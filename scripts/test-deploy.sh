#!/usr/bin/env bash
# Compatibility shim — defer to the unified deploy.sh for staging.
# See deploy-production.sh for the rationale.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<EOF
test-deploy.sh — DEPRECATED shim. Use deploy.sh directly.

Usage:
  test-deploy.sh deploy <commit-sha>   → ./deploy.sh staging <sha>
  test-deploy.sh rollback              → ./deploy.sh staging-rollback
  test-deploy.sh backup                → ./backup-database.sh staging
  test-deploy.sh status                → docker compose -f docker-compose.staging.yml ps
  test-deploy.sh health                → curl staging /api/health
EOF
}

cmd="${1:-deploy}"
shift || true

case "$cmd" in
  deploy)
    version="${1:?usage: test-deploy.sh deploy <commit-sha>}"
    exec "$SCRIPT_DIR/deploy.sh" staging "$version"
    ;;
  rollback)
    exec "$SCRIPT_DIR/deploy.sh" staging-rollback
    ;;
  backup)
    exec "$SCRIPT_DIR/backup-database.sh" staging
    ;;
  status)
    docker compose -f "$(dirname "$SCRIPT_DIR")/docker-compose.staging.yml" ps
    ;;
  health)
    curl -sf http://localhost:3002/api/health \
      && echo "ok" \
      || { echo "unhealthy" >&2; exit 1; }
    ;;
  -h|--help|help)
    usage; exit 0 ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage >&2
    exit 1
    ;;
esac
