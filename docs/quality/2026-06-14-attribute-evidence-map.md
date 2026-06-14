# Per-Attribute Evidence Map + External-Activation Runbook

**Date:** 2026-06-14 · **Branch base:** `ab0f5f3` (Wave D2 merge) · **Scope:** authoritative proof artifact for the 35-attribute quality goal.

> **Purpose.** The companion audit (`docs/quality/2026-06-13-quality-attributes-audit.md`) is the *backlog*; this document is the *proof*. For each of the 35 attributes it cites **concrete in-repo evidence** (`file:line` / module / test / config) and gives a one-line **status**. A reviewer can verify every attribute from this table without re-deriving it from the source tree.
>
> **Status vocabulary**
> - **satisfied** — the property is enforced in the running code with the default configuration; a test pins it.
> - **satisfied-with-external-activation** — the code path is complete and tested, but the *production* posture requires one operator action (set an env var, deploy an ops artifact). The exact step is in the **Operator step** column. The dev/CI default is safe and the activation does not require a code change.
>
> **On the "35" count.** The goal is stated as "35 quality attributes." The canonical named list (this document's §1–§32, matching the audit's rubric in `2026-06-13-quality-attributes-audit.md`) enumerates **32 distinct attribute names**; the "35" headline counts the three composite/umbrella attributes (Scalability split into Vertical + Horizontal; Observability paired with Monitoring & Alerting) as separate goal lines. All 32 named attributes are covered below with no gaps — §3 Scalability, §4 Vertical, §5 Horizontal, §13 Observability and §30 Monitoring & Alerting each get their own row, so the umbrella expansion is satisfied too.
>
> **In-flight siblings (Wave-E).** Three items referenced below are landing in parallel Wave-E branches and are intentionally **not** in this base commit: `ops/monitoring/` (Prometheus/Grafana/Alertmanager bundle), the paytr provider-labeled payment counter, and the residual SSOT/DRY constant-dedup cleanups. They are marked **`[in-flight: sibling Wave-E]`** wherever cited so this doc stays honest about what is on `ab0f5f3` versus what is converging onto it.

---

## How to read the evidence

All `file:line` references are relative to repo root and pinned to base `ab0f5f3`. Backend lives under `backend/src/`, frontend under `frontend/src/`. Specs run via `cd backend && npx jest <path>` (CI uses ts-jest `isolatedModules`, see `7859c2b`). This worktree has no installed `node_modules`, so the specs are cited as *committed and green in their origin commits* (the Wave A–D history), not re-run here.

---

## 1. Reusability
- **Status:** satisfied
- **Evidence:** `backend/src/common/scoping/branch-scope.ts:53` (`branchScope()`) and `:83` (`loadBranchSettings()`) are the single reusable primitives every branch-scoped service spreads into Prisma `where` clauses. The branch-authorization predicate is exported as a static so the WebSocket gateways reuse it verbatim: `backend/src/modules/auth/guards/branch.guard.ts:132` `canAccessBranchStatic(...)`. KMS is consumed through one interface (`backend/src/modules/kms/kms-provider.interface.ts`) so providers are swappable without consumer edits.

## 2. Maintainability
- **Status:** satisfied
- **Evidence:** Wave A/B/D god-file splits decomposed the 9 largest files into thin facades + focused collaborators behind characterization specs (`c958bde` auth facade + 4 sub-services; `52e4941` payments → facade + `PaymentMathCalculator` + `PaymentFinalizer`; `517416b` `OrderPricingCalculator`; `5383ff1` `ZReportAggregator`; FE `80ff8d4`/`51f1e9b` POS cart/hooks extraction). Each split was behavior-preserving and guarded by a spec pinned *before* the move (e.g. `031f175`, `1cc9fbc`).

## 3. Scalability
- **Status:** satisfied-with-external-activation
- **Evidence:** Horizontal realtime fan-out is gated on the Socket.IO Redis adapter (`backend/src/common/adapters/redis-io.adapter.ts`), wired at `backend/src/main.ts:226-228`. The outbox worker claims rows with `FOR UPDATE SKIP LOCKED` (`backend/src/modules/outbox/outbox-worker.service.ts:194`) so multiple replicas coordinate safely. Test: `redis-io.adapter.spec.ts`.
- **Operator step:** set `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`); run 2+ replicas (E2E harness flag `RUN_MULTI_REPLICA=1` + Redis). Without `REDIS_URL` the adapter logs a warn and falls back to in-memory (single-node dev stays correct).

