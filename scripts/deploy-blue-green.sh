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
# the freshly-booted NEW colour (its image contains the new migration files)
# BEFORE the nginx flip, so the still-serving old colour tolerates the expanded
# schema during the overlap window.
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
# MUST live OUTSIDE the stock `include /etc/nginx/conf.d/*.conf;` glob — both
# colour fragments declare the same `upstream kds_backend`/`kds_frontend`, so if
# the glob loaded them nginx -t would fail with "duplicate upstream" and the
# flip could never validate. A dedicated dir is included exactly once by the vhost.
NGINX_UPSTREAM_LINK="${NGINX_UPSTREAM_LINK:-/etc/nginx/kds-upstreams/kds-upstream-active.conf}"
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
    # No state file yet — this is the first deploy after §4's manual blue boot,
    # so blue is active and the first flip targets green. (The script does NOT
    # cut over directly from the legacy stack; §2 retires legacy first, enforced
    # by assert_no_legacy_stack.)
    echo blue
  fi
}
read_previous_color() {
  [[ -f "$ACTIVE_FILE" ]] || { echo ""; return; }
  ( set +u; . "$ACTIVE_FILE"; echo "${PREVIOUS_COLOR:-}" )
}
read_color_version() { # <color> — the image tag last deployed to that colour
  [[ -f "$ACTIVE_FILE" ]] || { echo ""; return; }
  ( set +u; . "$ACTIVE_FILE"; local c="$1"; eval "echo \"\${VERSION_${c}:-}\"" )
}
write_active_color() { # <active> <previous> [active_version]
  # Persist the per-colour image tag alongside the colours so `rollback` can
  # re-boot the previous colour at the EXACT version it ran — not the movable
  # ":current" tag (which this script never advances, so it would resurrect a
  # stale/legacy image). The active colour's version updates; the other colour
  # keeps whatever it last ran.
  mkdir -p "$STATE_DIR"
  local active="$1" prev="$2" av="${3:-$(read_color_version "$1")}"
  local pv; pv="$(read_color_version "$prev")"
  {
    echo "ACTIVE_COLOR=$active"
    echo "PREVIOUS_COLOR=$prev"
    echo "VERSION_${active}=$av"
    [[ -n "$prev" ]] && echo "VERSION_${prev}=$pv"
    echo "UPDATED_AT=$(date -u +%FT%TZ)"
  } > "$ACTIVE_FILE"
}

# Authenticate to GHCR for private image pulls, mirroring scripts/deploy.sh.
# CI exports GHCR_USER/GHCR_TOKEN into this SSH session; a manual run on the box
# without creds clears any stale (revoked GITHUB_TOKEN) cache so anonymous pulls
# of public packages still work.
ghcr_login() {
  if [[ -n "${GHCR_USER:-}" && -n "${GHCR_TOKEN:-}" ]]; then
    log "docker login ghcr.io as ${GHCR_USER}"
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  else
    warn "no GHCR_USER/GHCR_TOKEN — clearing any stale ghcr.io cred (anonymous pull)"
    docker logout ghcr.io >/dev/null 2>&1 || true
  fi
}

# Abort cleanly if the box still runs the LEGACY single-stack (project kds-prod).
# The data plane reuses container_name kds_postgres_prod/kds_redis_prod, so
# starting blue-green while legacy is up would collide; §2 must retire legacy
# first. Fail loud with a pointer instead of a raw "name already in use".
assert_no_legacy_stack() {
  local legacy
  legacy="$(docker ps -a --filter 'label=com.docker.compose.project=kds-prod' \
              --format '{{.Names}}' 2>/dev/null | tr '\n' ' ')"
  if [[ -n "${legacy// /}" ]]; then
    die "legacy kds-prod containers still present ($legacy) — complete blue-green-runbook §2 (retire the legacy stack) before deploying blue-green"
  fi
}

dc_color() { # <color> <compose args...>
  local color="$1"; shift
  docker compose -p "kds-prod-${color}" \
    --env-file "$ENV_FILE" \
    --env-file "$REPO_DIR/ops/deploy/color.${color}.env" \
    -f "$COLOR_COMPOSE" "$@"
}

