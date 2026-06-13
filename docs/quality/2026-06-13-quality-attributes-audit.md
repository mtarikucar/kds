# Quality-Attributes Audit & Hardening Roadmap

**Date:** 2026-06-13 · **Scope:** backend (50 NestJS modules) + frontend (30 feature/platform areas) · **Branch:** `test`
**Method:** 10 parallel read-only audit agents scored every unit 0–3 across 7 quality families folded from the 35-attribute goal list, plus per-unit top gaps.

> This is the **steering artifact** for the "make every module satisfy all quality attributes + E2E test everything" goal.
> The goal is a multi-week program, not one PR. This document turns it into a prioritized, trackable backlog.

## Rubric (35 attributes → 7 scorable families)

| Family | Attributes folded in |
|---|---|
| **Structure** | Reusability, Maintainability, Modularity, Separation of Concerns, Single Source of Truth, Extensibility, Clean Architecture, SOLID, DRY, KISS, YAGNI, Naming Consistency |
| **Correctness** | Testability, Reliability, Idempotency, Fault Tolerance, Resilience, Data Consistency, Backward Compatibility |
| **Security** | Security, Multi-Tenancy Safety, Auditability |
| **Observability** | Observability, Monitoring & Alerting |
| **Perf/Scale** | Performance, Vertical + Horizontal Scalability |
| **Ops** | Configurability, Portability, Deployability |
| **Docs** | Documentation |

Scale: **0** absent/violated · **1** ad-hoc/partial · **2** solid · **3** exemplary.

---

## Executive summary

The codebase is **architecturally strong on the money/identity core** (orders, payments, auth, entitlements, outbox, customers = grade A with exemplary idempotency, transactions, and tenant scoping) but has **systemic, repeating gaps** that no single module owns. The highest-leverage work is **cross-cutting tracks**, not module-by-module hardening.

**The 7 systemic findings, by leverage:**

1. **Observability is near-absent everywhere.** Almost every module scores 0–1. No `MetricsService`/Prometheus, no correlation IDs, Sentry only on a few money paths. **Frontend: not one feature calls `captureException`** — only the global `ErrorBoundary` does.
2. **Branch-scope (multi-tenancy) leaks repeat across modules.** Multiple HIGH findings where reads/writes filter by `tenantId` only and ignore `branchId`: `personnel`, `kds` REST path, `analytics` heatmaps, `z-reports` aggregation, `fiscal-core`, `cash-drawer`, `reservations` public reads. **Frontend mirror: ~25 of 30 feature query keys omit `branchId`, and branch-switch never invalidates the query cache** → a user switching branches can see the previous branch's cached data.
3. **Test coverage is uneven.** Strong on the money core; **zero/thin** on `accounting`, `z-reports`, `qr`, `modifiers`, `sms-settings`, delivery-platform adapters, `public-stats`, `settings`, `desktop-app`. Frontend has almost no `.test.tsx` outside `hardware-store`, `entitlements`, and a couple of stores.
4. **God-files.** `orders.service` 2071, `payments.service` 2158, `auth.service` 1726, `subscription.service` 1425, `reservations.service` 1146; FE `POSPage` 1358, `MenuManagementPage` 1338, `DesignEditor` 1016, `superAdminApi` 525.
5. **Reliable-event guarantee is silently defeated in places.** `outbox.append(...).catch(() => undefined)` swallows event-publish failures in `fulfillment`, `payments-core`, `marketplace`, `superadmin`; `customer-orders`/`kds` emit some domain events directly via the WebSocket gateway instead of the outbox (lost on crash, no replay).
6. **Horizontal scalability blocked at the WebSocket layer.** `kds`, `notifications`, `analytics` gateways hold per-replica in-process state with **no Socket.IO Redis adapter** — broadcasts don't fan out across replicas.
7. **Config & i18n drift.** Hardcoded constants instead of `ConfigService` in many modules; i18n locale drift (ru/uz/ar each missing ~120 keys, silently falling back to English) and whole un-i18n'd FE areas (`webhooks`, `bridges`, `superadmin` sidebar, `hardware-store`, `analytics` controls).