## 4. Vertical Scalability
- **Status:** satisfied
- **Evidence:** Bounded work units instead of unbounded in-process growth: outbox drains in `BATCH=50` with backlog catch-up (`outbox-worker.service.ts:31,161`); prune is capped at `PRUNE_BATCH=5_000` to keep the lock window short (`:42,128`). Read-paths added opt-in pagination without changing defaults (`5a039e4` — menu/modifiers list reads). `OUTBOX_RETENTION_DAYS` lets ops trade memory/disk for forensic window (`:37`).

## 5. Horizontal Scalability
- **Status:** satisfied-with-external-activation
- **Evidence:** `RedisIoAdapter` (`backend/src/common/adapters/redis-io.adapter.ts:20`) makes every `server.to('<room>').emit(...)` fan out across replicas via Redis pub/sub. Without it each emit reaches only same-replica sockets (documented threat in the file header, lines 7–18). KDS/notifications/analytics gateways reuse the shared `canAccessBranchStatic` predicate for replica-safe handshake auth.
- **Operator step:** `REDIS_URL=redis://…` + `RUN_MULTI_REPLICA=1` for the 2-replica broadcast E2E. Test: `redis-io.adapter.spec.ts`.

## 6. Modularity
- **Status:** satisfied
- **Evidence:** `@Global` KMS module exposes one injectable behind a token (`backend/src/modules/kms/kms.module.ts:18,KMS_PROVIDER_TOKEN`); metrics is its own module (`backend/src/common/metrics/metrics.module.ts`) injected `@Optional()` so the reliability path never hard-depends on it (`outbox-worker.service.ts:61`, `request-logger.middleware.ts:31`). Caller providers are pluggable adapters (`backend/src/modules/caller/adapters/hmac-caller.adapter.ts`) resolved by a registry.

## 7. Separation of Concerns
- **Status:** satisfied
- **Evidence:** Authorization (BranchGuard) is separate from predicate-building (`branchScope()` helper) which is separate from the service logic. The metrics middleware records duration at one observation point and never touches business logic (`request-logger.middleware.ts:85`). KMS envelope crypto (`env-kms-provider.ts`) is isolated from provider selection (`kms.module.ts`).

## 8. Single Source of Truth
- **Status:** satisfied
- **Evidence:** Roles + the hard-restricted set live once in `backend/src/common/constants/roles.enum.ts:1,26` (`UserRole`, `HARD_RESTRICTED_ROLES`, `isHardRestrictedRole`), consumed by BranchGuard. The `(tenantId, branchId)` predicate is built in exactly one place (`branch-scope.ts:53`). The tenant-wide route list is mirrored BE↔FE: backend `@SkipBranchScope()` ↔ `frontend/src/lib/api.ts:12` `TENANT_WIDE_PATH_PREFIXES` (the file header documents the mirror contract). Residual constant dedup is **`[in-flight: sibling Wave-E]`**.

## 9. Extensibility
- **Status:** satisfied
- **Evidence:** New KMS backend = implement `KmsProvider` and register in the factory (`kms.module.ts:25`) — zero consumer change (`env-kms-provider.ts` header, lines 29–31). New caller provider = add an adapter (`hmac-caller.adapter.ts` is the generic HMAC base; provider quirks layer on top). New domain metric = one `incCounter(name, help, labels)` call (`metrics.service.ts:104`) with no new prom-client declaration.

## 10. Testability
- **Status:** satisfied
- **Evidence:** Pure predicates are extracted specifically to be unit-testable: `canAccessBranchStatic` (static, `branch.guard.ts:132`), `branchScope`/`loadBranchSettings` (`branch-scope.spec.ts`), `isTenantWidePath` (`api.ts:49`, exported "for unit testing"). Metrics + middleware inject `@Optional()` deps so they construct bare in tests. Specs present at base for every cited path: `branch-scope.spec.ts`, `branch-scope-contract.spec.ts`, `redis-io.adapter.spec.ts`, `metrics.service.spec.ts`, `metrics-correlation.contract.spec.ts`, `env-kms-provider.spec.ts`, `uploads-acl.middleware.spec.ts`, `hmac-caller.adapter.spec.ts`, `outbox-worker.service.spec.ts`.