wait_until_ready() { # <color> — poll /api/healthz/ready (503-aware) N consecutive times
  # The route is served UNDER the global "api" prefix (backend main.ts calls
  # setGlobalPrefix("api") with no exclude), so it lives at /api/healthz/ready
  # — NOT /healthz/ready. Probing the un-prefixed path 404s forever and every
  # deploy would fail the gate before the flip.
  local color="$1" port; port="$(backend_port "$color")"
  local deadline=$(( SECONDS + HEALTH_BUDGET_SEC )) hits=0
  log "health-gating $color backend on http://127.0.0.1:${port}/api/healthz/ready (need ${READY_CONSECUTIVE} consecutive, budget ${HEALTH_BUDGET_SEC}s)"
  while (( SECONDS < deadline )); do
    if curl -fsS -m 5 "http://127.0.0.1:${port}/api/healthz/ready" >/dev/null 2>&1; then
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
  # return (not die) so a caller wrapped in gate()/on the deploy path runs the
  # recovery handler instead of exiting raw.
  [[ -f "$src" ]] || { err "upstream conf missing on host: $src (see runbook §3)"; return 1; }
  # Snapshot the current target so a failed nginx -t can be truly reverted —
  # otherwise the on-disk symlink is left pointing at an unvalidated config and
  # the next unrelated reload (certbot/logrotate/reboot) detonates it.
  local prev; prev="$(readlink "$NGINX_UPSTREAM_LINK" 2>/dev/null || true)"
  log "flipping nginx upstream → $color ($src)"
  ln -sfn "$src" "$NGINX_UPSTREAM_LINK"
  if ! nginx -t; then
    err "nginx -t FAILED after pointing to $color — restoring previous symlink ($prev)"
    if [[ -n "$prev" ]]; then ln -sfn "$prev" "$NGINX_UPSTREAM_LINK"; else rm -f "$NGINX_UPSTREAM_LINK"; fi
    nginx -t >/dev/null 2>&1 || err "even the RESTORED nginx config fails -t — pre-existing breakage; do NOT reload nginx until fixed (disk restored to ${prev:-<none>})"
    return 1
  fi
  systemctl reload nginx
  # Confirm the symlink really resolves to the colour we intended (guard for
  # the 'never stop old colour until nginx is proven on new' invariant).
  [[ "$(readlink -f "$NGINX_UPSTREAM_LINK")" == "$(readlink -f "$src")" ]] || { err "post-reload symlink does not resolve to $color"; return 1; }
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
  # DATA-LOSS GUARD: the shared postgres volume is created empty in runbook §2
  # and filled by a manual copy. If that copy was skipped/partial, postgres
  # would initdb a FRESH cluster on the empty volume, the connectivity-only
  # health gate would PASS, and an EMPTY database would be promoted as prod.
  # Refuse to start the data layer unless the volume already holds an
  # initialised cluster (PG_VERSION present). First-ever bootstrap can override
  # with ALLOW_EMPTY_DATA=1 (e.g. a brand-new staging box).
  if [[ "${ALLOW_EMPTY_DATA:-0}" != "1" ]]; then
    if ! docker run --rm -v kds_postgres_data:/d alpine test -f /d/PG_VERSION >/dev/null 2>&1; then
      die "shared postgres volume kds_postgres_data is EMPTY (no PG_VERSION) — the §2 data copy is missing/incomplete; refusing to boot an empty database as prod. Set ALLOW_EMPTY_DATA=1 ONLY for a first-time bootstrap."
    fi
  fi
  log "ensuring shared data layer (postgres+redis) is up"
  docker compose -p kds-data --env-file "$ENV_FILE" -f "$DATA_COMPOSE" up -d
}

