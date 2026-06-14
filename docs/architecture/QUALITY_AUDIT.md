# Quality-Attribute Audit

Audit of the platform against 30 engineering quality attributes, with
file-level evidence. **Status** is one of:

- **Strong** — the attribute is systematically implemented.
- **Partial** — implemented in places, with named gaps.
- **Gap** — not meaningfully present.

Items marked *(this PR)* were addressed by the quality-hardening change
that introduced this document. Roadmap items are concrete and scoped —
they are the backlog, not aspirations.

---

## 1. Reusability — Strong

**Evidence:** Shared UI primitive library (`frontend/src/components/ui/` —
Button, Card, Input, Modal, Spinner, and now EmptyState/ErrorState *(this
PR)*); shared backend helpers (`backend/src/common/helpers/`), pagination
(`common/pagination/`), scoping (`common/scoping/`); typed error helpers
reused across ~30 mutation hooks (`frontend/src/lib/api-error.ts`).

**Roadmap:** none pressing.

## 2. Maintainability — Strong

**Evidence:** Feature-module structure on both sides
(`backend/src/modules/<context>/`, `frontend/src/features/<context>/`);
per-module review docs (`docs/reviews/`); decision-dense comments at
change sites.

**Roadmap:** consolidate the legacy `frontend/src/api/` folder (5 files)
into `frontend/src/features/<context>/` — it predates the features layout.

## 3. Scalability — Strong

**Evidence:** stateless API replicas behind nginx; Socket.IO Redis adapter
(`@socket.io/redis-adapter`) so WebSocket fan-out works across replicas;
single root scheduler with leader-election notes (`app.module.ts`);
compound DB indexes added by dedicated migrations.

## 4. Vertical Scalability — Strong

**Evidence:** Node clustering is delegated to container resources;
Prisma connection pool sized via `DATABASE_URL` params; jest memory caps
show awareness of process limits.

## 5. Horizontal Scalability — Strong

