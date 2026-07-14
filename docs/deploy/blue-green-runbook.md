# Blue-Green Zero-Downtime Deploy — Runbook

> **Goal:** every prod deploy stays up (no ~240s `--force-recreate` outage).
> **Mechanism:** two colour app stacks (blue/green) behind the host nginx; boot
> the inactive colour, health-gate it, flip an nginx `upstream` symlink +
> `systemctl reload nginx` (graceful), drain, retire the old colour.
>
> **This PR is ADDITIVE** — the existing `docker-compose.prod.yml` +
> `scripts/deploy.sh` path is untouched, so merging changes nothing that runs
> until an operator performs §2–§4 below. Nothing here SSHes for you or handles a
> password; the credentialed steps run as **you** or via **CI's own secrets**.

## What was added (this PR)

| File | Purpose |
|---|---|
| `docker-compose.data.yml` | Shared postgres+redis (external volumes+network); never recreated |
| `docker-compose.color.yml` | One parameterised colour of backend+frontend (loopback ports) |
| `ops/deploy/color.blue.env` / `color.green.env` | Per-colour ports (blue 3000/8080, green 3010/8090) |
| `ops/nginx/upstream-blue.conf` / `upstream-green.conf` | nginx `upstream kds_backend/kds_frontend` per colour |
| `scripts/deploy-blue-green.sh` | The cutover engine: `prod <vX.Y.Z>` / `prod rollback` / `prod status` |
| `docs/deploy/blue-green-runbook.md` | This file |

The zero-downtime health gate is **`/api/healthz/ready`** — it already exists in
the backend (`app.controller.ts`, served under the global `api` prefix) and
returns **503** when Postgres or Redis is down (`app.service.getHealth()` →
`status:"degraded"`), so it is a *safe* cutover gate. `/api/health` (always-200,
used by the Docker healthcheck + legacy deploy) is intentionally left alone.

---

## §1 — Prerequisites to CONFIRM on the server first

Run these on `root@38.242.233.166` and confirm before wiring anything. **Do not
skip** — a couple of these are the reason this can't be a blind merge.

1. **Capture the LIVE nginx** (the in-repo `hummytummy.com.conf` is flagged
   *RECONSTRUCTED* and may not match production):
   ```bash
   nginx -T > /root/nginx-live-$(date +%F).conf
   ```
   Diff the prod `server{}` block against `ops/nginx/hummytummy.com.conf` before
   applying the §3 patch.
2. **RAM headroom** — blue+green backend+frontend run concurrently during the
   overlap window. Confirm the box can hold a second backend transiently:
   ```bash
   free -m; docker stats --no-stream
   ```
   If free RAM < ~1.5× current backend RSS, **do the staging migration (§7)
   first** to reclaim the box, or add swap, or run green on a second host.
3. **Firewall** — the colour host ports now bind `127.0.0.1` only (see
   `docker-compose.color.yml`), so an inactive colour is not internet-reachable.
   Confirm no other rule exposes 3000/3010/8080/8090 publicly.

---

## §2 — One-time server prep: shared network + external volumes + DATA migration

Blue and green must share ONE Postgres, ONE Redis, and the SAME invoice/upload
files. Today those live in project-prefixed volumes (`kds-prod_postgres_data`,
…). We move them to fixed **external** volumes both colours mount.