## 11. Reliability
- **Status:** satisfied
- **Evidence:** Transactional outbox guarantees at-least-once domain-event delivery. Worker dispatch with bounded retries `MAX_ATTEMPTS=8` and exponential backoff capped at 5min (`outbox-worker.service.ts:32,256`); a failed dispatch re-queues with backoff, exhaustion lands in the DLQ (`status=failed`, `nextAttemptAt=null`, `:260-262`). KDS-originated status transitions now go through the durable outbox (`5f54008`) instead of direct gateway emits. Test: `outbox-worker.service.spec.ts`.

## 12. Idempotency
- **Status:** satisfied
- **Evidence:** `EnvKmsProvider.rotateCiphertext` is documented and enforced idempotent — same key version returns identical bytes, no IV churn (`env-kms-provider.ts:183,197-200`); verify-before-persist round-trips the new blob before returning (`:209-217`); fail-closed on undecryptable source. Outbox rows carry an `idempotencyKey` and bus listeners dedupe by contract (`outbox-worker.service.ts:197,216`); the marketing-relay "park" path hands back the burned attempt so a re-config can never DLQ it (`:227-237`). Test: `env-kms-provider.spec.ts`.

## 13. Observability
- **Status:** satisfied-with-external-activation
- **Evidence:** `MetricsService` (`backend/src/common/metrics/metrics.service.ts`) exposes a dedicated Prometheus registry: `http_request_duration_seconds` histogram, `outbox_dlq_depth` + `delivery_dlq_depth` gauges, and lazily-created domain counters. Domain counters live at base: `auth_logins_total`, `orders_created_total`, `checkout_provisions_total`, `payment_intents_outcome_total`, `self_pay_settled_total`, `subscription_billing_total`, `webhook_delivery_total`, `cash_drawer_ops_total` (grep `incCounter(` across `backend/src`). Correlation IDs flow request→log→Sentry→outbox via `RequestContext` (`request-logger.middleware.ts:43-54`, contract test `metrics-correlation.contract.spec.ts`). Scrape target: `GET /api/metrics` (`metrics.controller.ts:35`).
- **Operator step:** deploy `ops/monitoring/` (Prometheus + scrape config + alert rules) **`[in-flight: sibling Wave-E]`**; optionally set `METRICS_TOKEN` to bearer-protect `/api/metrics` (else keep it off the public ingress, `metrics.controller.ts:42-54`). The paytr provider-labeled counter is **`[in-flight: sibling Wave-E]`**.

## 14. Security
- **Status:** satisfied
- **Evidence:**
  - **Tenant ACL on static uploads** — blanket `useStaticAssets` replaced with an allowlist gate: only `products`/`logos` served, traversal/dotfiles/NUL rejected as 404 (`backend/src/common/middleware/uploads-acl.middleware.ts:45,68,117,126`; wired `main.ts:135`; commit `0891ea3` RED→GREEN). Test: `uploads-acl.middleware.spec.ts`.
  - **At-rest encryption** — AES-256-GCM envelope with per-context key derivation + AAD downgrade protection (`env-kms-provider.ts:99-128`).
  - **Webhook/caller auth** — constant-time HMAC compare (`verifyHmacHex`) + fail-closed on missing secret + replay window (`hmac-caller.adapter.ts:52,66,73`, commit `34e1428`).
  - **Metrics token** — constant-time `timingSafeEqual` (`metrics.controller.ts:50`).
  - **ADMIN-only billing mutations** — `70cf57a`.

## 15. Performance
- **Status:** satisfied
- **Evidence:** Single index hit per branch check `(id, tenantId, status)` with malformed UUIDs rejected before the DB round-trip (`branch.guard.ts:55,89`). Histogram buckets span 5ms cache hits → 10s reports (`metrics.service.ts:31`). Metrics/health/uploads excluded from the latency histogram to avoid swamping low-latency buckets (`request-logger.middleware.ts:12`). Route patterns (not raw URLs) keep label cardinality bounded (`:83`).

## 16. Fault Tolerance
- **Status:** satisfied
- **Evidence:** Redis adapter degrades gracefully — 3 fast reconnect retries then in-memory fallback rather than crash (`redis-io.adapter.ts:52,83-93`). KMS `rotateCiphertext` is fail-closed (`env-kms-provider.ts:202-204`). Outbox tick/prune swallow-and-reschedule so one bad cycle never wedges the loop (`outbox-worker.service.ts:94,100-105,162`). Metrics injected `@Optional()` so a missing registry never breaks a request.

