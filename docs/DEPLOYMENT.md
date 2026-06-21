# Deployment Guide

How HummyTummy ships. This reflects the **actual** pipeline (the previous version
of this doc described a beta/multi-server setup that no longer exists).

## Topology

Both environments run on a **single VPS** (`38.242.233.166`) behind **Cloudflare**,
as two isolated Docker Compose projects out of one checkout at `/root/kds`:

| | Staging | Production |
|---|---|---|
| Compose project | `kds-staging` | `kds-prod` |
| Trigger | push to `test` branch | push a `vX.Y.Z` tag |
| Workflow | `.github/workflows/test-deploy.yml` | `.github/workflows/release-deploy.yml` |
| Hostname | `staging.hummytummy.com` | `hummytummy.com` |
| Frontend (SPA) | `kds_frontend_staging` `127.0.0.1:5175` | `kds_frontend_prod` `127.0.0.1:8080` |
| Backend (API) | `kds_backend_staging` `:3002` | `kds_backend_prod` `:3000` |
| Postgres | `kds_postgres_staging` (`restaurant_pos_staging`, `127.0.0.1:5433`) | `kds_postgres_prod` (`restaurant_pos_prod`, `127.0.0.1:5432`) |
| Redis | `kds_redis_staging` `127.0.0.1:6380` | `kds_redis_prod` |

Separate containers, databases, volumes, and networks per environment. The DB
and Redis ports are bound to loopback (not publicly reachable).

## Edge routing

The host nginx (Cloudflare → nginx → containers) routes each hostname to its
environment. Both vhosts serve the **SPA at the domain root** (Vite `base: '/'`),
with legacy `/app/*` → `301` to root, and `/api` + `/uploads` + `/socket.io` →
the backend. The canonical vhosts are version-controlled in
[`ops/nginx/`](../ops/nginx/) — apply with `ops/nginx/apply.sh` (it backs up,
runs `nginx -t`, and reloads only on success). Keep them in sync with the server.

## Secrets (GitHub Actions repo secrets)

Shared by both deploys unless noted:

- `POSTGRES_PASSWORD`, `ENCRYPTION_MASTER_KEY`, `INTERNAL_SERVICE_TOKEN`
- `PAYTR_MERCHANT_ID` / `_KEY` / `_SALT` (PayTR is the only payment provider; TRY-only)
- `EMAIL_HOST` / `_USER` / `_PASSWORD` / `_FROM`, `NETGSM_*`
- `GOOGLE_CLIENT_ID` / `_SECRET`, `VITE_GOOGLE_CLIENT_ID`
- `SSH_PRIVATE_KEY_BASE64`, `SSH_KNOWN_HOSTS`
- **Production session secrets:** `JWT_SECRET`, `JWT_REFRESH_SECRET`,
  `SUPERADMIN_JWT_SECRET`, `SUPERADMIN_JWT_REFRESH_SECRET`
- **Staging session secrets (distinct from prod):** `STAGING_JWT_SECRET`,
  `STAGING_JWT_REFRESH_SECRET`, `STAGING_SUPERADMIN_JWT_SECRET`,
  `STAGING_SUPERADMIN_JWT_REFRESH_SECRET` — so a JWT minted on staging is not
  valid on prod and vice-versa.

> Residual (deliberate): `POSTGRES_PASSWORD` and `ENCRYPTION_MASTER_KEY` are
> still shared. The DBs are separate and their ports are loopback-only, so the
> blast radius is bounded. Rotating them for staging needs a DB-side
> `ALTER ROLE` / data re-encryption and is intentionally deferred.

## Releasing

Per the standard flow (one tag per substantial change):

```bash
# feature branch → PR → review
git checkout -b feat/...
# merge to main with a "merge: vX.Y.Z — ..." commit, then:
git tag -a vX.Y.Z -m "vX.Y.Z — ..."
git push origin main && git push origin vX.Y.Z   # → PROD deploy
# staging:
git checkout test && git merge --ff-only main && git push origin test   # → STAGING deploy
```

`release-deploy.yml` / `test-deploy.yml` both call the shared `quality-gates.yml`
(backend lint/tsc/unit + real-DB e2e, frontend, contract + i18n parity drift),
build per-environment images, render the env file, ship it, and run
`scripts/deploy.sh <prod|staging>` on the server (`prisma migrate deploy`, no
seed). Migrations are hand-written and applied by the deploy.

## Diagnostics

- Health: `https://hummytummy.com/api/health`, `https://staging.hummytummy.com/api/health`
  (the `environment` field distinguishes them).
- `staging-diagnose.yml` (Actions → workflow_dispatch, type `staging`) — read-only
  dump of staging container logs + health over SSH.
- `seed-runner.yml` (workflow_dispatch) — manual marketplace seed into a chosen env.