**Plus discrete HIGH-severity security items** (each is a small, self-contained fix):
- `upload`: static `/uploads` serving has **no tenant ACL** — any authenticated user can read any tenant's files by path.
- `kms`: no real at-rest KMS in prod (AWS provider is a throwing stub; master key in env), and `rotate()` is unimplemented.
- `subscriptions`: billing mutations allow `MANAGER` (should be ADMIN-only).
- `public-stats`: stored review name/comment not HTML-sanitized → stored-XSS risk.
- `entitlements`: `EntitlementGuard` reads `req.user.branchId` (never set) instead of `req.scope.branchId` → branch-scoped grants silently always evaluated at tenant scope.
- `auth`: `register()` provisions tenant and user in **two separate transactions** → crash between them orphans a tenant.

---

## Heatmap — Backend (50 modules)

Grades: A exemplary · B solid · C gaps · D weak. Lower family numbers = bigger gap.

| Module | Grd | Struct | Corr | Sec | Obsv | Perf | Ops | Docs | Headline gap |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| orders | A | 2 | 3 | 3 | 2 | 2 | 2 | 2 | god-files (2071/2158 LOC) |
| customer-orders | A | 2 | 3 | 3 | 2 | 2 | 3 | 2 | KDS events bypass outbox |
| checkout | A | 3 | 3 | 3 | 1 | 2 | 2 | 2 | no Sentry on provision path |
| fulfillment | **C** | 2 | 2 | 2 | **0** | 1 | 1 | 1 | no $tx on shipment multi-write; zero Logger |
| kds | B | 2 | 2 | 2 | 2 | 2 | 1 | 2 | **REST path tenantId-only (branch leak)** |
| kds-routing | B | 3 | 3 | 2 | 2 | 2 | 2 | 2 | sequential fan-out |
| tables | A | 3 | 3 | 3 | 1 | 2 | 2 | 2 | no Logger/metrics |
| reservations | **C** | 1 | 2 | 2 | 1 | 2 | 2 | 2 | 1146-line god-file; public branch leak |
| payments | A | 2 | 3 | 3 | 3 | 2 | 3 | 2 | 843-line adapter; no retry/backoff |
| payments-core | B | 3 | 2 | 2 | 1 | 2 | 2 | 2 | idempotency contract unenforced for real provider |
| cash-drawer | **C** | 2 | 2 | 2 | 1 | 2 | 1 | 2 | **listPending/approve omit branchId**; no audit trail |
| accounting | **C** | 2 | 2 | 2 | 1 | 2 | 1 | 1 | external sync no idempotency key; thin tests |
| z-reports | **C** | 1 | 2 | 2 | 1 | 2 | 2 | 1 | **aggregations sum ALL branches** (wrong per-branch totals) |
| fiscal-core | B | 3 | 2 | 2 | 1 | 2 | 1 | 2 | branchId never persisted; no $tx on issueReceipt |
| reports | B | 2 | 3 | 2 | 1 | 2 | 2 | 2 | fetch-all-then-reduce in JS |
| analytics | **C** | 2 | 2 | 2 | 2 | 1 | 2 | 2 | **heatmap branch leak + cached under wrong key**; N+1 |
| catalog | B+ | 3 | 3 | 3 | 1 | 2 | 1 | 2 | no Logger |
| menu | C+ | 2 | 2 | 2 | **0** | 2 | **0** | 1 | zero logging; no config/pagination |
| modifiers | **D+** | 2 | 2 | 2 | **0** | 1 | **0** | 1 | no service spec; zero logging |
| stock | B | 2 | 2 | 2 | 1 | 2 | 2 | 2 | isAvailable write decoupled from stock |
| stock-management | B+ | 2 | 3 | 2 | 2 | 2 | 1 | 1 | inconsistent locking model |
| qr | B- | 2 | 2 | 2 | 1 | 2 | 2 | 1 | zero tests |
| marketplace | A- | 3 | 3 | 3 | 2 | 2 | 2 | 2 | outbox emit swallowed |
| upload | B+ | 3 | 3 | 2 | 1 | 2 | 2 | 1 | **static files: no tenant ACL** |
| auth | A | 2 | 3 | 3 | 2 | 2 | 3 | 2 | **register() split across 2 tx (orphan tenant)** |
| users | B | 2 | 2 | 3 | 1 | 2 | 2 | 1 | thin specs on privileged paths |
| tenants | B | 3 | 2 | 2 | 1 | 2 | 2 | 2 | settings route missing @SkipBranchScope |
| customers | A | 3 | 3 | 3 | 1 | 3 | 2 | 1 | throttler in-memory (per-replica) |
| contact | B | 2 | 2 | 3 | 2 | 2 | 1 | 2 | lead email fire-and-forget |
| personnel | B | 3 | 3 | 2 | **0** | 1 | 2 | 1 | **all reads branch-leak**; zero logging |
| entitlements | A | 3 | 2 | 2 | 2 | 3 | 2 | 3 | **guard reads wrong branchId field** |
| subscriptions | B | 2 | 3 | 2 | 1 | 2 | 2 | 1 | **MANAGER can mutate billing**; no Sentry |
| webhooks-outbound | A | 3 | 3 | 3 | 2 | 3 | 2 | 2 | no DLQ replay/alert |
| delivery-platforms | B | 2 | 2 | 3 | 1 | 2 | 3 | 1 | no DLQ; adapters untested |
| device-mesh | B | 3 | 2 | 2 | 1 | 3 | 1 | 2 | tenantId omitted in ack |
| local-bridge | B | 3 | 3 | 3 | 1 | 2 | 1 | 2 | no pagination |
| desktop-app | **C** | 2 | 2 | 2 | 1 | 2 | 1 | 1 | release signature never verified |
| caller | **C** | 2 | 2 | 2 | 1 | 2 | 1 | 1 | no real provider HMAC; no replay dedup |
| notifications | B | 2 | 3 | 3 | 2 | 2 | 1 | 1 | **WS no Redis adapter (multi-replica drop)** |
| sms-settings | **C** | 2 | 1 | 2 | 1 | 2 | 1 | **0** | zero tests; fire-and-forget send |
| outbox | A | 3 | 3 | 2 | 2 | 2 | 3 | 3 | no Prometheus DLQ-depth metric |
| health-dashboard | B | 3 | 2 | 3 | 1 | 1 | 2 | 2 | N+1; records no metric |
| provisioning | A | 3 | 3 | 3 | 2 | 2 | 3 | 2 | listProvisionedLeads N+1 |
| settings | A | 3 | 2 | 3 | 2 | 2 | 2 | 3 | no service specs |
| pos-settings | A | 3 | 3 | 3 | 2 | 2 | 2 | 3 | minor |
| public-stats | **C** | 2 | **0** | 2 | 2 | 2 | 1 | 2 | **zero tests; stored-XSS risk** |
| superadmin | A | 2 | 3 | 3 | 2 | 2 | 2 | 2 | refundPayment dual-write; users no audit |
| legal | A | 3 | 3 | 2 | 1 | 2 | 2 | 3 | no publish audit |
| kms | B | 3 | 2 | 2 | 1 | 3 | 3 | 3 | **no real prod KMS; rotate() unimplemented** |

