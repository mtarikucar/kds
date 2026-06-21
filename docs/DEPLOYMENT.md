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

**Staging is fully credential-isolated from prod** — no staging credential is
valid against prod. Every secret below that can grant access or decrypt data has
a `STAGING_*` twin consumed only by `test-deploy.yml`; `release-deploy.yml` uses
the prod (un-prefixed) secret.

| Concern | Prod secret | Staging secret |
|---|---|---|
| DB password | `POSTGRES_PASSWORD` | `STAGING_POSTGRES_PASSWORD` |
| At-rest encryption | `ENCRYPTION_MASTER_KEY` | `STAGING_ENCRYPTION_MASTER_KEY` |
| Marketing transport | `INTERNAL_SERVICE_TOKEN` | `STAGING_INTERNAL_SERVICE_TOKEN` |
| User sessions | `JWT_SECRET`, `JWT_REFRESH_SECRET` | `STAGING_JWT_SECRET`, `STAGING_JWT_REFRESH_SECRET` |
| Superadmin sessions | `SUPERADMIN_JWT_SECRET`, `SUPERADMIN_JWT_REFRESH_SECRET` | `STAGING_SUPERADMIN_JWT_SECRET`, `STAGING_SUPERADMIN_JWT_REFRESH_SECRET` |

Genuinely shared (no isolation concern): `PAYTR_MERCHANT_*` (staging runs
`PAYTR_TEST_MODE=1` → no real charges), `GOOGLE_CLIENT_*`, `SSH_*`, `NETGSM_*`
(never rendered to staging → SMS mock). **Email:** staging does **not** render
`EMAIL_HOST/USER/PASSWORD`, so `EmailService` runs in mock mode (logs, never
sends) — staging testing can't deliver real mail.

> `STAGING_POSTGRES_PASSWORD` note: a persistent staging volume ignores
> `POSTGRES_PASSWORD` after first init, so `scripts/deploy.sh` runs a
> **staging-only** `sync_db_password` (an idempotent `ALTER USER … PASSWORD` over
> the container's trust socket) to reconcile the live role with the rendered env
> on every staging deploy. It early-returns on prod (`[ "$ENV" = staging ]`), so
> prod's role is never touched.
>
> `STAGING_ENCRYPTION_MASTER_KEY` note: rows encrypted on staging under the old
> (shared) key become undecryptable. Self-healing paths degrade gracefully
> (integrations → `{}`, accounting → null); the camera `streamUrl` and
> delivery-platform credential paths throw → a 500 on those specific pages only.
> If you hit that on stale staging data, reset the staging DB for a clean slate:
> `docker compose -p kds-staging --env-file .env.test -f docker-compose.staging.yml down && docker volume rm kds-staging_postgres_data_staging` then re-deploy (push `test`).

### Deferred isolation items (need external setup; documented, not yet done)
- **Separate Google OAuth client for staging** — the shared prod client is mid
  Google verification (don't edit it). Create a dedicated staging client +
  `STAGING_GOOGLE_CLIENT_*` and render them on staging.
- **Separate PayTR TEST merchant** — staging shares the prod merchant under
  `PAYTR_TEST_MODE=1` (no money moves), but a test-mode webhook validates under
  the shared HMAC salt. A dedicated test merchant (its own panel notify URL)
  fully isolates settlement.
- **Mailtrap/Mailpit sink** — optional upgrade over mock mode if staging needs to
  inspect rendered emails.
- **Sentry staging DSN** — purely additive observability (no DSN set today, so no
  leak); add `SENTRY_ENVIRONMENT=staging` if staging error capture is wanted.

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