# AUTHORITATIVE migration pass — runs inside the freshly-booted NEW colour,
# whose image actually CONTAINS this release's migration files. (The old live
# container runs the previous image and physically lacks the new migrations, so
# an exec there is a no-op for anything new — that was the bug. The backend
# image CMD is `node dist/main`, no boot-time migrate.) Expand-only discipline
# keeps this safe: migrations land while the OLD colour still serves, before the
# nginx flip, and the old code tolerates the expanded schema.
migrate_in_color() { # <color>
  local c="$1" cont="kds_backend_${c}" deadline=$(( SECONDS + 90 ))
  log "waiting for $cont to accept exec, then applying prisma migrate deploy"
  while (( SECONDS < deadline )); do
    if docker exec "$cont" true >/dev/null 2>&1; then
      docker exec "$cont" npx --no-install prisma migrate deploy
      return 0
    fi
    sleep 3
  done
  return 1
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
  # Re-boot the previous colour at the EXACT version it last ran. Without this
  # IMAGE_TAG pin, docker-compose.color.yml would fall back to :current (which
  # this script never advances → a stale/legacy image), silently rolling prod
  # onto the wrong code.
  prev_version="$(read_color_version "$prev")"
  [[ -n "$prev_version" ]] || die "no recorded VERSION for $prev in $ACTIVE_FILE — cannot pin the rollback image; roll back manually with an explicit tag"
  log "ROLLBACK: $active → $prev (pinned image $prev_version)"
  ghcr_login
  export IMAGE_TAG="$prev_version"
  docker pull "ghcr.io/mtarikucar/kds/backend:${prev_version}"
  docker pull "ghcr.io/mtarikucar/kds/frontend:${prev_version}"
  dc_color "$prev" up -d
  wait_until_ready "$prev" || die "previous colour $prev did not become ready — aborting rollback"
  nginx_point_to "$prev"
  public_smoke || warn "post-rollback public smoke imperfect — inspect manually"
  write_active_color "$prev" "$active" "$prev_version"
  log "rollback complete — active colour is now $prev ($prev_version)"
  exit 0
fi

# ── deploy <vX.Y.Z> ──────────────────────────────────────────────────────────
VERSION="$ACTION"
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "VERSION must be vX.Y.Z (got '$VERSION')"
export IMAGE_TAG="$VERSION"

ACTIVE="$(read_active_color)"
TARGET="$(other_color "$ACTIVE")"
log "active=$ACTIVE  target=$TARGET  version=$VERSION"

# Recovery handler shared by the ERR trap AND every explicit gate failure. Bare
# `X || die` on the left of `||` does NOT fire the ERR trap and `die`'s exit
# does not either, so gate failures MUST call this directly — otherwise the
# advertised teardown/revert is dead code. On post-flip failure it reverts nginx
# to ACTIVE and, critically, persists state so the file can never disagree with
# the live symlink (a stale file would turn the NEXT deploy into a live-colour
# recreate outage).
FLIPPED=0
cleanup_and_exit() {
  local code="${1:-1}"
  err "deploy aborting (code $code)"
  if [[ "$FLIPPED" -eq 0 ]]; then
    warn "tearing down un-promoted $TARGET (active $ACTIVE untouched → zero user impact)"
    dc_color "$TARGET" down --remove-orphans 2>/dev/null || true
  else
    err "failure occurred AFTER nginx flip — reverting traffic to $ACTIVE"
    if nginx_point_to "$ACTIVE"; then
      write_active_color "$ACTIVE" "$TARGET" "$(read_color_version "$ACTIVE")"
      warn "traffic reverted to $ACTIVE; leaving $TARGET up for inspection"
    else
      err "AUTOMATIC REVERT FAILED — manual intervention required (symlink=$NGINX_UPSTREAM_LINK)"
    fi
  fi
  exit "$code"
}
trap 'cleanup_and_exit $?' ERR
# Route explicit gate failures through the same recovery instead of bare `die`.
gate() { "$@" || { err "gate failed: $*"; cleanup_and_exit 1; }; }

assert_no_legacy_stack
ensure_data_layer
ghcr_login

log "pulling immutable images :$VERSION"
gate docker pull "ghcr.io/mtarikucar/kds/backend:${VERSION}"
gate docker pull "ghcr.io/mtarikucar/kds/frontend:${VERSION}"

log "booting $TARGET colour on backend $(backend_port "$TARGET") / frontend $(frontend_port "$TARGET")"
gate dc_color "$TARGET" up -d

# Authoritative migrate INSIDE the new colour (its image has the new migrations)
# BEFORE the health gate + flip — expand-only, so the still-serving old colour
# tolerates the expanded schema.
gate migrate_in_color "$TARGET"

gate wait_until_ready "$TARGET"
gate probe_socketio "$TARGET"
gate probe_frontend "$TARGET"

# ── CUTOVER ──────────────────────────────────────────────────────────────────
gate nginx_point_to "$TARGET"
FLIPPED=1

# Record state IMMEDIATELY after the confirmed flip so the state file always
# matches the live nginx symlink (before the post-flip smoke, which — on
# failure — reverts nginx AND rewrites state back to ACTIVE via cleanup_and_exit).
write_active_color "$TARGET" "$ACTIVE" "$VERSION"

# Post-flip confirmation against the public edge; failure reverts to ACTIVE.
gate public_smoke

trap - ERR   # cutover succeeded; a drain-window hiccup must not trigger a revert

log "cutover to $TARGET succeeded; draining $ACTIVE for ${DRAIN_SECONDS}s so websocket clients reconnect"
sleep "$DRAIN_SECONDS"
log "stopping old colour $ACTIVE"
dc_color "$ACTIVE" down --remove-orphans 2>/dev/null || warn "could not fully stop $ACTIVE — inspect manually (traffic already on $TARGET)"

log "DONE — $VERSION live on $TARGET with zero downtime. Roll back any time: $0 prod rollback"