```bash
cd /root/kds && git fetch --all && git checkout <this-branch-or-merged-main>

# 1. Shared network
docker network create kds_bluegreen

# 2. External volumes (empty)
docker volume create kds_postgres_data
docker volume create kds_redis_data
docker volume create kds_invoice_storage
docker volume create kds_uploads_storage

# 3. Take a backup BEFORE any volume move:
./scripts/backup-database.sh prod   # or the deploy.sh backup path

# 4. Stop ONLY the services blue-green replaces (backend/frontend/postgres/redis).
#    KEEP landing/developer/help running under the legacy project so those three
#    public surfaces (hummytummy.com/landing, developer./help.hummytummy.com) do
#    NOT go dark — blue-green only models backend+frontend. (See "Known gap"
#    below: those three need their own deploy path before you rely on CI for them.)
#    This stop/rm — not a full `down` — is the ONLY downtime in the migration.
docker compose -p kds-prod --env-file .env.production -f docker-compose.prod.yml \
  rm -sf backend frontend postgres redis

# 5. Copy data from the old project volumes into the new external volumes.
#    set -e + per-pair source check + real failure on cp error (a silent partial
#    copy here would let an EMPTY database be promoted as prod):
set -e
for pair in \
  "kds-prod_postgres_data:kds_postgres_data" \
  "kds-prod_redis_data:kds_redis_data" \
  "kds-prod_invoice_storage:kds_invoice_storage" \
  "kds-prod_uploads_storage:kds_uploads_storage"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  docker volume inspect "$src" >/dev/null     # typo/missing-source guard (no -v auto-create)
  docker run --rm -v "$src":/from -v "$dst":/to alpine \
    sh -c 'cp -a /from/. /to/' && echo "copied $src -> $dst" \
    || { echo "COPY FAILED: $src -> $dst"; exit 1; }
done

# 6. VERIFY the postgres volume actually holds the migrated cluster BEFORE boot
#    (the deploy script also enforces this via ALLOW_EMPTY_DATA guard):
docker run --rm -v kds_postgres_data:/d alpine test -f /d/PG_VERSION \
  && echo "postgres volume populated ✓" || { echo "EMPTY postgres volume — copy failed"; exit 1; }

# 7. Start the shared data layer on the new volumes:
docker compose -p kds-data --env-file .env.production -f docker-compose.data.yml up -d
docker compose -p kds-data -f docker-compose.data.yml ps   # postgres+redis healthy?
```

> The old `kds-prod_*` volumes are left intact as a rollback safety net; delete
> them only after blue-green is proven for a few days. **Do NOT** re-run the
> legacy `deploy.sh prod` while blue-green is live — its `kds-prod` postgres uses
> the same `container_name` and would collide (the blue-green script's
> `assert_no_legacy_stack` guard aborts if legacy app containers reappear).

---

## §3 — nginx wiring (the traffic switch)

> ⚠️ **NOT** `/etc/nginx/conf.d/` — the stock nginx.conf globs
> `include /etc/nginx/conf.d/*.conf;`, and both colour fragments declare the same
> `upstream kds_backend`/`kds_frontend`, so globbing them makes `nginx -t` fail
> with **"duplicate upstream"** and the flip can never validate. Install them in a
> dedicated dir nginx does NOT auto-glob, included exactly once by the vhost.

```bash
# Place the upstream fragments in a NON-globbed dir:
mkdir -p /etc/nginx/kds-upstreams
cp ops/nginx/upstream-blue.conf ops/nginx/upstream-green.conf /etc/nginx/kds-upstreams/
# Start on blue (matches legacy ports 3000/8080):
ln -sfn /etc/nginx/kds-upstreams/upstream-blue.conf /etc/nginx/kds-upstreams/kds-upstream-active.conf
# Confirm nothing else pulls these in (must print 0):
nginx -T 2>/dev/null | grep -c 'upstream kds_backend' | grep -qx 1 || echo "check: kds_backend must be defined exactly once after the vhost include"
```

Then patch the **prod vhost** (`hummytummy.com` server block — verify against the
`nginx -T` capture from §1). Add at the top of the file (outside `server{}`):
```nginx
include /etc/nginx/kds-upstreams/kds-upstream-active.conf;
```
and change the hardcoded targets:
```
- proxy_pass http://127.0.0.1:3000;     # /api/  /uploads/  /socket.io/
+ proxy_pass http://kds_backend;
- proxy_pass http://127.0.0.1:8080;     # /  (SPA)
+ proxy_pass http://kds_frontend;
```
Keep the existing WebSocket `Upgrade`/`Connection` headers on the `/socket.io/`
location. Apply with the repo's safe primitive (backup → `nginx -t` → reload →
restore-on-fail):
```bash
./ops/nginx/apply.sh   # or: nginx -t && systemctl reload nginx
```

---

## §4 — Initial cutover (legacy → blue-green, zero downtime)

After §2/§3 the site is served by **blue** (which took over the legacy 3000/8080
via the data-layer + a first colour boot). To bring blue up explicitly:

```bash
# Boot blue against the shared data layer at an EXPLICIT version (the current
# live tag, e.g. the latest vX.Y.Z — NOT the movable ":current" pointer, which
# the blue-green script never advances). docker-compose.color.yml now REQUIRES
# IMAGE_TAG to be set (fails loudly if unset), so a stale image can't sneak in.
IMAGE_TAG=vX.Y.Z docker compose -p kds-prod-blue \
  --env-file .env.production --env-file ops/deploy/color.blue.env \
  -f docker-compose.color.yml up -d

# Seed the state file so the first CI deploy knows blue is active + its version
# (the script reads VERSION_blue to pin a future rollback):
sudo mkdir -p /var/lib/kds-deploy
printf 'ACTIVE_COLOR=blue\nPREVIOUS_COLOR=\nVERSION_blue=vX.Y.Z\n' \
  | sudo tee /var/lib/kds-deploy/active-color-prod

scripts/deploy-blue-green.sh prod status    # confirm active=blue, nginx=blue
```