## Heatmap — Frontend (30 areas)

| Area | Grd | Struct | Corr | Sec | Obsv | Perf | Ops | Docs | Headline gap |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| pos | **C** | 1 | 2 | 3 | 1 | 1 | 3 | 1 | 1358-line god-component; no virtualization |
| orders (FE) | **C** | 2 | 2 | 3 | 1 | 1 | 3 | 1 | no optimistic updates; staleTime 0 |
| kds (FE) | **C** | 2 | 2 | 2 | 1 | 1 | 2 | 1 | no virtualization; socket no branch re-join |
| tables (FE) | **C** | 2 | 2 | 3 | 1 | 2 | 3 | 1 | no tests for merge/transfer |
| reservations (FE) | B | 3 | 2 | 3 | 1 | 2 | 3 | 2 | public submit error swallowed |
| qr (FE) | **D** | 1 | 1 | 3 | 1 | 1 | 2 | 1 | 1016-line DesignEditor |
| qr-menu (FE) | **D** | 1 | 1 | 2 | 1 | 2 | 3 | 1 | money path untested; 6 god-components |
| menu (FE) | **C** | 1 | 2 | 3 | 1 | 2 | 2 | 1 | 1338-line page; console.log in prod |
| modifiers (FE) | B | 3 | 2 | 3 | 1 | 2 | 2 | 1 | no min/max cross-field validation |
| stock-management (FE) | **C** | 2 | 1 | 2 | 1 | 1 | 2 | 1 | zero tests; no virtualization |
| marketplace (FE) | B | 2 | 2 | 3 | 1 | 2 | 3 | 1 | no catalog error state |
| hardware-store (FE) | **C** | 1 | 2 | 3 | 1 | 1 | 1 | 2 | pervasive hardcoded strings; god-components |
| auth (FE) | B | 3 | 2 | 3 | 1 | 3 | 3 | 3 | authStore/branchScopeStore untested |
| users (FE) | **C** | 2 | 2 | 2 | 1 | 2 | 2 | 1 | profile query duplicates auth profile |
| personnel (FE) | **C** | 2 | 2 | 2 | 1 | 2 | 3 | 1 | socket invalidation storm |
| customers (FE) | **C** | 3 | 2 | 2 | 1 | 2 | 3 | 1 | `any` payloads; no modal test |
| contact (FE) | **D** | 2 | 1 | 2 | 1 | 2 | 2 | 1 | no hook-level error handling |
| settings (FE) | **C** | 2 | 2 | 2 | 1 | 2 | 3 | 1 | credentials logged; no validation |
| onboarding (FE) | B | 3 | 2 | 3 | 1 | 2 | 3 | 3 | no funnel telemetry |
| plan (FE) | B | 3 | 2 | 2 | 1 | 3 | 3 | 3 | no usage-snapshot guard |
| subscriptions (FE) | B | 3 | 2 | 3 | 1 | 2 | 3 | 3 | billing flows untested; no Sentry |
| entitlements (FE) | A | 3 | 3 | 3 | 1 | 3 | 2 | 3 | no onError signal |
| api-client | A | 3 | 3 | 3 | 2 | 3 | 2 | 3 | 3 axios bypasses; mirror drift guard |
| error-handling | A | 3 | 3 | 3 | 3 | 2 | 2 | 3 | single boundary; Suspense fallback null |
| i18n | B | 3 | 2 | 3 | 2 | 2 | 2 | 3 | **locale key drift ~120/locale** |
| state-stores | A | 3 | 2 | 3 | 1 | 3 | 2 | 3 | branch switch doesn't invalidate cache |
| hooks | B | 3 | 2 | 3 | 1 | 2 | 2 | 3 | no hook tests |
| ui-kit | B | 2 | 2 | 3 | 1 | 2 | 2 | 2 | 470-line ImageUploadZone; ~3/24 tested |
| (features: analytics/reports/accounting/fiscal/notifications/webhooks/devices/bridges/health/legal/superadmin/delivery-platforms/sms/caller/desktop-app/upload) | C–D | — | — | — | **0–1** | — | — | — | no Sentry; many query keys omit branchId; webhooks/bridges/superadmin un-i18n'd |

