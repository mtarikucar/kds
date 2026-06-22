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

Other external integrations:
- **Email** — staging renders no `EMAIL_HOST/USER/PASSWORD` → `EmailService` mock
  mode (logs, never sends). Real mail can't leak from staging.
- **SMS / NETGSM** — never rendered to staging → `SmsService` mock mode.
- **Google OAuth** — staging uses its OWN client only (`STAGING_GOOGLE_CLIENT_ID`/
  `_SECRET` + `STAGING_GOOGLE_CLIENT_ID` as the FE build arg). With none set,
  Google sign-in is **OFF on staging** (the button is hidden; the backend rejects
  Google tokens) — staging never touches the prod client.
- **PayTR** — `STAGING_PAYTR_MERCHANT_*` if set, else falls back to the shared
  merchant. Staging is always `PAYTR_TEST_MODE=1` (no real charges).
- `SSH_*` are genuinely shared (deploy transport only).

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

### Items that need an external account to ENABLE (wiring is already in place)
These are **isolated by default** (Google off; PayTR shared in test-mode). The
wiring consumes `STAGING_*` secrets the moment you create the external resource —
no further code change, just `gh secret set` + a `test` deploy.

- **Google OAuth — enable an isolated staging login (optional).** Google is OFF on
  staging today (fully isolated). To turn it on with its OWN client (never prod's):
  1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client
     (Web). Authorized JS origin `https://staging.hummytummy.com`; redirect URIs to
     match. **Do NOT edit the prod client** (it's mid-verification).
  2. `gh secret set STAGING_GOOGLE_CLIENT_ID --body <id>` and
     `gh secret set STAGING_GOOGLE_CLIENT_SECRET --body <secret>`.
  3. Push `test` → staging rebuilds with the staging client.
- **PayTR — fully isolate the test merchant (optional).** Staging works now via the
  shared merchant in test mode (no money). To isolate the webhook too:
  1. PayTR panel → create/obtain a TEST merchant; set its notification URL to
     `https://staging.hummytummy.com/api/...` (the PayTR webhook route).
  2. `gh secret set STAGING_PAYTR_MERCHANT_ID|_KEY|_SALT`.
  3. Push `test`.
- **Mailtrap/Mailpit sink** — optional upgrade over mock mode if staging needs to
  inspect rendered emails (email is already isolated via mock).
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