**Evidence:** Redis-backed Socket.IO adapter; schedulers guarded by
distributed locks ("every replica still runs every job; leader-election /
distributed locks live in the schedulers themselves" — `app.module.ts`);
outbox pattern decouples event production from delivery
(`backend/src/modules/outbox/`).

## 6. Modularity — Strong

**Evidence:** ~50 NestJS feature modules; cross-context access goes
through ports (`backend/src/core-contracts/` — CoreProvisioningPort,
ReferralDirectoryPort); an eslint `no-restricted-syntax` rule **blocks**
marketing from touching core Prisma tables (`backend/.eslintrc.js`).

## 7. Separation of Concerns — Strong

**Evidence:** controller/service/DTO layering throughout; payment and
fiscal providers behind registries (`modules/payments-core/`,
`modules/fiscal-core/`); the marketing bounded context was physically
extracted to its own service (Phase-5 split).

## 8. Single Source of Truth — Partial

**Evidence:** backend constants are canonical
(`backend/src/common/constants/`); the frontend deliberately mirrors a
handful (`frontend/src/types/roles.ts` documents the mirroring).

***(this PR)*** drift found and fixed: frontend `OrderType` was missing
`COUNTER` while the backend wrote it. Added `scripts/check-contract-drift.mjs`
(CI-enforced, `quality-gates.yml`) comparing UserRole,
HARD_RESTRICTED_ROLES, OrderStatus, OrderType, PaymentStatus across
repos, plus an in-suite lock (`frontend/src/types/contract-drift.test.ts`).

**Roadmap:** shared `packages/contracts` consumed by both sides — requires
moving Docker build contexts to the repo root (`docker-compose.prod.yml`
builds from `./backend` / `./frontend` today). See ADR-0002.

## 9. Extensibility — Strong

**Evidence:** provider registries (payments, fiscal, KMS —
`modules/kms/kms-provider.interface.ts`); integration gateway
(`modules/integration-gateway/`); marketplace add-ons
(`modules/marketplace/`); outbound webhooks (`modules/webhooks-outbound/`).

## 10. Testability — Partial → improved *(this PR)*

**Evidence:** 142 backend spec suites / 1064 tests, green; Playwright e2e
(`tests/e2e/`); Vitest + Testing Library fully configured.

***(this PR)*** the decisive gap was that **nothing ran any of it**: both
deploy pipelines went pre-check → build → deploy with zero test/lint/
typecheck gates. Added `.github/workflows/quality-gates.yml` (backend
lint+tsc+jest, frontend lint+tsc+vitest, contract drift), wired as a
blocking `needs:` of `build` in `test-deploy.yml` and
`release-deploy.yml`, and running standalone on every PR. Also grew the
frontend suite (lib/currency, lib/api-error, superAdminAuthStore, Button,
EmptyState, ErrorState, contract lock) and added `test:ci` (vitest run).

**Roadmap:** coverage thresholds in jest/vitest configs; lift the backend
spec-file lint exclusion (see §28); run Playwright e2e in CI against a
compose stack.

## 11. Reliability — Strong

**Evidence:** two-layer env validation — boot validator
(`backend/src/common/helpers/env-validation.ts`: secret presence, min
length, cross-realm distinctness, placeholder detection,
PAYTR_TEST_MODE guard) plus *(this PR)* typed ConfigModule validation
(`backend/src/config/env.validation.ts`: NODE_ENV enum, PORT bounds, URL
shapes — division of labor documented in both files). Liveness/readiness
probes (`app.controller.ts`); ordered production deploys
(`concurrency: cancel-in-progress: false`).

## 12. Idempotency — Strong

**Evidence:** order idempotency keys (migrations
`20260427104329_add_order_idempotency_key`,
`20260603100000_v3_order_idempotency_branch_scope`); payment idempotency
(`20260420090000_payments_tenant_idempotency_orders_indexes`); webhook
replay index (`20260525000000_integration_webhook_replay_index`);
self-pay request hash (`20260531190000_self_pay_request_hash`).

## 13. Observability — Partial → improved *(this PR)*

**Evidence:** Sentry errors+tracing (`sentry.config.ts`); opt-in OTel
(`common/observability/tracing.ts`); structured request logging
(`common/middleware/request-logger.middleware.ts`).

***(this PR)*** added the missing metrics pillar: Prometheus
`GET /api/metrics` (`common/metrics/`) with default Node metrics and an
`http_request_duration_seconds` histogram labeled
`{method, route, status_code}`, fed by the existing request-logger
middleware (route *patterns*, not raw URLs, to bound cardinality;
health/metrics/uploads excluded). Optional `METRICS_TOKEN` bearer auth
(constant-time compare), verified live.

**Roadmap:** Grafana dashboards + Alertmanager rules on the new endpoint;
ship the OTel SDK packages when a collector is provisioned.

## 14. Security — Strong

**Evidence:** helmet CSP, tenant-subdomain CORS regex with deny-list
(`main.ts`); KMS-encrypted secrets (`modules/kms/`); API-key hashing +
token versioning (migration `20260420170000_user_token_version_apikey_hash`);
superadmin tokens deliberately not persisted to localStorage
(`frontend/src/store/superAdminAuthStore.ts` — now locked by a test);
throttling; placeholder-secret detection at boot; append-only audit role.

## 15. Performance — Strong

**Evidence:** compound indexes (movements, orders); Redis caching;
registry build caching in CI; webpack production bundle. The new
histogram *(this PR)* makes latency measurable per route.

## 16. Fault Tolerance — Strong

**Evidence:** outbox with retrying worker (`outbox-worker.service.ts`);
graceful degradation when optional services are absent (marketing relay
no-ops without `MARKETING_SERVICE_URL`); Sentry capture in
unhandled-rejection handlers (`main.ts`); readiness probe flips 503 so
the orchestrator stops routing.

## 17. Data Consistency — Strong

**Evidence:** Prisma transactions for multi-row writes; DB CHECK
constraints (e.g. `users_restricted_role_requires_primary_branch`);
branch-scope enforcement server-side (`common/scoping/branch-scope.ts`);
receipt snapshots for point-in-time correctness.

## 18. Backward Compatibility — Strong

**Evidence:** additive migrations with legacy-field retention
(`Product.image` kept alongside `images[]`); enum changes documented as
pure fixes when no live data used old values (`frontend/src/types/index.ts`
PaymentStatus note).

## 19. Clean Architecture — Strong

**Evidence:** ports & adapters at every boundary that has a second
implementation (payments, fiscal, KMS, provisioning); composition root
documented in `app.module.ts`; domain events via outbox instead of direct
cross-module calls.

## 20. SOLID Principles — Strong

**Evidence:** single-responsibility modules; provider interfaces for
substitution (KmsProvider, FiscalProvider); DI throughout (NestJS).
`RequestLoggerMiddleware` takes `MetricsService` as an **optional**
dependency *(this PR)* so logging never couples to metrics.

## 21. DRY — Partial

**Evidence:** shared helpers and UI primitives are the norm. The known
duplication is the deliberate frontend/backend constant mirroring — now
drift-guarded *(this PR)* and slated for a contracts package (ADR-0002).

## 22. KISS — Strong

**Evidence:** the codebase actively *removes* complexity theater —
`SqlInjectionPreventionMiddleware` ("regex pattern theater; Prisma is
parameterized anyway") and dead `DetailedRequestLoggerMiddleware` were
deleted with rationale (`app.module.ts`, `request-logger.middleware.ts`).

## 23. YAGNI — Strong

**Evidence:** OTel SDK is lazy-required and off by default rather than a
hard dependency; env validation stayed a plain helper instead of pulling
in Joi ("so env validation doesn't depend on a side-installed schema
library").

## 24. Configurability — Strong

**Evidence:** behavior toggles via env (SWAGGER_ENABLED, TRUST_PROXY,
LOG_LEVEL, OUTBOX_RETENTION_DAYS, ALLOW_MOCK_SMS_IN_PROD…); per-tenant
feature overrides (migration `20260223_add_tenant_feature_overrides`);
*(this PR)* typed validation so malformed values fail at boot, not at
first use.

## 25. Portability — Strong

**Evidence:** everything containerized (per-app Dockerfiles,
compose files for staging/prod); Tauri desktop builds for three OS
targets; no host-specific paths (`process.cwd()` convention documented in
`main.ts`).

## 26. Deployability — Strong

**Evidence:** GHCR registry-based deploys with pre-flight secret gate and
SSH probe before any build (`test-deploy.yml`, `release-deploy.yml`);
rollback via image tags (`.last-deployment-images`). *(this PR)* deploys
are now also gated on the full quality suite.

## 27. Resilience — Strong

**Evidence:** retrying outbox worker; reservation holds with expiry;
checkout intents (migration `20260530000000_checkout_intents`) for
resumable payment flows; crash handlers that report before exiting.

## 28. Naming Consistency — Partial

**Evidence:** consistent NestJS suffixes (`.service/.controller/.module/
.spec`); consistent feature-folder naming across backend and frontend.

**Known debts:** `frontend/src/api/` vs `frontend/src/features/` split
(§2); backend spec files are excluded from lint
(`backend/.eslintrc.js` ignorePatterns) because ~6.4k autofixable
formatting violations accumulated while they were unlintable (the old
`parserOptions.project` made every spec a parsing error — fixed by
`tsconfig.eslint.json` *(this PR)*, exclusion kept so the gate lands
green). **Ratchet:** one standalone `eslint --fix` formatting PR over
spec files, then delete the ignorePatterns entries.

## 29. Documentation — Strong

**Evidence:** decision-dense inline comments (the codebase's signature
strength); per-module reviews (`docs/reviews/`); operator guides
(`docs/*.md`, Turkish + English); *(this PR)* this audit and the ADR
directory (`docs/architecture/adr/`).

**Roadmap:** prune stale one-shot docs (`FINAL_COMPLETION_SUMMARY.md`,
`IMPLEMENTATION_SUMMARY.md`) into the reviews/ADR structure.

## 30. Monitoring & Alerting — Partial → improved *(this PR)*

**Evidence:** Sentry alerts on errors; branch health-score dashboard for
operators (`modules/health-dashboard/`).

***(this PR)*** infrastructure-level monitoring now has a scrape target
(§13). **Roadmap:** Prometheus + Alertmanager (or Grafana Cloud) wired to
`/api/metrics` with RED-method alert rules (p95 latency, 5xx rate,
event-loop lag); uptime checks against `/api/healthz/ready`.

## 31. Auditability — Strong

**Evidence:** append-only audit enforced at the DB role level (migration
`20260523200000_audit_append_only_role`); commission audit log; tenant
provisioning log; cash-drawer approvals; Z-report finalization.

## 32. Multi-Tenancy Safety — Strong

**Evidence:** tenant scoping on every query via guards + `BranchScope`
(`common/scoping/branch-scope.ts`, client/server consistency tested);
hard-restricted roles pinned to branches by DB CHECK constraint; tenant
hardening migration (`20260419100000_tenant_hardening`); per-tenant
envelope encryption (INTEGRATION_KEY); CORS tenant-subdomain deny-list.

---

*Last updated: 2026-06-11 (quality-hardening PR). Re-audit after the
contracts-package migration (ADR-0002) and the spec-lint ratchet (§28).*
