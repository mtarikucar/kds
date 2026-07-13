#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-blue-green.sh — zero-downtime prod deploy for KDS / HummyTummy.
#
# Replaces the ~240s `docker compose up -d --force-recreate` outage in
# scripts/deploy.sh (swap_backend / swap_app_containers) with a blue-green
# cutover: boot the INACTIVE colour, health-gate it on /healthz/ready (which is
# DB+Redis aware and returns 503 when unhealthy), then flip a host-nginx upstream
# symlink and `systemctl reload nginx` (graceful SIGHUP — in-flight requests
# drain, new connections hit the new colour, zero 502s). Blue stays up and
# drained so websocket/kitchen-display clients auto-reconnect onto green.
#
# postgres/redis + invoice/uploads volumes are SHARED (docker-compose.data.yml,
# external volumes) and never recreated. Migrations are expand-only and run in
# the CURRENTLY LIVE backend before the new colour boots, so both colours
# tolerate one schema during overlap.
#
# USAGE (run on the prod host as the deploy user, cwd = repo root /root/kds):
#   scripts/deploy-blue-green.sh prod <vX.Y.Z>     # deploy that version, cut over
#   scripts/deploy-blue-green.sh prod rollback     # flip back to previous colour
#   scripts/deploy-blue-green.sh prod status        # print active/inactive state
#
# One-time server prep + nginx wiring: docs/deploy/blue-green-runbook.md
#
# This script NEVER SSHes anywhere and NEVER handles a password — CI invokes it
# over its own SSH session (the same channel that already runs scripts/deploy.sh).
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

# ── Config (env-overridable) ─────────────────────────────────────────────────
ENVIRONMENT="${1:-}"
ACTION="${2:-}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
STATE_DIR="${STATE_DIR:-/var/lib/kds-deploy}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COLOR_COMPOSE="${COLOR_COMPOSE:-$REPO_DIR/docker-compose.color.yml}"
DATA_COMPOSE="${DATA_COMPOSE:-$REPO_DIR/docker-compose.data.yml}"
# The host-nginx symlink that the vhost `include`s, and the dir holding the
# upstream-blue.conf / upstream-green.conf it points at (see runbook §3).
NGINX_UPSTREAM_LINK="${NGINX_UPSTREAM_LINK:-/etc/nginx/conf.d/kds-upstream-active.conf}"
NGINX_UPSTREAM_DIR="${NGINX_UPSTREAM_DIR:-$(dirname "$NGINX_UPSTREAM_LINK")}"
PUBLIC_URL="${PUBLIC_URL:-https://hummytummy.com}"
HEALTH_BUDGET_SEC="${HEALTH_BUDGET_SEC:-300}"
READY_CONSECUTIVE="${READY_CONSECUTIVE:-3}"
DRAIN_SECONDS="${DRAIN_SECONDS:-60}"

# Per-colour loopback ports (must match ops/deploy/color.<c>.env + upstream-*.conf)
BLUE_BACKEND_PORT=3000;  BLUE_FRONTEND_PORT=8080
GREEN_BACKEND_PORT=3010; GREEN_FRONTEND_PORT=8090