---

## Prioritized roadmap — hardening **tracks** (cross-cutting beats module-by-module)

Each track fixes one systemic gap across many modules at once. Ordered by risk × leverage.

### Track 1 — Multi-tenancy / branch-scope hardening 🔴 (correctness + security, highest risk)
- Backend: add `branchId` to every read/write in `personnel`, `kds` REST, `analytics` heatmaps, `z-reports`, `fiscal-core`, `cash-drawer`, `reservations` public reads. Persist `branchId` where the column exists but is unused.
- Fix `EntitlementGuard` to read `req.scope.branchId`.
- Frontend: bake `branchId` into all branch-scoped query keys; invalidate/clear the query cache on branch switch.
- **E2E:** per-module cross-branch isolation test (branch-A token must never read/mutate branch-B data) + a frontend branch-switch test asserting no stale data.

### Track 2 — Observability baseline 🟠 (every module)
- Backend: introduce a shared `MetricsService` (Prometheus), correlation-ID middleware, and a standard "capture to Sentry on catch" pattern; wire into every service that currently has none (start with money/fiscal/auth paths, then the rest).
- Frontend: add `Sentry.captureException` at the api-client response interceptor and in feature `onError` handlers; report missing-i18n-keys and ErrorBoundary resets.
- **E2E/contract:** assert `/metrics` exposes the expected counters; assert correlation ID propagates request→log→outbox.

