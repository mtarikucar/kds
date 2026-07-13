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

The zero-downtime health gate is **`/healthz/ready`** — it already exists in the
backend (`app.controller.ts`) and returns **503** when Postgres or Redis is down
(`app.service.getHealth()` → `status:"degraded"`), so it is a *safe* cutover
gate. `/api/health` (always-200, used by the Docker healthcheck + legacy deploy)
is intentionally left alone.

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

# 3. Stop the app tier ONLY (keep DB/redis running to take a fresh backup first)
#    Take a backup BEFORE any volume move:
./scripts/backup-database.sh prod   # or the deploy.sh backup path

# 4. Bring the whole legacy prod stack down (brief maintenance window — the ONLY
#    downtime in the entire migration; steady-state deploys after this are 0s):
docker compose -p kds-prod --env-file .env.production -f docker-compose.prod.yml down

# 5. Copy data from the old project volumes into the new external volumes:
for pair in \
  "kds-prod_postgres_data:kds_postgres_data" \
  "kds-prod_redis_data:kds_redis_data" \
  "kds-prod_invoice_storage:kds_invoice_storage" \
  "kds-prod_uploads_storage:kds_uploads_storage"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  docker run --rm -v "$src":/from -v "$dst":/to alpine \
    sh -c 'cp -a /from/. /to/ && echo copied $src -> $dst'
done

# 6. Start the shared data layer on the new volumes:
docker compose -p kds-data --env-file .env.production -f docker-compose.data.yml up -d
docker compose -p kds-data -f docker-compose.data.yml ps   # postgres+redis healthy?
```

> The old `kds-prod_*` volumes are left intact as a rollback safety net; delete
> them only after blue-green is proven for a few days.

---

## §3 — nginx wiring (the traffic switch)

```bash
# Place the upstream fragments where nginx will include them:
cp ops/nginx/upstream-blue.conf ops/nginx/upstream-green.conf /etc/nginx/conf.d/
# Start on blue (matches legacy ports 3000/8080):
ln -sfn /etc/nginx/conf.d/upstream-blue.conf /etc/nginx/conf.d/kds-upstream-active.conf
```

Then patch the **prod vhost** (`hummytummy.com` server block — verify against the
`nginx -T` capture from §1). Add at the top of the file (outside `server{}`):
```nginx
include /etc/nginx/conf.d/kds-upstream-active.conf;
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
# Boot blue (backend 3000 / frontend 8080) against the shared data layer:
IMAGE_TAG=current docker compose -p kds-prod-blue \
  --env-file .env.production --env-file ops/deploy/color.blue.env \
  -f docker-compose.color.yml up -d

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
unset/any-other value keeps the legacy `scripts/deploy.sh` path. Revert any time
by deleting the variable — no code change, no redeploy.

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
Brings the previous colour back (if stopped), health-gates it, flips the nginx
symlink back, reloads — **sub-second**, no container recreate, no image retag, no
DB change. State (`ACTIVE_COLOR`/`PREVIOUS_COLOR`) is persisted at
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

## Risk register (all mitigated in the script, listed for reviewers)

- **/api/health always-200** → we gate on **`/healthz/ready`** (503-aware). ✔
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
  (`readlink -f` check); an ERR trap reverts the symlink on post-flip failure.