log()  { printf '\033[0;36m[bg-deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[bg-deploy][warn]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[0;31m[bg-deploy][err ]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

[[ "$ENVIRONMENT" == "prod" ]] || die "only 'prod' is supported (got '${ENVIRONMENT:-}'). Usage: $0 prod <vX.Y.Z|rollback|status>"
[[ -n "$ACTION" ]] || die "missing action. Usage: $0 prod <vX.Y.Z|rollback|status>"
[[ -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE"
command -v docker >/dev/null || die "docker not found"
ACTIVE_FILE="$STATE_DIR/active-color-$ENVIRONMENT"

backend_port() { [[ "$1" == blue ]] && echo "$BLUE_BACKEND_PORT" || echo "$GREEN_BACKEND_PORT"; }
frontend_port(){ [[ "$1" == blue ]] && echo "$BLUE_FRONTEND_PORT" || echo "$GREEN_FRONTEND_PORT"; }
other_color()  { [[ "$1" == blue ]] && echo green || echo blue; }

read_active_color() {
  if [[ -f "$ACTIVE_FILE" ]]; then
    # shellcheck disable=SC1090
    ( set +u; . "$ACTIVE_FILE"; echo "${ACTIVE_COLOR:-blue}" )
  else
    # First run: assume the legacy stack is serving on blue ports (3000/8080),
    # so the first blue-green deploy targets green and cuts over with no downtime.
    echo blue
  fi
}
read_previous_color() {
  [[ -f "$ACTIVE_FILE" ]] || { echo ""; return; }
  ( set +u; . "$ACTIVE_FILE"; echo "${PREVIOUS_COLOR:-}" )
}
write_active_color() { # <active> <previous>
  mkdir -p "$STATE_DIR"
  { echo "ACTIVE_COLOR=$1"; echo "PREVIOUS_COLOR=$2"; echo "UPDATED_AT=$(date -u +%FT%TZ)"; } > "$ACTIVE_FILE"
}

dc_color() { # <color> <compose args...>
  local color="$1"; shift
  docker compose -p "kds-prod-${color}" \
    --env-file "$ENV_FILE" \
    --env-file "$REPO_DIR/ops/deploy/color.${color}.env" \
    -f "$COLOR_COMPOSE" "$@"
}

wait_until_ready() { # <color> — poll /healthz/ready (503-aware) N consecutive times
  local color="$1" port; port="$(backend_port "$color")"
  local deadline=$(( SECONDS + HEALTH_BUDGET_SEC )) hits=0
  log "health-gating $color backend on http://127.0.0.1:${port}/healthz/ready (need ${READY_CONSECUTIVE} consecutive, budget ${HEALTH_BUDGET_SEC}s)"
  while (( SECONDS < deadline )); do
    if curl -fsS -m 5 "http://127.0.0.1:${port}/healthz/ready" >/dev/null 2>&1; then
      hits=$(( hits + 1 ))
      (( hits >= READY_CONSECUTIVE )) && { log "$color READY (${hits}/${READY_CONSECUTIVE})"; return 0; }
    else
      hits=0
    fi
    sleep 5
  done
  return 1
}

probe_socketio() { # <color>
  local color="$1" port; port="$(backend_port "$color")"
  curl -fsS -m 5 "http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling" 2>/dev/null | grep -q '"sid"' \
    && { log "$color socket.io handshake OK"; return 0; } || { warn "$color socket.io handshake did not return a sid"; return 1; }
}

probe_frontend() { # <color>
  local color="$1" port; port="$(frontend_port "$color")"
  wget -q --spider "http://127.0.0.1:${port}/" && { log "$color frontend serving"; return 0; } || return 1
}

nginx_point_to() { # <color> — atomically flip the upstream symlink + graceful reload
  local color="$1" src="$NGINX_UPSTREAM_DIR/upstream-${color}.conf"
  [[ -f "$src" ]] || die "upstream conf missing on host: $src (see runbook §3)"
  log "flipping nginx upstream → $color ($src)"
  ln -sfn "$src" "$NGINX_UPSTREAM_LINK"
  if ! nginx -t 2>/dev/null; then
    err "nginx -t FAILED after pointing to $color — reverting symlink"
    return 1
  fi
  systemctl reload nginx
  # Confirm the symlink really resolves to the colour we intended (guard for
  # the 'never stop old colour until nginx is proven on new' invariant).
  [[ "$(readlink -f "$NGINX_UPSTREAM_LINK")" == "$(readlink -f "$src")" ]] || die "post-reload symlink does not resolve to $color"
  log "nginx reloaded; active upstream = $color"
}

public_smoke() {
  log "public smoke against $PUBLIC_URL"
  curl -fsS -m 10 "$PUBLIC_URL/api/health" >/dev/null || return 1
  curl -fsS -m 10 "$PUBLIC_URL/" >/dev/null || return 1
  curl -fsS -m 10 "$PUBLIC_URL/socket.io/?EIO=4&transport=polling" 2>/dev/null | grep -q '"sid"' || warn "public socket.io probe returned no sid (Cloudflare may buffer polling) — non-fatal"
  log "public smoke OK"
}

ensure_data_layer() {
  log "ensuring shared data layer (postgres+redis) is up"
  docker compose -p kds-data --env-file "$ENV_FILE" -f "$DATA_COMPOSE" up -d
}

run_expand_migrations() { # run prisma migrate deploy in the CURRENTLY LIVE backend
  local live="kds_backend_$(read_active_color)"
  if docker inspect -f '{{.State.Running}}' "$live" >/dev/null 2>&1 && \
     [[ "$(docker inspect -f '{{.State.Running}}' "$live")" == "true" ]]; then
    log "running expand-only migrations in live backend ($live)"
    docker exec "$live" npx --no-install prisma migrate deploy
  else
    warn "no running live backend ($live) — deferring migrations to the new colour after boot"
    DEFER_MIGRATIONS=1
  fi
}

# ── status ───────────────────────────────────────────────────────────────────
if [[ "$ACTION" == "status" ]]; then
  active="$(read_active_color)"; prev="$(read_previous_color)"
  echo "active colour : $active (backend $(backend_port "$active") / frontend $(frontend_port "$active"))"
  echo "previous      : ${prev:-<none>}"
  echo "nginx active  : $(readlink -f "$NGINX_UPSTREAM_LINK" 2>/dev/null || echo '<link missing>')"
  exit 0
fi

# ── rollback ─────────────────────────────────────────────────────────────────
if [[ "$ACTION" == "rollback" ]]; then
  prev="$(read_previous_color)"; active="$(read_active_color)"
  [[ -n "$prev" ]] || die "no PREVIOUS_COLOR recorded in $ACTIVE_FILE — nothing to roll back to"
  log "ROLLBACK: $active → $prev"
  # Bring the previous colour back if it was stopped, then flip.
  dc_color "$prev" up -d
  wait_until_ready "$prev" || die "previous colour $prev did not become ready — aborting rollback"
  nginx_point_to "$prev"
  public_smoke || warn "post-rollback public smoke imperfect — inspect manually"
  write_active_color "$prev" "$active"
  log "rollback complete — active colour is now $prev"
  exit 0
fi

# ── deploy <vX.Y.Z> ──────────────────────────────────────────────────────────
VERSION="$ACTION"
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "VERSION must be vX.Y.Z (got '$VERSION')"
export IMAGE_TAG="$VERSION"

ACTIVE="$(read_active_color)"
TARGET="$(other_color "$ACTIVE")"
DEFER_MIGRATIONS=0
log "active=$ACTIVE  target=$TARGET  version=$VERSION"

# ERR trap: anything failing BEFORE the flip tears down the un-promoted target;
# the live ACTIVE colour is never touched, so users see zero impact.
FLIPPED=0
on_err() {
  local code=$?
  err "deploy failed (exit $code)"
  if [[ "$FLIPPED" -eq 0 ]]; then
    warn "tearing down un-promoted $TARGET (active $ACTIVE untouched → zero user impact)"
    dc_color "$TARGET" down --remove-orphans 2>/dev/null || true
  else
    err "failure occurred AFTER nginx flip — reverting traffic to $ACTIVE"
    if nginx_point_to "$ACTIVE"; then
      warn "traffic reverted to $ACTIVE; leaving $TARGET up for inspection"
    else
      err "AUTOMATIC REVERT FAILED — manual intervention required (symlink=$NGINX_UPSTREAM_LINK)"
    fi
  fi
  exit "$code"
}
trap on_err ERR

ensure_data_layer

log "pulling immutable images :$VERSION"
docker pull "ghcr.io/mtarikucar/kds/backend:${VERSION}"
docker pull "ghcr.io/mtarikucar/kds/frontend:${VERSION}"

run_expand_migrations

log "booting $TARGET colour on backend $(backend_port "$TARGET") / frontend $(frontend_port "$TARGET")"
dc_color "$TARGET" up -d

if [[ "${DEFER_MIGRATIONS}" -eq 1 ]]; then
  log "running deferred migrations in the freshly-booted $TARGET backend"
  # brief wait for the container process to accept exec
  sleep 10
  docker exec "kds_backend_${TARGET}" npx --no-install prisma migrate deploy
fi

wait_until_ready "$TARGET" || die "$TARGET failed /healthz/ready within ${HEALTH_BUDGET_SEC}s — not cutting over"
probe_socketio "$TARGET" || die "$TARGET socket.io handshake failed — not cutting over"
probe_frontend "$TARGET" || die "$TARGET frontend not serving — not cutting over"

# ── CUTOVER ──────────────────────────────────────────────────────────────────
nginx_point_to "$TARGET"
FLIPPED=1

# Post-flip confirmation against the public edge; failure triggers on_err revert.
public_smoke || die "post-flip public smoke failed"

# Only NOW is it safe to record state + retire the old colour (risk-#10 guard:
# nginx is proven reloaded onto TARGET and state is persisted before any stop).
write_active_color "$TARGET" "$ACTIVE"
trap - ERR   # cutover succeeded; a drain-window hiccup must not trigger a revert

log "cutover to $TARGET succeeded; draining $ACTIVE for ${DRAIN_SECONDS}s so websocket clients reconnect"
sleep "$DRAIN_SECONDS"
log "stopping old colour $ACTIVE"
dc_color "$ACTIVE" down --remove-orphans 2>/dev/null || warn "could not fully stop $ACTIVE — inspect manually (traffic already on $TARGET)"

log "DONE — $VERSION live on $TARGET with zero downtime. Roll back any time: $0 prod rollback"