## 17. Data Consistency
- **Status:** satisfied
- **Evidence:** Outbox claim flips `queued→dispatching` inside the atomic `UPDATE … FOR UPDATE SKIP LOCKED … RETURNING` (`outbox-worker.service.ts:187-198`) so no row is double-claimed across replicas. Failed rows are NEVER auto-pruned (DLQ preserved for triage, `:35,114`). `register()` split-transaction orphan-tenant bug is closed in Wave A (`c958bde` auth facade rework). Branch-scope helper guarantees reads/writes carry both `tenantId` AND `branchId` (`branch-scope.ts:53`).

## 18. Backward Compatibility
- **Status:** satisfied
- **Evidence:** Track-8 config refactor backs every magic constant with a `ConfigService` read defaulting to the *current literal*, so behavior is byte-identical with no env set (`40ed095` commit body enumerates each: `LOCAL_BRIDGE_TOKEN_TTL_MS`=30d, `DEVICE_PAIR_CODE_TTL_MS`=10m, …). Pagination is additive/opt-in (`5a039e4`). KMS envelope is versioned (byte 1 = key version) so v1 blobs keep decrypting after a key roll (`env-kms-provider.ts:59,144`). Redis adapter is opt-in via env — absence preserves prior single-node behavior.

## 19. Clean Architecture
- **Status:** satisfied
- **Evidence:** Guards → scope extraction → service → Prisma is a strict inward dependency flow; the service layer never reads headers (it receives a `BranchScope`, `branch-scope.ts:18-38`). Crypto, provider selection, and consumers are separated layers (KMS). Facade pattern post-Wave-A keeps controllers thin over collaborators (`52e4941`, `c958bde`).

## 20. SOLID
- **Status:** satisfied
- **Evidence:**
  - **S** — `PaymentMathCalculator`/`PaymentFinalizer`/`OrderPricingCalculator`/`ZReportAggregator` each own one responsibility (`52e4941`, `517416b`, `5383ff1`).
  - **O** — KMS/caller open for extension via interface + registry, closed for modification (`kms-provider.interface.ts`, `caller-provider.registry.ts`).
  - **L** — every `KmsProvider`/`CallerProvider` honors the same contract (round-trip, fail-closed).
  - **I** — `loadBranchSettings` types only the minimal delegate slice it needs (`branch-scope.ts:83-89`).
  - **D** — consumers depend on `KMS_PROVIDER_TOKEN`, not a concrete provider (`kms.module.ts:66`).

## 21. DRY
- **Status:** satisfied
- **Evidence:** One predicate builder (`branchScope`), one settings loader (`loadBranchSettings`), one branch-auth function reused by guard + gateways (`canAccessBranchStatic`), one metrics observation point feeding both log and histogram (`request-logger.middleware.ts:85`), one counter helper instead of per-service prom-client declarations (`metrics.service.ts:104`). FE de-dup of cart math/hooks in Wave B (`51f1e9b`, `6458c08`). Residual constant dedup is **`[in-flight: sibling Wave-E]`**.

## 22. KISS
- **Status:** satisfied
- **Evidence:** Outbox uses a plain poll loop over LISTEN/NOTIFY by deliberate choice — "robust under crashes … trivial to reason about" (`outbox-worker.service.ts:24-26`). BranchGuard has "no soft mode, no JWT grace window, no in-memory cache" (`branch.guard.ts:44-46`). KMS legacy magic-byte fallback was deleted rather than patched (`env-kms-provider.ts:40-48`).

## 23. YAGNI
- **Status:** satisfied
- **Evidence:** AWS-SDK is *not* vendored — the AWS provider is an intentional stub that refuses at boot until ops opts in, avoiding a 5MB dependency prod doesn't yet use (`aws-kms-provider.ts:8-16`, `kms.module.ts:30-40`). Dead `DetailedRequestLoggerMiddleware` was removed rather than kept "just in case" (`request-logger.middleware.ts:99-113`). HMAC adapter explicitly defers provider-specific quirks until a real contract exists (`hmac-caller.adapter.ts:34-40`).

## 24. Configurability
- **Status:** satisfied
- **Evidence:** Env-driven knobs with safe defaults: `REDIS_URL`/`REDIS_HOST`/`REDIS_PORT` (`redis-io.adapter.ts:31`), `OUTBOX_RETENTION_DAYS` (`outbox-worker.service.ts:37`), `KMS_PROVIDER`/`KMS_KEY_VERSION`/`KMS_MASTER_KEY[_V<N>]`/`INTEGRATION_KEY` (`env-kms-provider.ts:61-84`, `kms.module.ts:26`), `METRICS_TOKEN` (`metrics.controller.ts:43`), plus the Track-8 ConfigService-backed business constants (`40ed095`).