### Track 3 — Reliable-event integrity 🟠
- Replace every `outbox.append(...).catch(() => undefined)` with logged + Sentry-captured failure (and a retry where the call is outside a tx).
- Move `customer-orders`/`kds` direct gateway emits onto the outbox.
- Add a Prometheus `outbox_dlq_depth` gauge + alert.
- **E2E:** crash-after-commit-before-emit replays the event; DLQ surfaces a poisoned message.

### Track 4 — Discrete HIGH security fixes 🔴 (small, independent)
`upload` tenant ACL on static files · `subscriptions` ADMIN-only billing · `public-stats` HTML-sanitize reviews · `kms` real provider + `rotate()` · `auth` single-transaction `register()` · `desktop-app` verify release signature.
- **E2E:** one focused negative test per fix.

### Track 5 — Structure: split god-files 🟡
Decompose the 9 god-files (BE: orders, payments, auth, subscription, reservations, z-reports; FE: POSPage, MenuManagementPage, DesignEditor) into focused services/components. Pure refactor — behavior-preserving, guarded by existing + new specs.

### Track 6 — Horizontal scalability 🟡
Add a Socket.IO Redis adapter for `kds`, `notifications`, `analytics` gateways; make in-memory gateway state replica-safe.
- **E2E:** two-replica broadcast test (emit on node A, receive on node B).

### Track 7 — Test coverage to a floor 🟡
Bring zero/thin-spec modules to a baseline: `accounting`, `z-reports`, `qr`, `modifiers`, `sms-settings`, delivery adapters, `public-stats`, `settings`, `desktop-app`; FE: `authStore`/`branchScopeStore`/`cartStore`, billing flows, money-path components.

### Track 8 — Config & i18n 🟢
Move hardcoded constants to `ConfigService`; close locale key drift (ru/uz/ar) and i18n the un-translated FE areas (`webhooks`, `bridges`, `superadmin`, `hardware-store`, `analytics` controls); add an i18n parity CI guard.

---

## How E2E maps to the goal

"E2E test for every property" is satisfied per-track by the test rows above, anchored on the existing Playwright harness (`playwright.config.ts`, `docs/e2e-test-plan.md`). Each track ships its own end-to-end proof (cross-branch isolation, metrics/correlation, event replay, security negatives, multi-replica broadcast) rather than one monolithic suite.

## Strong reference modules (use as the pattern to copy)
`orders`, `auth`, `entitlements`, `outbox`, `provisioning`, `payments` (backend) · `api-client`, `error-handling`, `entitlements` (frontend) — these already demonstrate the target for idempotency, transactions, tenant scoping, and event reliability.