From here every deploy is a green/blue flip with **no downtime**.

---

## §5 — Steady-state deploys (wire CI when ready)

`scripts/deploy.sh` (the current force-recreate path) is still the DEFAULT — CI
already has the blue-green toggle wired (this PR), gated on a repo variable so
merging changes nothing. To switch prod to zero-downtime, after §2–§4 are
verified on the box, set ONE repo variable:

> **GitHub → repo Settings → Secrets and variables → Actions → Variables →**
> **New variable:** `PROD_BLUEGREEN` = `true`

Every `vX.Y.Z` tag then runs `scripts/deploy-blue-green.sh` (deploy + rollback);
unset/any-other value keeps the legacy `scripts/deploy.sh` path.

> ⚠️ **The "revert by deleting the variable" escape hatch only holds BEFORE §2.**
> After the §2 data migration the legacy `deploy.sh` path can no longer run (its
> `kds-prod` postgres collides on `container_name` with the live `kds-data`
> stack, and it points at the frozen pre-migration `kds-prod_*` volumes). So set
> `PROD_BLUEGREEN=true` as the LAST step of the §2–§4 maintenance session, and
> treat a real revert as an explicit procedure (down `kds-data`+colours,
> reverse-copy the volumes back, restore the nginx vhost proxy_pass targets),
> not a one-variable toggle.

Staging's target host is likewise the repo variable `STAGING_SERVER_HOST` (unset
→ current shared box; set to Server-2's IP → staging deploys there, §7).

Everything else in the pipeline (GHCR build/push of `:vX.Y.Z`, env render + scp,
`git reset --hard <tag>`, the SSH channel + secrets) is unchanged. CI keeps
executing the deploy with its **own** `SERVER_HOST` / SSH secrets — no human
types a password, and no AI holds one.

A tag push (`vX.Y.Z`) then: builds images → SSH → `deploy-blue-green.sh prod
vX.Y.Z` → boots the inactive colour → `/healthz/ready` ×3 + socket.io + frontend
gate → nginx symlink flip + graceful reload → public smoke → drain 60s → retire
old colour. On any failure before the flip the new colour is torn down (users
never affected); after the flip a failing smoke auto-reverts the symlink.

---

## §6 — Rollback

```bash
scripts/deploy-blue-green.sh prod rollback
```
Re-boots the previous colour at the **exact version it last ran** — the script
records `VERSION_blue`/`VERSION_green` in the state file and pins `IMAGE_TAG` to
`PREVIOUS`'s recorded tag (pulling it first), then health-gates + flips the nginx
symlink back and reloads. It is NOT a "no-recreate" flip: the retired colour was
removed after the drain, so rollback recreates it from the pinned image (a few
seconds, not sub-second). It **dies loudly** if no version is recorded rather
than silently booting the movable `:current` tag. State
(`ACTIVE_COLOR`/`PREVIOUS_COLOR`/`VERSION_*`) is persisted at
`/var/lib/kds-deploy/active-color-prod` so rollback works days later.

**DB is not rolled back** — migrations are expand-only/backward-compatible, so
the previous colour tolerates the newer schema (same policy as today's
image-only rollback). Keep the **expand/contract discipline**: never ship a
drop/rename/NOT-NULL migration in the same release as the code that stops using
the old shape — it breaks the still-serving old colour mid-deploy.

---

## §7 — Staging migration to a NEW server (PENDING target host)

The design + steps below are ready; they need the **target server address**
(provider/IP) — the one fact that can't be invented. Once given, this becomes a
parameterised CI change (a `STAGING_SERVER_HOST` secret) — no manual command
running by you.

1. Provision the new VPS: Docker Engine + compose plugin, systemd nginx, certbot,
   git; `git clone` the repo, checkout `test`.
2. CI access: generate a **new** ed25519 deploy keypair, install the pubkey in
   the new host, add the private key + `ssh-keyscan <newIP>` to GitHub secrets as
   `STAGING_SERVER_HOST` / `STAGING_SSH_KEY`; repoint the staging workflow
   (`test-deploy.yml` currently hardcodes `SERVER_HOST=38.242.233.166`) to the
   new host **without touching prod's `SERVER_HOST`**.