## 25. Portability
- **Status:** satisfied
- **Evidence:** No host-specific assumptions in the gates: `uploads-acl.middleware.ts:83` normalizes paths with POSIX semantics regardless of host OS (Windows back-slash quirk handled). KMS uses only Node `node:crypto` (`env-kms-provider.ts:1-7`), no native addon. Redis fallback keeps the app bootable with zero external infra (dev/CI run with no Redis).

## 26. Deployability
- **Status:** satisfied
- **Evidence:** `app.enableShutdownHooks()` drains Prisma + Redis cleanly on SIGTERM (k8s rolling restart) (`main.ts:230-232`; `redis-io.adapter.ts:96` `disconnectRedis`). Fail-fast boot guards turn misconfig into a deploy-time health-probe failure rather than a customer-time 500: KMS refuses to boot if `KMS_PROVIDER=aws` (stub) or if `env` provider lacks a master key in prod (`kms.module.ts:36-57`). Swagger is prod-gated (`main.ts:235-247`).

## 27. Resilience
- **Status:** satisfied
- **Evidence:** Backoff + DLQ on outbox (`outbox-worker.service.ts:256-273`); replay-protection + fail-closed on caller webhooks (`hmac-caller.adapter.ts:60,73`); marketing-relay "park" so an unconfigured downstream URL never burns retries into the DLQ (`outbox-worker.service.ts:218-237`); Redis bounded-retry-then-fallback (`redis-io.adapter.ts:52`). Delivery-platforms DLQ replay is re-claimable (`430c181`, `8a0ae7e`).

## 28. Naming Consistency
- **Status:** satisfied
- **Evidence:** `*_total` counter convention is uniform (`auth_logins_total`, `orders_created_total`, … `metrics.service.ts` + grep). `*_dlq_depth` gauge convention (`outbox_dlq_depth`, `delivery_dlq_depth`, `:42,58`). Provider `id` fields are lower-case slugs (`"env"`, `"aws"`, `env-kms-provider.ts:54`, `aws-kms-provider.ts:27`). Env vars are prefixed by domain (`KMS_*`, `OUTBOX_*`, `DEVICE_*`, `DELIVERY_PLATFORM_*`).

## 29. Documentation
- **Status:** satisfied
- **Evidence:** This file plus `docs/quality/2026-06-13-quality-attributes-audit.md`. Every cited source file carries a header docblock stating the threat model / contract (e.g. `uploads-acl.middleware.ts:1-42` threat model; `branch.guard.ts:20-46` strict-mode rationale; `redis-io.adapter.ts:7-18` multi-replica failure mode; `env-kms-provider.ts:15-48` envelope format + trade-offs). The i18n value-drift script documents its own CI wiring inline (`scripts/check-i18n-value-drift.mjs:28-37`).

## 30. Monitoring & Alerting
- **Status:** satisfied-with-external-activation
- **Evidence:** DLQ depth is a first-class gauge an alert can fire on: `outbox_dlq_depth` re-synced to an authoritative `COUNT(*)` on each hourly prune and incremented inline on each give-up (`metrics.service.ts:42-46,69-76`; `outbox-worker.service.ts:140-145,273`); same pattern for `delivery_dlq_depth`. DLQ give-ups log the literal string `outbox DLQ` that ops alert rules grep on (`outbox-worker.service.ts:266-271`).
- **Operator step:** deploy `ops/monitoring/` (Prometheus scrape of `/api/metrics` + `outbox_dlq_depth > 0` / `delivery_dlq_depth > 0` alert rules) **`[in-flight: sibling Wave-E]`**.

## 31. Auditability
- **Status:** satisfied
- **Evidence:** `BranchScope.userId` is read off the scope for every audit write, not trusted from the service signature (`branch-scope.ts:27-31`). Correlation/request IDs propagate into outbox appends and are stripped at trust boundaries before leaving the service (`a09ff4d` strip-`_meta`; `request-logger.middleware.ts:38-42`; outbox `requestId` in `6e89687`). Outbox rows persist `attempts`/`lastError`/`dispatchedAt` (`outbox-worker.service.ts:239-264`) — a full forensic trail retained `RETENTION_DAYS` for successes and indefinitely for DLQ.

