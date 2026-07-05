#!/usr/bin/env bash
# Idempotent bring-up of the KDS monitoring stack (compose project
# `kds-monitoring`). Fed from the SAME rendered env file as the prod app so
# METRICS_TOKEN / SMTP / DB / Redis creds never drift. Safe to re-run on every
# deploy; `restart: unless-stopped` handles reboots. Called as a best-effort,
# NON-FATAL final step of scripts/deploy.sh — it can never roll back the app.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/root/kds}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="$REPO_DIR/docker-compose.monitoring.yml"
KDS_NETWORK="${KDS_NETWORK:-kds-prod_kds_network}"

if [ ! -f "$ENV_FILE" ]; then
  echo "monitoring up: $ENV_FILE not found — skipping" >&2
  exit 0
fi

# Degrade-only: stay inert until the operator provisions the Grafana password
# secret, rather than erroring on every deploy.
if ! grep -qE '^GRAFANA_ADMIN_PASSWORD=..*' "$ENV_FILE"; then
  echo "monitoring up: GRAFANA_ADMIN_PASSWORD not set in $ENV_FILE — skipping (set the secret to enable monitoring)" >&2
  exit 0
fi

# The app network must exist (prod stack up) for the external `kds_app` join.
if ! docker network inspect "$KDS_NETWORK" >/dev/null 2>&1; then
  echo "monitoring up: docker network '$KDS_NETWORK' not found — is the prod stack up? skipping" >&2
  exit 0
fi

cd "$REPO_DIR"
KDS_NETWORK="$KDS_NETWORK" docker compose \
  -p kds-monitoring \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up -d --remove-orphans

echo "monitoring up: kds-monitoring stack reconciled"