3. Data layer on the new box: bring up staging postgres+redis; `prisma migrate
   deploy` (+ seed) or restore a sanitized dump.
4. Carry over staging data if needed: `pg_dump` old staging → scp → `psql` into
   new; copy `invoice_storage_staging` via a `docker run … alpine cp` volume copy.
5. DNS/TLS: repoint Cloudflare `staging.hummytummy.com` A record to the new IP;
   issue the Let's Encrypt cert on the new box (certbot webroot), then re-enable
   the Cloudflare proxy; `nginx -t`.
6. Deploy staging app on the new host: `./scripts/deploy.sh staging <sha>` (or the
   blue-green script once staging adopts it). Health-gate `:3002/api/health`.
7. Verify e2e: `https://staging.hummytummy.com/api/health`, SPA, socket.io, a
   login, an order write.
8. Decommission old staging on the prod box (`docker compose -p kds-staging
   down`; drop its nginx vhost; free ports 3002/5175/5433/6380) — this also frees
   RAM on the prod box (helps §1.2).

---

## Known gaps (address before full CI adoption)

- **landing / developer / help are NOT in blue-green.** `docker-compose.color.yml`
  models only backend+frontend. §2 keeps the three portals running under the
  legacy `kds-prod` project (so they don't go dark), but they then have **no CI
  deploy path** — a future release won't update them. Before flipping
  `PROD_BLUEGREEN=true` permanently, give them a home: either a small always-on
  `docker-compose.portals.yml` (project `kds-portals`, on `kds_bluegreen`) that
  `deploy-blue-green.sh` pulls+ups each release, or add them to the colour compose
  with their own ports + nginx upstreams. `public_smoke()` should then also probe
  `hummytummy.com/landing`, `developer.hummytummy.com/tr`, `help.hummytummy.com/tr`.
- **Monitoring reconcile** (`deploy.sh bring_up_monitoring`, Prometheus/Grafana on
  the prod app network) is not ported — repoint `ops/monitoring` at the
  `kds_bluegreen` network and update scrape targets to the `kds_backend_blue/green`
  container names before relying on alerting under blue-green.

## Risk register (all mitigated in the script, listed for reviewers)

- **/api/health always-200** → we gate on **`/api/healthz/ready`** (503-aware). ✔
- **Shared volumes** → `external: true` on invoice/uploads; a cross-colour upload
  test is a required §4 acceptance check.
- **socket.io drop on cutover** → `stop_grace_period: 60s` + a 60s drain window so
  clients reconnect onto the new colour; shared Redis adapter (DB /2) keeps rooms
  coherent during overlap.
- **Postgres connection exhaustion during overlap** → `DATABASE_URL` carries
  `?connection_limit=${DB_CONNECTION_LIMIT:-10}` per colour.
- **Non-expand migration mid-overlap** → expand/contract review gate (§6).
- **Inactive colour internet-exposed** → colour ports bind `127.0.0.1` only.
- **Script stops both colours** → hard guard: the old colour is retired ONLY after
  state is persisted AND nginx is *confirmed* resolved onto the new colour
  (`readlink -f` check). Every gate failure routes through `cleanup_and_exit`
  (not bare `die`, which would bypass the ERR trap): pre-flip it tears down the
  un-promoted colour; post-flip it reverts the nginx symlink to ACTIVE **and**
  rewrites the state file so disk state and the live symlink can never disagree. ✔
- **Migrations never applied to the new colour** → `migrate_in_color` runs
  `prisma migrate deploy` INSIDE the freshly-booted target (whose image contains
  the new migrations) before the health gate, expand-only. ✔
- **Rollback boots a stale image** → per-colour version recorded in state; rollback
  pins `IMAGE_TAG` to it (and `docker-compose.color.yml` requires `IMAGE_TAG`, no
  `:current` fallback). ✔
- **Empty data volume promoted as prod** → `ensure_data_layer` refuses to boot
  unless `kds_postgres_data` holds an initialised cluster (`PG_VERSION`). ✔
- **Duplicate `upstream` in globbed conf.d** → fragments live in the non-globbed
  `/etc/nginx/kds-upstreams/`, included once by the vhost. ✔
- **CI auto-rollback flips prod onto a broken/stale colour** → the workflow only
  runs rollback when the deploy STEP failed, and for blue-green it only LOGS
  status (the script already self-reverts) instead of re-flipping. ✔