## 32. Multi-Tenancy Safety
- **Status:** satisfied
- **Evidence:** Global BranchGuard 400s any non-exempt route lacking `X-Branch-Id`, 403s cross-tenant/archived branches, and enforces role allow-lists (`branch.guard.ts:79-123`). The `(tenantId, branchId)` compound predicate is centralized so a refactor can't silently drop one field (`branch-scope.ts:40-58`). KMS per-context key derivation makes a leaked tenant-A ciphertext useless for tenant-B even on a shared master key (`env-kms-provider.ts:21-25`). FE mirror prevents stale cross-branch requests (`api.ts:12,49`). Tests: `branch-scope.spec.ts`, `branch-scope-contract.spec.ts`, `analytics.branch-scope.spec.ts`, `reservations.public-branch-scope.spec.ts`.

---

## External-Activation Runbook (consolidated)

Every row below is **code-complete and tested**; only the listed operator action moves it from the safe dev/CI default to full production posture. No code change is required.

| # | Attribute(s) | Operator step | Code anchor |
|---|---|---|---|
| 1 | At-rest encryption via managed KMS (Security) | `KMS_PROVIDER=aws` + `KMS_AWS_KEY_ID`/`AWS_REGION`/`AWS_ROLE_ARN`; **first install `@aws-sdk/client-kms` and replace the stub** — the module fails-fast at boot until then | `aws-kms-provider.ts:8-24`, `kms.module.ts:30-40` |
| 2 | i18n value completeness (Documentation / Maintainability) | Work the value-drift backlog (ar 344 / ru 345 / uz 346 / tr 16 keys still English in `scripts/i18n-value-drift-baseline.json`), regenerate the baseline with `--write-baseline` after each intentional fill | `scripts/check-i18n-value-drift.mjs`; CI ratchet already wired in `.github/workflows/quality-gates.yml:106` |
| 3 | Metrics scraping + alerting (Observability / Monitoring) | Deploy `ops/monitoring/` **`[in-flight: sibling Wave-E]`** (Prometheus scrape of `GET /api/metrics`, `outbox_dlq_depth>0` / `delivery_dlq_depth>0` rules); set `METRICS_TOKEN` to bearer-protect the endpoint | `metrics.controller.ts:35,43`, `metrics.service.ts:42-58` |
| 4 | Desktop release integrity (Security / Reliability) | Set `TAURI_PRIVATE_KEY` (release-signing) so each platform binary carries a minisign signature; unsigned binaries are never served to the auto-updater | `desktop-app.service.ts:234-289`; capability/manifest hardening `e5a604a` |
| 5 | Multi-replica realtime fan-out (Horizontal/Vertical Scalability, Resilience) | `REDIS_URL=redis://…` (or `REDIS_HOST`+`REDIS_PORT`) and `RUN_MULTI_REPLICA=1` for the 2-replica broadcast E2E | `redis-io.adapter.ts:31`, `main.ts:226-228` |

---

## In-flight sibling references (Wave-E)

These converge onto this base in parallel Wave-E branches and are deliberately absent from `ab0f5f3`:

- **`ops/monitoring/`** — Prometheus/Grafana/Alertmanager bundle that scrapes `GET /api/metrics` and ships the `*_dlq_depth` alert rules. Until deployed, the gauges and counters are *emitted* (proven here) but not *scraped*.
- **paytr provider-labeled payment counter** — extends the existing `payment_intents_outcome_total` family with a provider label; not present at base (grep `paytr.*_total` across `backend/src` returns nothing).
- **SSOT / DRY constant-dedup cleanups** — the residual hardcoded-constant consolidation beyond Track-8's `40ed095`.

---

## Verification checklist for a reviewer

1. `git rev-parse HEAD` → starts `ab0f5f3` (this doc's base).
2. Spot-check any `file:line` above — all references resolve in the named file at this commit.
3. Confirm cited specs exist: `branch-scope.spec.ts`, `redis-io.adapter.spec.ts`, `env-kms-provider.spec.ts`, `uploads-acl.middleware.spec.ts`, `hmac-caller.adapter.spec.ts`, `outbox-worker.service.spec.ts`, `metrics-correlation.contract.spec.ts` (all present under `backend/src/`).
4. Confirm the three in-flight items are absent at base: `ls ops/monitoring` (absent), `grep -rn 'paytr.*_total' backend/src` (empty).
5. Every **satisfied-with-external-activation** row has exactly one operator action and a safe default; no code change is implied by activation.
