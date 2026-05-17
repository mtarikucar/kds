# Code Review — 2026-05-11 (Methodology v2)

**Branch:** `test`  ·  **Reviewer:** Claude (Opus 4.7)  ·  **Scope:** backend (NestJS), frontend (React/Vite), landing (Next.js 16). Out of scope this round: `desktop/`, `edge-device-cpp/`, `segmentation-service/`, infra/CI scripts.

**This document is the index.** The per-feature deep-dives live in [`docs/reviews/`](reviews/) — one file per feature, with a fixed 10-section template (business-logic invariants, state machines, money/precision audits, concurrency hazards, findings, what's solid, spot-checks, recommended tests). See [`reviews/README.md`](reviews/README.md) for the template + tier conventions.

> **Methodology v2.** The 2026-04-27 first-round review compressed every module into 3–6 rows of a single findings table — it scanned well but under-covered business logic. This second round split per-module work into 33 deep-dive files, each averaging ~280 lines and 8–20 invariants. Every Tier-1 file verified *(unverified)* findings at the cited line; the residual *(unverified)* count dropped from ~70 to effectively zero. Several seed findings (T2, T3 schema gaps; M3 severity; orders M6 NaN risk; the `isRunning`-outside-try/finally claim; the §3.2 "three frontend stores all memory-only" claim; the §5.7 "three.js not in prod" claim) were corrected after first-hand re-reads.

**Severity:** Critical → High → Medium → Low → Info.
**Dimension:** Sec (security/multi-tenant) · Cor (correctness/business logic) · Arch (architecture/code quality) · Perf (performance/reliability).

---

## 1. Executive Summary

The repo is in **broadly good shape**. Multi-tenant isolation is well-adopted, schedulers correctly use `pg_advisory_lock`, the KDS gateway's dual-auth + type-check pattern is solid, and the loyalty redemption + auth password-reset patterns are exemplary. There are **no findings that are unambiguously "do not deploy".**

What's left, distilled across the 33 per-feature files:

1. **Money-path correctness.** Most paths are `Prisma.Decimal`-clean, but a small set of conversion points and missing idempotency keys remain. Payments single-payment now has tri-layer idempotency (partial unique index from migration `20260420180000`); split-bill writes still don't. Subscriptions renewal writes still lack a composite key. Refund handling has a TOCTOU race (`tx.payment.update` filters on id only, not status) and silently clamps rather than alerting on over-refund. Accounting credentials are stored plaintext (M8 — verified at `accounting-settings.service.ts:17-22`). Decimal.toString() canonicalization is missing on the z-report payload-hash. None of these are exploitable externally; they're audit-time and retry-time hazards.
2. **Auth & 2FA boundary state.** Superadmin token rotation never bumps `tokenVersion`, so a refresh-token is reusable for its full 7-day TTL after first use (worse than the 2026-04-27 review framed it). Superadmin refresh accepts the token via JSON body. Suspending a tenant doesn't revoke its outstanding access/refresh tokens. The four social-auth branches miss the `tenant.status==='ACTIVE'` check (the password path was already guarded). 2FA gates rely on field-absence rather than explicit null guards (works today, brittle to refactor).
3. **Frontend token model is not as uniform as previously claimed.** `superAdminAuthStore.ts:93-97` persists `accessToken` to `localStorage` — directly contradicts the 2026-04-27 §3.2 claim that "frontend tokens never touch localStorage". The marketing realm's API client (`features/marketing/api/marketingApi.ts:21-53`) never received the single-flight refresh fix that commit `9b9eee4` shipped for `lib/api.ts`, so N parallel 401s race against backend refresh-rotation and revoke each other. Marketing reload = forced re-login because `partialize` drops both tokens.
4. **Schema audit corrections.** T2 (IngredientMovement no direct tenantId) and T3 (WaiterRequest/BillRequest) are **dropped** — both have direct `tenantId` columns plus `@@index([tenantId, status])` since migration `20260420180000_tenant_fks_and_partial_uniques`. T1 stands. New compound-index gaps surfaced on WasteLog, DeliveryPlatformLog, Notification, plus an audit-FK gap on 8 `*ById` columns. The schema has 87 models, 50 of them with `Decimal @db.Decimal(10,2)` money columns.
5. **Delivery webhooks have two real Sec gaps** the first round missed: Trendyol replay protection is conditional on the timestamp header being present (omit header → bypass), and the signature verification falls back to `JSON.stringify(request.body)` when `rawBody` is missing — verifying a signature against re-serialized JSON is unsafe. Plus a Yemeksepeti status-update handler that returns 200 and silently drops `PICKED_UP`/`CANCELLED` events (delivered orders sit in KDS as `READY` forever).
6. **WebSocket gateway parity.** KDS is the exemplar (verified at `kds.gateway.ts:64-143`). Notifications and analytics both miss the `payload.type === 'user'` check **and** the explicit `algorithms: ['HS256']` pin on `jwtService.verify`. Notifications also reads `payload.userId` which doesn't exist (main-app JWTs sign with `sub`), so the per-user notification room is literally `user:undefined` and `sendNotificationToUser` silently no-ops.
7. **One escaped High-Sec in low-risk surface:** `public-stats/services/public-stats.service.ts:23-31` derives its IP-hash salt from `IP_HASH_SALT ?? JWT_SECRET ?? APP_SECRET`. Rotating `JWT_SECRET` (a routine secrets-hygiene action) would silently re-pseudonymize every historical `ipHash` and break visitor analytics. Production should require `IP_HASH_SALT` explicitly.

| Severity | Count (approx.) | vs. 2026-04-27 |
|---|---|---|
| Critical | 0 | unchanged |
| High | ~30 | up from ~19 — deep-reads surfaced new bugs (notifications `user:undefined`, marketing missing single-flight, SA token-version never bumped, delivery webhook bypass, schema currency constraint, etc.) and reframed several originals |
| Medium | ~75 | up from ~32 — most growth is in the per-feature concurrency/perf sections |
| Low | ~50 | up from ~15 |
| Info | ~20 | up from ~9 |

> **Caveat:** every Tier-1 file verified its inherited *(unverified)* findings at source. Severity drift (M3 High→Medium, M6 effectively closed, T2/T3 dropped, A1 reframed) is documented per-file in §9 and aggregated in this index's Appendix §9.1.

**Top themes:**
1. **Idempotency on retry paths.** Subscription renewal (M9), split-bill payment (M10 frontend + backend), order create (orders F-O7), delivery webhook P2002 catch-all (delivery-platforms F-6). The pattern to copy is `customers/loyalty.service.ts:50-107`.
2. **Async error swallowing.** Email send (auth F-5), invoice sync after payment commit (payments F-7), accounting sync fire-and-forget retry (accounting F-7 missing SYNCING intermediate state).
3. **Frontend client-API drift.** `lib/api.ts` had three rounds of hardening (single-flight refresh, env-fail-loud, Sentry-safe filter). The marketing, superadmin, and landing realms never adopted some of those fixes.
4. **Test coverage is thin.** Backend: 13 spec files. Frontend: 1 spec. Landing: 0. Highest-leverage hardening investment is integration tests for money paths and the cross-tenant invariants test prescribed below.
5. **Sentry redaction allowlist is shallow.** Frontend `sentry.config.ts` redaction misses `accessToken`/`refreshToken`/`cookie`/`set-cookie`/`x-api-key`/nested objects — case-sensitive whitelist (frontend-protected-routes F-3).

---

## 2. Critical & High Findings (consolidated)

Every row links to a per-feature file's §7. Items marked **VERIFIED** were opened at the cited line during this round and confirmed. The full set of Medium/Low/Info findings lives per-feature.

### 2.1 Money-path correctness

| ID | Sev | Dim | Where | Finding (one line) | Detail |
|---|---|---|---|---|---|
| M1 | High | Cor | `orders/services/payments.service.ts:166-167` | `Number(totalPaid._sum.amount \|\| 0)` loses Decimal precision before `>= orderAmount` | [`reviews/payments.md`](reviews/payments.md) §5 C-1 |
| M2 | High | Cor | `payments.service.ts:448-455` | Split-bill tolerance uses `Math.abs(...) > 0.01` on JS Number | [`reviews/payments.md`](reviews/payments.md) F-1 |
| M3 | Medium | Cor | `accounting/services/sales-invoice.service.ts:32-33` | `getNextInvoiceNumber()` race — `@@unique([tenantId, invoiceNumber])` backstops to clean error but creates sequence gaps | [`reviews/accounting.md`](reviews/accounting.md) F-3 (downgraded High→Medium) |
| M4 | High | Arch | `accounting/services/accounting-sync.service.ts:29` | `if (invoice.externalId) return;` blocks re-sync after provider swap | [`reviews/accounting.md`](reviews/accounting.md) F-2 |
| M5 | High | Cor | `payments.service.ts:282-292` | Auto-invoice generation: real defect is swallowed try/catch (the call IS awaited) | [`reviews/payments.md`](reviews/payments.md) F-7 |
| M7 | High | Cor | `delivery-platforms/services/delivery-order.service.ts:118-121, 157-159` | Platform-supplied `totalAmount`/`finalAmount` written through unchecked | [`reviews/delivery-platforms.md`](reviews/delivery-platforms.md) F-3 |
| M8 | High | Sec | `accounting-sync.service.ts:116-140` **VERIFIED** | All 11 secret columns in `AccountingSettings` (schema:2937-2951) are plain `String?`; service writes the DTO verbatim with no `encryptJson` call | [`reviews/accounting.md`](reviews/accounting.md) F-1 |
| M9 | High | Cor | `subscriptions/services/subscription.service.ts:673-720` | Renewal write side lacks `(subscriptionId, periodStart)` idempotency | [`reviews/subscriptions.md`](reviews/subscriptions.md) F-1 |
| M10 | High | Cor | `payments.service.ts:412-533` | Split-bill writes have zero idempotency (single-payment path now has it via partial unique index) | [`reviews/payments.md`](reviews/payments.md) F-2 |
| **NEW** F-Acc-7 | High | Cor | `accounting-sync.service.ts` | Missing `SYNCING` intermediate `externalStatus` — crash between push and local UPDATE = duplicate remote invoices on retry | [`reviews/accounting.md`](reviews/accounting.md) F-7 |
| **NEW** F-Acc-6 | High | Cor | `foriba-efatura.adapter.ts:61-62, 70-86` | UBL-TR XML totals computed in JS `Number` → header/lines drift causes tax-authority XML rejection | [`reviews/accounting.md`](reviews/accounting.md) F-6 |
| **NEW** F-Acc-4 | High | Cor | `sales-invoice.service.ts:43` | Divide-by-zero on `OrderItem.quantity===0` → `NaN` written to Decimal column | [`reviews/accounting.md`](reviews/accounting.md) F-4 |
| **NEW** F-Ord-O5 | High | Cor | `orders/services/payments.service.ts` (refund path) | Refund doesn't reverse stock deductions (unlike `updateStatus → CANCELLED`) | [`reviews/orders.md`](reviews/orders.md) F-O5 |
| **NEW** F-Ord-O2 | High | Cor | `orders.service.ts` | Payment-driven `SERVED→PAID` transition bypasses `validateTransition`; `PENDING→PAID` allowed by payment guards but not by the state machine | [`reviews/orders.md`](reviews/orders.md) F-O2 |
| **NEW** F-Ord-O3 | High | Cor | `orders.service.ts` updateStatus | Read-modify-write in default isolation, no conditional `updateMany` | [`reviews/orders.md`](reviews/orders.md) F-O3 |
| **NEW** F-Ord-O7 | High | Cor | order create | No idempotency key on order create | [`reviews/orders.md`](reviews/orders.md) F-O7 |
| **NEW** F-Pay-3 | High | Cor | `payments.service.ts` refund | Refund double-tap race — `tx.payment.update` filters by id only, not status | [`reviews/payments.md`](reviews/payments.md) F-3 |
| **NEW** F-StM-4 | High | Cor | `ingredient-movements.service.ts:36-73` | Manual movement read-then-writes `currentStock` without atomic guard — the one mutation in the module not following the gold pattern | [`reviews/stock-management.md`](reviews/stock-management.md) F-4 |
| **NEW** F-Zr-4 | High | Cor | `z-reports.service.ts:486-536` | `computePayloadHash` uses `Decimal.toString()` — `"10"` vs `"10.00"` round-trip breaks the audit comparison | [`reviews/z-reports.md`](reviews/z-reports.md) F-4 |

### 2.2 Auth & token model

| ID | Sev | Dim | Where | Finding | Detail |
|---|---|---|---|---|---|
| A1 | Medium | Cor | `auth/strategies/jwt.strategy.ts:36-74` | **Reframed** — `tokenVersion` IS checked against a per-request DB read; residual is "one in-flight request can complete", not "full JWT TTL" | [`reviews/auth.md`](reviews/auth.md) F-1 (downgraded High→Medium) |
| A3 | High | Sec | `superadmin-auth.service.ts:188-199` | Failed-login counter resets on password match before 2FA succeeds | [`reviews/superadmin.md`](reviews/superadmin.md) F-1 |
| A4 | Low | Sec | `superadmin-auth.service.ts:476-480` | **Downgraded** — `verifyTotp` already returns false on null `twoFactorSecret`; invariant holds by side-effect | [`reviews/superadmin.md`](reviews/superadmin.md) F-2 |
| A5 | Medium | Sec | `auth.service.ts` social-auth branches `:989-991`, `:1027-1029`, `:1119-1121`, `:1157-1159` | **Reframed** — password path correctly blocks suspended tenants; only 4 social-auth branches miss the `tenant.status` check | [`reviews/auth.md`](reviews/auth.md) F-2 |
| **NEW** F-SA-3 | High | Sec | `superadmin-auth.service.ts:550-589` | `generateTokens` **never** increments `tokenVersion` — SA refresh token reusable for full 7-day TTL after first use | [`reviews/superadmin.md`](reviews/superadmin.md) F-3 |
| **NEW** F-SA-5 | Medium | Sec | `common/middleware/request-logger.middleware.ts:125-136` | `shouldLogBody` redacts `/auth/login` but not `/auth/verify-2fa` — `tempToken` logged in cleartext (the real exposure; the original "audit log plaintext" claim was wrong) | [`reviews/superadmin.md`](reviews/superadmin.md) F-5 |
| **NEW** F-SA-7 | Medium | Sec | superadmin 2FA verify | No per-account counter on invalid 2FA codes (only per-IP throttle) — 6-digit space brute-forceable by IP-rotating attacker | [`reviews/superadmin.md`](reviews/superadmin.md) F-7 |
| **NEW** F-SA-8 | Medium | Cor | `superadmin-auth.service.ts:122-138` | Backup-code RMW race — two concurrent submissions of the same code both pass `.includes(hash)` and both succeed | [`reviews/superadmin.md`](reviews/superadmin.md) F-8 |
| **NEW** F-SA-11 | Medium | Sec | superadmin refresh | SA refresh accepted via JSON body — diverges from tenant cookie-only pattern; exposes refresh to XSS | [`reviews/superadmin.md`](reviews/superadmin.md) F-11 |
| **NEW** F-Auth-3 | Medium | Cor | `auth.service.ts:527-533` | Refresh-rotation TOCTOU — revoke+generate is non-atomic, two parallel refreshes with same cookie can mint two live sessions | [`reviews/auth.md`](reviews/auth.md) F-3 |
| **NEW** F-Ten-5 | Medium | Sec | `superadmin-tenants.service.ts:188-242` SUSPEND path | Suspending a tenant doesn't bump `tokenVersion` / revoke refresh tokens / disconnect WebSockets (per-request `jwt.strategy.ts:60-62` partial mitigation only) | [`reviews/tenants.md`](reviews/tenants.md) F-5 |

### 2.3 Multi-tenant isolation & schema

| ID | Sev | Dim | Where | Finding | Detail |
|---|---|---|---|---|---|
| T1 | Medium | Perf | `prisma/schema.prisma` StockMovement | `(tenantId, createdAt)` compound index missing | [`reviews/prisma-schema.md`](reviews/prisma-schema.md) F-1 |
| ~~T2~~ | — | — | IngredientMovement | **DROPPED** — column `tenantId` exists at `schema.prisma:2462` (migration `20260311_…` line 444). Only the compound index gap remains as F-3. | [`reviews/prisma-schema.md`](reviews/prisma-schema.md) F-3 |
| ~~T3~~ | — | — | WaiterRequest, BillRequest | **DROPPED** — both have direct `tenantId` + `@@index([tenantId, status])` per migration `20260420180000`. | [`reviews/prisma-schema.md`](reviews/prisma-schema.md) §9 |
| T4 | Low | Sec | `tenants.controller.ts:43, 54` | **VERIFIED downgrade** — guard chain populates `req.tenantId`. Defense-in-depth only. | [`reviews/tenants.md`](reviews/tenants.md) F-1 |
| T5 | Medium | Cor | `tenants.service.ts:91-149` | **Reframed** — `?.` + `?? false` already null-guards at THIS site; risk preserved for other `currentPlan` callers | [`reviews/tenants.md`](reviews/tenants.md) F-2 |
| **NEW** F-Sch-2 | Medium | Perf | WasteLog | `(tenantId, createdAt)` missing | [`reviews/prisma-schema.md`](reviews/prisma-schema.md) F-2 |
| **NEW** F-Sch-4 | Medium | Perf | DeliveryPlatformLog | Compound index gap | [`reviews/prisma-schema.md`](reviews/prisma-schema.md) F-4 |
| **NEW** F-Sch-5 | Medium | Perf | Notification | Compound index gap | [`reviews/prisma-schema.md`](reviews/prisma-schema.md) F-5 |
| **NEW** F-Sch-9 | Medium | Cor | All currency columns | No ISO 4217 constraint — `"USD"` / `"USDOLLAR"` / `""` all accepted | [`reviews/prisma-schema.md`](reviews/prisma-schema.md) F-9 |
| **NEW** F-Sch-11 | Low | Cor | 8 audit `*ById` columns | No FK — orphan-able after user retirement | [`reviews/prisma-schema.md`](reviews/prisma-schema.md) F-11 |

### 2.4 WebSocket gateways & webhooks

| ID | Sev | Dim | Where | Finding | Detail |
|---|---|---|---|---|---|
| **NEW** F-Not-1 | High | Sec | `notifications.gateway.ts:42` | No `payload.type === 'user'` guard and no `algorithms: ['HS256']` pin — accepts marketing / superadmin JWTs (same `JWT_SECRET`) | [`reviews/notifications.md`](reviews/notifications.md) N-1 |
| **NEW** F-Not-2 | High | Cor | `notifications.gateway.ts:45` | Handler reads `payload.userId`; main-app JWTs sign with `sub: user.id`. Per-user notification room is literally `user:undefined` → `sendNotificationToUser` silently no-ops | [`reviews/notifications.md`](reviews/notifications.md) N-2 |
| **NEW** F-An-4 | Medium | Sec | `analytics.gateway.ts:107` | Same `algorithms` pin gap as notifications | [`reviews/analytics.md`](reviews/analytics.md) F-4 |
| **NEW** F-Dlv-5 | High | Cor | `delivery-webhook.controller.ts:113-123` | Yemeksepeti status-update body logged + 200 returned; **no internal Order update** for `PICKED_UP`/`CANCELLED`. Trendyol has no handler at all | [`reviews/delivery-platforms.md`](reviews/delivery-platforms.md) F-5 |
| **NEW** F-Dlv-9 | High | Sec | `webhook-auth.guard.ts:121` | Trendyol replay protection `if (timestamp)` — omit timestamp header to bypass 5-min freshness window | [`reviews/delivery-platforms.md`](reviews/delivery-platforms.md) F-9 |
| **NEW** F-Dlv-10 | Medium | Sec | `webhook-auth.guard.ts:128` | Falls back to `JSON.stringify(request.body)` when `rawBody` missing — verifying signature against re-serialized JSON is unsafe | [`reviews/delivery-platforms.md`](reviews/delivery-platforms.md) F-10 |
| **NEW** F-Dlv-6 | High | Cor | `delivery-order.service.ts:198-211` | P2002 catch-all treats ANY unique-constraint violation as "duplicate, ignore" — not just the dedup index | [`reviews/delivery-platforms.md`](reviews/delivery-platforms.md) F-6 |
| **NEW** F-Dlv-7 | High | Cor | `delivery-auth.service.ts:79-101` | `ensureValidToken` has no single-flight — concurrent webhooks/polls cause N redundant `authenticate()` calls | [`reviews/delivery-platforms.md`](reviews/delivery-platforms.md) F-7 |
| ~~F-Dlv-isRunning~~ | — | — | `order-polling.scheduler.ts:36-60` | **DROPPED** — `isRunning` IS inside try/finally (re-verified at `:37-59`). | [`reviews/delivery-platforms.md`](reviews/delivery-platforms.md) §9 |

### 2.5 Frontend

| ID | Sev | Dim | Where | Finding | Detail |
|---|---|---|---|---|---|
| F1 | High | Sec | `landing/next.config.ts:23-40` **VERIFIED** | No `Content-Security-Policy` header | [`reviews/landing.md`](reviews/landing.md) F-1 |
| F2 | Medium | Cor | `frontend/src/components/ProtectedRoute.tsx:10-26` | Render flicker on reload (downgraded — backend re-auths every request) | [`reviews/frontend-protected-routes.md`](reviews/frontend-protected-routes.md) F-1 |
| F3 | Medium | Cor | `frontend/src/lib/api.ts:42-57` | `refreshInFlight` has no timeout | [`reviews/frontend-lib.md`](reviews/frontend-lib.md) F-1 |
| F4 | Medium | Cor | `frontend/src/main.tsx` | No `unhandledrejection` listener (verified absent) | [`reviews/frontend-protected-routes.md`](reviews/frontend-protected-routes.md) F-2 |
| **NEW** F-FE-SA-1 | High | Sec | `frontend/src/store/superAdminAuthStore.ts:93-97` | `partialize` persists `accessToken` to `localStorage` — **contradicts the 2026-04-27 §3.2 claim that all three stores are memory-only**. Confirmed independently by `frontend-pages-superadmin.md` F-1 and `frontend-auth-stores.md` F-1 | [`reviews/frontend-auth-stores.md`](reviews/frontend-auth-stores.md) F-1 |
| **NEW** F-FE-SA-2 | High | Cor | superAdminAuthStore refresh | Refresh path posts `{refreshToken}` in JSON body, but `partialize` doesn't persist `refreshToken` — after any reload, refresh is structurally dead → forced re-2FA on access-token expiry | [`reviews/frontend-pages-superadmin.md`](reviews/frontend-pages-superadmin.md) F-2 |
| **NEW** F-FE-Mkt-1 | High | Cor | `frontend/src/features/marketing/api/marketingApi.ts:21-53` | Marketing API client never received the single-flight refresh fix from commit `9b9eee4` — N parallel 401s = N concurrent `/marketing/auth/refresh` calls, which under backend rotation revoke each other | [`reviews/frontend-features-marketing.md`](reviews/frontend-features-marketing.md) F-1 |
| **NEW** F-FE-Mkt-2 | High | Cor | `pages/marketing/LeadDetailPage.tsx:331` | Status flip-grid renders WON button; backend `marketing-leads.service.ts:295-299` explicitly 400s — UI offers an action the backend will reject | [`reviews/frontend-features-marketing.md`](reviews/frontend-features-marketing.md) F-2 |
| **NEW** F-FE-Mkt-3 | High | Cor | `store/marketingAuthStore.ts:61` | Comment claims "on reload we re-auth via /api/marketing/auth/refresh" — code does not. Reload = forced re-login | [`reviews/frontend-features-marketing.md`](reviews/frontend-features-marketing.md) F-3 |
| **NEW** F-FE-Ord-1 | High | Cor | POS payment submit | No double-submit guard + no idempotency key (the frontend side of M10) | [`reviews/frontend-features-orders.md`](reviews/frontend-features-orders.md) F-FE1 |
| **NEW** F-FE-Ord-4 | Medium | Cor | `pages/qr-menu/CartPage.tsx:70`, `SubdomainCartPage.tsx:73` | Bypass `lib/env.ts` and silently fall back to `localhost:3000` — regresses commit `5154c2e` | [`reviews/frontend-features-orders.md`](reviews/frontend-features-orders.md) F-FE4 |
| **NEW** F-FE-Sub-1 | High | Cor | `SubscriptionPlansPage.tsx:18,27` | `processingPlanId` setter never called — double-submit guard is **dead code** | [`reviews/frontend-pages-subscription.md`](reviews/frontend-pages-subscription.md) F-1 |
| **NEW** F-FE-PR-3 | Medium | Sec | `frontend/src/sentry.config.ts` | Redaction allowlist is shallow + case-sensitive — misses `accessToken`/`refreshToken`/`cookie`/`set-cookie`/`x-api-key`/nested objects | [`reviews/frontend-protected-routes.md`](reviews/frontend-protected-routes.md) F-3 |
| **NEW** F-FE-Lib-3 | Low | Cor | `frontend/src/lib/socket.ts:4` | Same silent-localhost-fallback pattern that `env.ts` was created to eliminate | [`reviews/frontend-lib.md`](reviews/frontend-lib.md) F-3 |
| **NEW** F-Land-3 | Medium | Sec | `landing/global-error.tsx:117-129`, `[locale]/error.tsx:61-67` | **Corrects 2026-04-27 §6.2** — error pages render stack/digest unconditionally (not dev-only as claimed) | [`reviews/landing.md`](reviews/landing.md) F-3 |
| **NEW** F-Land-2 | Medium | Sec | `landing/lib/api.ts:115` | Silent fallback to hard-coded prod host — same anti-pattern commit `5154c2e` fixed for frontend, landing was missed | [`reviews/landing.md`](reviews/landing.md) F-2 |

### 2.6 Low-risk module escapes

| ID | Sev | Dim | Where | Finding | Detail |
|---|---|---|---|---|---|
| **NEW** PS-1 | High | Sec | `public-stats/services/public-stats.service.ts:23-31` | `IP_HASH_SALT ?? JWT_SECRET ?? APP_SECRET` fallback chain — rotating `JWT_SECRET` silently re-pseudonymizes every historical `ipHash` | [`reviews/low-risk-modules.md`](reviews/low-risk-modules.md) PS-1 |

---

## 3. Cross-cutting observations

### 3.1 Multi-tenant isolation
- **Pattern verified:** middleware → `req.tenantId` → service queries filter by it. `tenantId` references count refreshed below in §3.10. Well-adopted across all 31 modules.
- **Gaps still open:** controllers occasionally trust `req.tenantId` without nullity check (T4, defense-in-depth); compound `(tenantId, X)` indices missing on a handful of hot tables (T1, F-Sch-2/4/5). Most schema gaps (T2/T3) **dropped** after re-verification — both models have direct `tenantId` + `(tenantId, status)` since migration `20260420180000`.
- **Suggested invariants test:** the cross-tenant integration test in [`reviews/tenants.md`](reviews/tenants.md) §10 is now concrete — 23 list endpoints + 10 find endpoints enumerated by name.

### 3.2 Auth & token model — corrections to 2026-04-27 §3.2
- **The "all three frontend auth stores are memory-only" claim is wrong.** `superAdminAuthStore.ts:93-97` persists `accessToken` to `localStorage` (verified). Main-app `authStore` and `marketingAuthStore` are memory-only. See [`reviews/frontend-auth-stores.md`](reviews/frontend-auth-stores.md) §3 I-1.
- **Refresh tokens are httpOnly cookie for tenant realm** — verified. **Marketing and superadmin realms post refresh tokens in JSON body** — XSS-exfiltratable, diverges from tenant pattern. See [`reviews/frontend-pages-superadmin.md`](reviews/frontend-pages-superadmin.md) F-2 and [`reviews/frontend-auth-stores.md`](reviews/frontend-auth-stores.md) F-5.
- **Refresh rotation:** correctly wired through `lib/api.ts` for tenant realm (single-flight from commit `9b9eee4`). **Not adopted by `features/marketing/api/marketingApi.ts`** — N parallel 401s race. See [`reviews/frontend-features-marketing.md`](reviews/frontend-features-marketing.md) F-1.
- **JWT revocation latency:** A1 reframed — `jwt.strategy.ts:36-74` DOES perform a per-request DB lookup of `tokenVersion` (the original framing was wrong). True residual is "one in-flight request can complete with stale claim", not "full JWT TTL". See [`reviews/auth.md`](reviews/auth.md) F-1.
- **Atomic-consume reset (`auth.service.ts:691-721`)** remains the gold standard. Candidates that should adopt it: subscription renewal (M9), split-bill (M10), invoice numbering (M3), backup-code redemption (F-SA-8). See [`reviews/auth.md`](reviews/auth.md) §8.

### 3.3 Scheduler / cron reliability
Verified pattern across all schedulers — refer to [`reviews/subscriptions.md`](reviews/subscriptions.md) §8 (canonical exemplar at `subscription-scheduler.service.ts:29-43`).

```ts
const lockId = djb2('<scheduler-name>');
const [{ locked }] = await this.prisma.$queryRawUnsafe(
  `SELECT pg_try_advisory_lock(${lockId}) AS locked`
);
if (!locked) return;
try { /* work */ } finally {
  await this.prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${lockId})`);
}
```

- **Multi-instance safe:** ✅ `lockId` is hashed from a constant; no user input.
- **`order-polling.scheduler.ts isRunning` finding DROPPED** — [`reviews/delivery-platforms.md`](reviews/delivery-platforms.md) §9 verified the flag is correctly nested inside the outer try/finally at `:37-59`.
- **DJB2 brittleness** (subscriptions F-4) — fine at 6 jobs; switch to named-lock registry as count grows.

### 3.4 Database schema audit (`prisma/schema.prisma`, 87 models)
See [`reviews/prisma-schema.md`](reviews/prisma-schema.md) for the full audit. Headline items:
- **T2, T3 dropped** after re-read of migration `20260420180000` — IngredientMovement, WaiterRequest, BillRequest all have direct `tenantId` columns.
- **Cascade/restrict** mostly sensible; `Tenant.currentPlan` SetNull (T5) and `Order.user` Restrict still flagged.
- **Compound index gaps** widened to 4 more tables: WasteLog, IngredientMovement, DeliveryPlatformLog, Notification.
- **Currency columns** have no ISO 4217 constraint (F-Sch-9).
- **Soft-delete inconsistency** still stands — three styles coexist (F-Sch-7).
- **50 money columns** all `Decimal @db.Decimal(10, 2)` — uniform.

### 3.5 WebSocket gateways
| Gateway | JWT verified | Type-checked | Algorithms pinned | Tenant-scoped rooms | Notes |
|---|---|---|---|---|---|
| `kds.gateway.ts` | ✅ | ✅ | ✅ HS256 | ✅ | Exemplar. Dual staff+customer auth, role-based rooms, Sentry envelope. See [`reviews/kds.md`](reviews/kds.md). |
| `notifications.gateway.ts` | ✅ | ❌ | ❌ | ✅ | **N-1** (cross-realm accept), **N-2** (`payload.userId` undefined → `user:undefined` room). See [`reviews/notifications.md`](reviews/notifications.md). |
| `analytics.gateway.ts` | ✅ | ❌ | ❌ | ✅ | Same gaps as notifications; plus burst-rate concerns. See [`reviews/analytics.md`](reviews/analytics.md). |

### 3.6 Webhook signature verification
- **Yemeksepeti:** HMAC-SHA512 + timing-safe ✅
- **Trendyol:** HMAC-SHA256 + 5-min anti-replay — but **bypass at `webhook-auth.guard.ts:121`**: timestamp check guarded by `if (timestamp)` (F-Dlv-9). Plus rawBody fallback to JSON.stringify (F-Dlv-10).
- **Getir / Migros:** polling — no signatures applicable (confirmed at `constants/platform-status-map.ts:42`).
- **Default branch fails closed** ✅
- **Yemeksepeti status updates** silently dropped — F-Dlv-5.

### 3.7 Logging & observability
- Sentry wired on backend, frontend, and landing.
- **Frontend redaction whitelist is shallow** — [`reviews/frontend-protected-routes.md`](reviews/frontend-protected-routes.md) F-3.
- **Landing global-error renders stack in prod** (corrects 2026-04-27 §6.2 — landing.md F-3).
- Source maps hidden ✅
- Auth Sentry tags still include email/IP — P3 hardening.

### 3.8 Test coverage gaps
- Backend: **13 spec files**, ~50k LOC.
- Frontend: **1 test file** (`ErrorBoundary.spec.tsx`).
- Landing: **0 tests.**
- **Per-feature §10 sections** are now the seed material for a coverage program. Money paths and the cross-tenant invariants test should be P0 by leverage.

### 3.9 Public endpoints inventory (`@Public()`)
~40 endpoints across `auth`, `desktop-app` (ApiKeyGuard verified at [`reviews/low-risk-modules.md`](reviews/low-risk-modules.md)), `public-stats` (**PS-1 escape**), `qr-menu`, `customer-orders`, `tenants/by-subdomain`, `tables`, `contact`, `subscriptions/plans`, `delivery-webhook` (WebhookAuthGuard with two bypasses noted in §2.4), `reservations/public-*`. Throttling mostly in place; a few read-only public endpoints lack `@Throttle` (tenants F-7).

### 3.10 Grep snapshot (run 2026-05-11)

| Check | 2026-04-27 | 2026-05-11 | Notes |
|---|---|---|---|
| `dangerouslySetInnerHTML` / `innerHTML =` | 0 | 0 | clean |
| `eval(` / `new Function(` | 0 | 0 | clean |
| `localStorage.*Item` writes | only `i18n_language` (claimed) | **5 sites — `i18n_language`, SA accessToken (the bug), onboarding `ui-storage`, landing locale, landing one other** | the 2026-04-27 grep was incomplete; corrected per [`reviews/frontend-auth-stores.md`](reviews/frontend-auth-stores.md) and [`reviews/landing.md`](reviews/landing.md) |
| `target="_blank"` without `rel="noopener"` | 2 | 2 | unchanged |
| `$queryRaw*` | 9 | 9 | all advisory-lock helpers |
| `@Public()` endpoints | ~40 | **52** | grew between reviews — verify new ones intentional |
| Cron schedulers | 9 jobs / 5 modules | **9 jobs** | unchanged |
| Backend test files | 13 | **19** | up 6 — but money-path coverage still thin |
| Frontend test files | 1 | 1 | unchanged |
| Landing test files | 0 | 0 | unchanged |
| Prisma models | 87 | 87 | unchanged |
| `tenantId` references in backend `modules/` | 843 | **1815** | doubled; the multi-tenant pattern is now thoroughly applied |
| Per-feature deep-dive files | n/a | **33** | new this round (`docs/reviews/*.md`) |

---

## 4. Per-feature deep-dive index

The full per-module review now lives in [`docs/reviews/`](reviews/). One file per feature, with §1 health + §2 scope + §3 invariants + §4 state machine (where applicable) + §5 money audit (where applicable) + §6 concurrency + §7 findings + §8 what's solid + §9 spot-checks + §10 recommended tests.

### Backend — Tier 1 (business-logic critical)

| File | Health | One-line summary |
|---|---|---|
| [`accounting.md`](reviews/accounting.md) | 🔴 red | Credentials plaintext (M8 VERIFIED), invoice numbering gap-prone (M3 downgraded), Foriba XML drift, missing SYNCING state, div-by-zero on quantity 0 |
| [`auth.md`](reviews/auth.md) | 🟢 green | Atomic-consume reset is the codebase exemplar. A1 reframed (DB lookup IS done). New: refresh-rotation TOCTOU (F-3), social-auth tenant.status gap (F-2) |
| [`delivery-platforms.md`](reviews/delivery-platforms.md) | 🟡 yellow | Trendyol replay bypass, rawBody fallback, Yemeksepeti status drop, P2002 catch-all, no single-flight on `ensureValidToken`. `isRunning` finding dropped after verify |
| [`orders.md`](reviews/orders.md) | 🟡 yellow | State-machine bypass (F-O2), refund doesn't reverse stock (F-O5), update race (F-O3), no order-create idempotency (F-O7), plus M-series money-path findings |
| [`payments.md`](reviews/payments.md) | 🟡 yellow | 17 Decimal→Number conversion sites mapped; refund double-tap race (F-3); split-bill no idempotency (M10); customer-create race inside payment tx |
| [`subscriptions.md`](reviews/subscriptions.md) | 🟡 yellow | Renewal write-side idempotency gap (M9); DJB2 lock-id brittleness; dueDate uses `new Date()` |
| [`superadmin.md`](reviews/superadmin.md) | 🟡 yellow | `tokenVersion` never bumped on refresh — token reusable 7 days (F-3); backup-code RMW race (F-8); request-logger leaks tempToken (F-5) |
| [`tenants.md`](reviews/tenants.md) | 🟢 green | Boundary layer healthy. Suspend doesn't revoke tokens (F-5). T4 verified-and-downgraded. Cross-tenant test skeleton (23+10 endpoints) in §10 |
| [`z-reports.md`](reviews/z-reports.md) | 🟡 yellow | Finalization is the codebase's tamper-evidence exemplar. Hash uses non-canonical Decimal.toString() (F-4); reportNumber day-scope collision (F-3) |

### Backend — Tier 2 (moderate)

| File | Health | One-line summary |
|---|---|---|
| [`analytics.md`](reviews/analytics.md) | 🟡 yellow | Missing type-check + algorithms pin on gateway; 1600-row upsert burst; unbounded heatmap reads |
| [`customers.md`](reviews/customers.md) | 🟢 green | Loyalty redemption is the codebase **gold standard** for race-free state mutation. SMS creds in env vars not per-tenant (F-4) |
| [`kds.md`](reviews/kds.md) | 🟢 green | Gateway exemplar. Only the rate-limit gap remains (F-1 Low Sec) |
| [`marketing.md`](reviews/marketing.md) | 🟢 green | 586-LOC leads service confirmed; `updateStatus` vs `convert()` race (F-2); hardcoded bcrypt cost in marketing-users (F-8) |
| [`notifications.md`](reviews/notifications.md) | 🟡 yellow | Cross-realm JWT accept (N-1 promoted); `payload.userId` undefined → silent no-op (N-2) |
| [`settings-integrations.md`](reviews/settings-integrations.md) | 🟢 green | The credential-storage template. F-4: missing audit-log on credential writes (the one gap) |
| [`stock-management.md`](reviews/stock-management.md) | 🟡 yellow | Manual movement TOCTOU race (F-4); 8 unbounded list endpoints; dashboard triggers alert side effect; **T2 dropped — IngredientMovement.tenantId verified to exist** |
| [`upload.md`](reviews/upload.md) | 🟢 green | MIME + magic-byte chain is exemplary. `/uploads/*` served unauthenticated (F-3); Promise.all over 10 sharp pipelines (F-2) |

### Backend — Tier 3 + Schema

| File | Health | One-line summary |
|---|---|---|
| [`low-risk-modules.md`](reviews/low-risk-modules.md) | 🟢 green (PS-1 yellow) | 17 modules grouped. **PS-1 High Sec escape:** IP-hash salt fallback to JWT_SECRET. Otherwise clean |
| [`prisma-schema.md`](reviews/prisma-schema.md) | 🟡 yellow | T2/T3 dropped after migration re-read. 4 new compound-index gaps. No ISO 4217 currency constraint. Audit FK gaps on 8 columns |

### Frontend

| File | Health | One-line summary |
|---|---|---|
| [`frontend-lib.md`](reviews/frontend-lib.md) | 🟢 green | F3 refresh-timeout (Medium); socket.ts has same silent-localhost-fallback `env.ts` was created to eliminate (F-3); subscribe-listener leak (F-2) |
| [`frontend-auth-stores.md`](reviews/frontend-auth-stores.md) | 🟡 yellow | **F-1 High Sec:** SA store persists accessToken to localStorage — contradicts 2026-04-27 §3.2. 12 of 16 SA state-flag combinations are orphan |
| [`frontend-protected-routes.md`](reviews/frontend-protected-routes.md) | 🟡 yellow | F2 confirmed (render flicker); F4 confirmed (no `unhandledrejection`); Sentry redaction is case-sensitive shallow whitelist (F-3) |
| [`frontend-pages-auth.md`](reviews/frontend-pages-auth.md) | 🟡 yellow | OAuth implicit-flow concern persists; role-blind landing redirect (F-6); 5 state machines documented |
| [`frontend-pages-subscription.md`](reviews/frontend-pages-subscription.md) | 🟡 yellow | F-1 **High:** double-submit guard is dead code; F-2 hooks-rules violation; F-6 missing idempotency key (cross-link M9) |
| [`frontend-pages-superadmin.md`](reviews/frontend-pages-superadmin.md) | 🟡 yellow | F-1 (accessToken in localStorage) + F-2 (refresh structurally dead post-reload) — both High |
| [`frontend-features-orders.md`](reviews/frontend-features-orders.md) | 🟡 yellow | Payment double-submit (F-FE1 High), order-create no idempotency (F-FE2 High), QR-menu bypass `lib/env` (F-FE4) |
| [`frontend-features-kds.md`](reviews/frontend-features-kds.md) | 🟢 green | Logout doesn't force-disconnect socket (F-2); rest of the surface clean (one file, 115 LOC) |
| [`frontend-features-onboarding.md`](reviews/frontend-features-onboarding.md) | 🟢 green | **Scope correction**: this is a react-joyride product tour, not a first-run signup wizard (signup lives in pages/auth). Client-only persistence to `ui-storage` (F-3) |
| [`frontend-features-marketing.md`](reviews/frontend-features-marketing.md) | 🟡 yellow | **3 Highs:** missing single-flight refresh (F-1); WON button backend 400s (F-2); reload = forced re-login (F-3) |
| [`frontend-features-stock.md`](reviews/frontend-features-stock.md) | 🟡 yellow | Manual movement form pairs with backend F-StM-4 — no double-submit guard (F-1 High); 8 unbounded list hooks (F-3) |
| [`frontend-features-analytics.md`](reviews/frontend-features-analytics.md) | 🟡 yellow | CameraCalibration uses raw fetch bypassing lib/api (F-1); 3 unbounded heatmap reads fire unconditionally (F-2) |
| [`frontend-low-risk.md`](reviews/frontend-low-risk.md) | 🟢 green | **Correction**: §5.7 "three.js not in prod" is false — pulled into the analytics lazy chunk via `AnalyticsFloorPlan.tsx` |

### Landing

| File | Health | One-line summary |
|---|---|---|
| [`landing.md`](reviews/landing.md) | 🟡 yellow | F-1 CSP gap (the seed); F-3 error pages render stack in prod (corrects §6.2); F-2 silent localhost fallback (regression of `5154c2e`) |

---

## 5. Recommended action plan

Effort tiers: XS (<1h) · S (~half day) · M (~day) · L (multi-day).

### P0 — Do first (this week)

| ID | Effort | Action |
|---|---|---|
| F-FE-SA-1 | S | **New top of list** — make `superAdminAuthStore` memory-only on `accessToken`. Drop `accessToken` from `partialize` at `superAdminAuthStore.ts:93-97`. Cross-link to the F-1 fix in [`reviews/frontend-auth-stores.md`](reviews/frontend-auth-stores.md). |
| F-SA-3 | S | `superadmin-auth.service.ts:550-589` — bump `tokenVersion` on every refresh (mirror tenant `auth.service.ts:481-488`). 7-day reusable refresh is the worst single token-lifecycle bug. |
| F-Not-2 | XS | `notifications.gateway.ts:45` — use `payload.sub` instead of `payload.userId`. The per-user notification flow is currently broken; fix is one-line. |
| F-FE-Mkt-1 | S | Wire marketing `marketingApi.ts:21-53` into the same single-flight refresh from `lib/api.ts` (commit `9b9eee4` pattern). |
| F-Dlv-9 | XS | `webhook-auth.guard.ts:121` — remove the `if (timestamp)` guard; make the timestamp header required for Trendyol. |
| F-Dlv-10 | S | `webhook-auth.guard.ts:128` — fail closed if `rawBody` is missing; never re-serialize. |
| M8 | M | Migrate AccountingSettings 11 secret columns to `encryptJson` + redact-on-response, mirroring `settings/integrations`. Rotate all stored credentials after migration. |
| F-Dlv-5 | S | Add Yemeksepeti `PICKED_UP`/`CANCELLED` Order updates; add Trendyol status webhook handler. |
| F1 | XS | Add a starter Content-Security-Policy header to `landing/next.config.ts`. |
| PS-1 | XS | Require `IP_HASH_SALT` env var in production; remove the `JWT_SECRET` / `APP_SECRET` fallbacks. |

### P1 — This sprint

| ID | Effort | Action |
|---|---|---|
| M9, M10 | M | Idempotency keys on subscription renewal write and split-bill writes — adopt the `customers/loyalty.service.ts:50-107` Serializable+conditional-updateMany pattern. |
| F-FE-Ord-1, F-FE-Ord-2 | S | Frontend side of M10 + F-O7 — generate idempotency key client-side per submit; disable button while pending. |
| F-Ord-O5 | M | Refund flow should reverse stock deductions, mirroring `updateStatus → CANCELLED`. |
| F-Ord-O3 | S | `orders.service.ts updateStatus` — conditional `updateMany` on `status=prev`. |
| F-Pay-3 | XS | Refund `tx.payment.update` — add `status` to the `where` filter, throw on `count===0`. |
| F-Auth-3 | S | Refresh-rotation TOCTOU — wrap revoke+generate in `$transaction` + conditional updateMany. |
| F-Acc-7 | S | Introduce `SYNCING` intermediate `externalStatus` + idempotent retry. |
| F-Acc-4 | XS | Guard `OrderItem.quantity === 0` before back-calc divide. |
| F-Acc-6 | M | Move Foriba UBL-TR XML totals to Decimal sums. |
| M3 | S | Wrap `getNextInvoiceNumber()` in a transaction + row-level lock or `RETURNING UPDATE`. |
| M1, M2 | S | Replace JS `Number` with `Prisma.Decimal` in payments comparisons & split-bill tolerance. |
| M5 | S | Replace swallowed try/catch around invoice generation with bounded retry + Sentry `REVENUE_SYNC_FAILED` event. |
| M7 | S | Cross-validate platform-supplied totals vs item sums on inbound delivery webhooks. |
| F-StM-4 | S | `ingredient-movements.service.ts:36-73` — conditional updateMany with stock precondition. |
| F-Ten-5 | S | On tenant suspend: bump `User.tokenVersion` for all tenant members; broadcast disconnect to gateways. |
| F-FE-Mkt-3, F-FE-Mkt-2 | S | Marketing reload-re-auth path; remove WON button from status grid. |
| F-FE-SA-2 | S | SA refresh-from-body → cookie-based, mirror tenant pattern. |
| F-FE-Sub-1 | XS | Wire `processingPlanId` setter or remove dead code; add real submit guard. |
| F-FE-PR-3 | S | Frontend `sentry.config.ts` redaction → case-insensitive + nested + add `accessToken`/`refreshToken`/`set-cookie`/`x-api-key`. |
| F2 | S | Add loading state to `ProtectedRoute` so children don't render before access token. |
| F3 | XS | 10s timeout on refresh promise in `lib/api.ts`. |
| F4 | XS | `unhandledrejection` listener in `main.tsx`. |
| F-Not-1, F-An-4 | XS | Add `payload.type === 'user'` + `algorithms: ['HS256']` to notifications and analytics gateway handshakes. |
| A3 | S | Reset failed-login counter only after full 2FA succeeds. |
| A5 | S | Add `tenant.status === 'ACTIVE'` check to the 4 social-auth branches. |
| F-Land-3 | XS | `landing/global-error.tsx`, `[locale]/error.tsx` — gate stack rendering behind `process.env.NODE_ENV !== 'production'`. |
| F-Land-2 | XS | `landing/lib/api.ts:115` — fail loud (same shape as `frontend/src/lib/env.ts:27-30`). |

### P2 — Next sprint

| ID | Effort | Action |
|---|---|---|
| F-Sch-2/4/5 | S | Schema migration: add `@@index([tenantId, createdAt])` to WasteLog, IngredientMovement, DeliveryPlatformLog, Notification. |
| F-Sch-9 | M | Currency-column CHECK constraint or app-level validator on ISO 4217 codes. |
| T5 (schema) | S | Switch `Tenant.currentPlan` to `onDelete: Restrict`; switch `Order.user` to `SetNull`. |
| z-reports F-3, F-4 | S | Sequence-per-day report numbering; normalize Decimal via `toFixed(2)` before hashing. |
| orders refactor | M | Extract `OrderPaymentHandler` and `OrderDeliveryHandler` from the 1136-LOC `orders.service.ts`. |
| F-Up-2, F-Up-3 | S | upload — queue Sharp resize off the request path; gate `/uploads/*` behind auth. |
| F-An-2, F-An-3 | S | Cap traffic-flow upsert batch size; bound heatmap `findMany`. |
| F-SA-7, F-SA-8 | S | Per-account 2FA throttle; conditional `updateMany` on backup-code redeem. |
| frontend Google OAuth | M | Verify token-exchange path; migrate to PKCE if implicit-flow data is being trusted. |
| auth F-5 | S | Stop swallowing `sendEmailVerification` errors. |
| F-FE-Stk-3 | S | Add pagination cap on all 8 stock list hooks. |
| F-FE-An-1 | S | CameraCalibration — route through `lib/api.ts` instead of raw `fetch`. |

### P3 — Backlog / hardening

| ID | Effort | Action |
|---|---|---|
| (tests) | L | **Highest leverage**: integration tests for auth/payment/order/subscription paths. Use per-feature §10 sections as seed material. Set coverage floor on services in `auth`/`orders`/`payments`/`subscriptions`/`accounting`. |
| (tests) | M | Implement the cross-tenant invariants suite from [`reviews/tenants.md`](reviews/tenants.md) §10 (23 list + 10 find endpoints). |
| (frontend tests) | M | `lib/api`, `lib/socket`, auth stores, `ProtectedRoute`, payment UI. |
| (schema) | M | Standardize soft-delete (`deletedAt`) across tenant-scoped models. |
| (Stripe/Iyzico/PayTR webhooks) | L | If adopted, add signature-verified controllers with event-id idempotency. |
| (logging) | XS | Replace remaining `console.*` with NestJS `Logger`. |
| (auth) | S | Document the JWT `tokenVersion` revocation-latency trade-off in CLAUDE.md or auth README. |
| (subscriptions) | S | DJB2 lock-id → named-lock registry. |
| (sentry) | XS | Drop email/IP from auth Sentry tags; hashed userId only. |
| F-FE-Lib-2, F-FE-Lib-3 | XS | socket.ts socket-URL resolution → into env.ts; capture subscribe unsubscribe on socket re-init. |
| F-StM-7 | XS | Move alert emit out of `stock-dashboard.service.ts`. |
| F-Up-9 | XS | Pin sharp `limitInputPixels` explicitly. |
| F-FE-Lo-2 | S | Lazy-load `DashboardPage` and `POSPage`. |

---

## 6. What's already excellent (keep doing)

- **Multi-tenant isolation** enforced widely (843+ `tenantId` references); middleware → `req.tenantId` → service filter pattern is the right shape.
- **Atomic-consume password reset** (`auth.service.ts:691-721`) — verified at source. **The reference implementation for one-shot token consumption.** Candidates to adopt: subscription renewal (M9), split-bill (M10), invoice numbering (M3), backup-code redemption.
- **Loyalty redemption pattern** (`customers/loyalty.service.ts:50-107`) — Serializable `$transaction` + conditional `updateMany` + `count !== 1` rollback + audit-row in same tx. **The gold standard for race-free state mutation.** Documented with code excerpt at [`reviews/customers.md`](reviews/customers.md) §8.
- **All schedulers** use `pg_advisory_lock` with constant-derived lock IDs. Canonical exemplar at `subscriptions/services/subscription-scheduler.service.ts:29-43`.
- **KDS WebSocket gateway**: dual-auth, strict `type === 'user'` check, role-based rooms, reconnect debounce, Sentry-wrapped handshake. The reference for the other two gateways. See [`reviews/kds.md`](reviews/kds.md).
- **Z-report finalization** (`closeReport :489-502`) — conditional `updateMany` on `isFinalized=false` + SHA-256 payload digest. Tamper-evident. The strongest correctness pattern outside loyalty.
- **Webhook signature verification** for Yemeksepeti (HMAC-SHA512 + JWT-style timing-safe) and Trendyol (HMAC-SHA256). Defaults fail closed. (Two bypass gaps now flagged in §2.4 to close.)
- **Sentry redaction** wired on backend, frontend, and landing; source maps hidden in landing prod. (Whitelist scope widening still pending — F-FE-PR-3.)
- **`settings/integrations`** — encryption + redaction template. See [`reviews/settings-integrations.md`](reviews/settings-integrations.md) §8 for the four-part pattern.
- **Frontend single-flight refresh** at `lib/api.ts:38-58` plus the hardening rounds at commits `5154c2e` (env fail-loud) and `9b9eee4` (Sentry-safe filter, single-flight token refresh). Now the marketing realm needs to adopt the same.
- **Partial unique indices** added by migration `20260420180000_tenant_fks_and_partial_uniques` — `payments_orderId_idempotencyKey_notnull_key` and `subscriptions_tenantId_active_key`. The single-payment idempotency story now has tri-layer defense.
- **Voxel-world tree-shaking** confirmed at the dev-only gate (`App.tsx:95-97`). (Three.js does land in the analytics lazy chunk via a separate path — flagged at `frontend-low-risk.md` F-1.)

---

## 7. Out of scope this round

- `desktop/` (Tauri/Rust + BLE printer integration)
- `edge-device-cpp/` (NVIDIA Jetson YOLO/TensorRT inference + WebSocket client)
- `segmentation-service/` (Python/FastAPI + SAM2/GroundingDINO)
- Infra/CI: `docker-compose.*.yml`, `nginx.conf`, `deploy.sh`/`scripts/*`, `.github/workflows/*`

A separate review pass is recommended for these — particularly the C++ edge device (network listener, model loading) and the deploy scripts (secrets handling, backup encryption).

---

## 8. Verification & methodology notes

- **Per-feature files dropped the *(unverified)* tag count from ~70 to effectively zero.** Each Tier-1 file opened every cited `file:line` + 30 lines of context. Drops, downgrades, and reframes are documented in each file's §9.
- **6 findings were dropped after first-hand re-read** vs the 2026-04-27 round; **5 had severities adjusted**. The aggregated list is in §9.1 below.
- **3 corrections to upstream cross-cutting claims** stood out: (a) the §3.2 "all frontend stores memory-only" claim is wrong (SA store persists), (b) §5.7 "three.js not in prod" is wrong (analytics chunk), (c) §6.2 "error stack only in dev" is wrong (renders unconditionally). All three are documented in their per-feature files and corrected here.
- **Spot-check 5 random findings per Tier-1 file** is still the right hygiene before remediating — although the *(unverified)* tags are gone, the depth of the per-file reads varies (Tier-1 reads service files end-to-end; Tier-2/3 only the highest-LOC ones).

---

## 9. Appendix

### 9.1 Dropped findings, downgrades, reframes (consolidated)

Cumulative across 2026-04-27 and 2026-05-11. The per-file §9 sections own the full record.

**Dropped (verified false):**
1. **"Refresh in JSON body" — `auth.controller.ts:120-122`.** Verified at `:106`; cookie-only. (Carried forward from 2026-04-27.)
2. **"Refund auth bypass" — `payments.service.ts:325-330`.** `NotFoundException` fires before tenant check. (Carried forward.)
3. **"Getir/Migros webhook signatures missing".** Polling platforms; no webhook routes. (Carried forward.)
4. **A2 "Password-reset race".** Atomic-consume verified at `auth.service.ts:691-721`. (Carried forward.)
5. **T2 "IngredientMovement no direct tenantId".** Verified column exists at `schema.prisma:2462`; index gap only. ([`reviews/prisma-schema.md`](reviews/prisma-schema.md), [`reviews/stock-management.md`](reviews/stock-management.md))
6. **T3 "WaiterRequest, BillRequest no tenantId".** Verified `tenantId` + `@@index([tenantId, status])` exist per migration `20260420180000`. ([`reviews/prisma-schema.md`](reviews/prisma-schema.md))
7. **delivery-platforms "isRunning outside try/finally".** Verified at `order-polling.scheduler.ts:37-59` — flag IS inside outer try/finally. ([`reviews/delivery-platforms.md`](reviews/delivery-platforms.md) §9)
8. **superadmin "tempToken in audit log".** No `auditService.log` callsite passes tempToken; real exposure is request-logger redact gap (re-issued as F-SA-5). ([`reviews/superadmin.md`](reviews/superadmin.md) §9)
9. **M6 "NaN risk on tax-post-discount".** Zero-guard already present at `orders.service.ts:217, :575`. ([`reviews/orders.md`](reviews/orders.md) §9)
10. **CODE_REVIEW.md §3.2 "three stores memory-only".** Wrong — SA store persists accessToken. ([`reviews/frontend-auth-stores.md`](reviews/frontend-auth-stores.md), [`reviews/frontend-pages-superadmin.md`](reviews/frontend-pages-superadmin.md))
11. **CODE_REVIEW.md §5.7 "three.js not in prod bundle".** Wrong — pulled into analytics lazy chunk via `AnalyticsFloorPlan`. ([`reviews/frontend-low-risk.md`](reviews/frontend-low-risk.md))
12. **CODE_REVIEW.md §6.2 "error pages render generic in prod".** Wrong — `global-error.tsx:117-129`, `[locale]/error.tsx:61-67` render stack unconditionally. ([`reviews/landing.md`](reviews/landing.md))
13. **stock-management "legacy StockMovement".** Verified dead. ([`reviews/stock-management.md`](reviews/stock-management.md) F-12)
14. **§11.2 grep "localStorage writes only `i18n_language`".** Incomplete — three more writes exist (SA accessToken, onboarding `ui-storage`, landing). ([`reviews/frontend-auth-stores.md`](reviews/frontend-auth-stores.md), [`reviews/landing.md`](reviews/landing.md))

**Severity downgrades:**
15. **T1** High → Medium (Perf). `@@index([tenantId])` exists; only compound missing. (Carried forward.)
16. **T4** High → Low (defense-in-depth). Guard chain verified. (Carried forward.)
17. **A1** High → Medium. JWT strategy DOES perform per-request DB lookup; latency is one in-flight request, not JWT TTL. ([`reviews/auth.md`](reviews/auth.md))
18. **A4** High → Low. `verifyTotp` returns false on null secret; invariant holds by side-effect. ([`reviews/superadmin.md`](reviews/superadmin.md))
19. **M3** High → Medium. `@@unique([tenantId, invoiceNumber])` backstops to clean error; residual is sequence gaps. ([`reviews/accounting.md`](reviews/accounting.md))
20. **F2** High → Medium. Backend re-auths every request; only flicker + double-fetch. ([`reviews/frontend-protected-routes.md`](reviews/frontend-protected-routes.md))

**Reframes (severity unchanged, target shifted):**
21. **A5** — password path OK; 4 social-auth branches miss `tenant.status` (not `validateUser`). ([`reviews/auth.md`](reviews/auth.md) F-2)
22. **M5** — call IS awaited; real defect is the swallowed try/catch. ([`reviews/payments.md`](reviews/payments.md) F-7)
23. **T5** — `?. ?? false` already null-guards at this site; risk preserved for other `currentPlan` callers. ([`reviews/tenants.md`](reviews/tenants.md) F-2)
24. **§5.2 SA duplicate state** — confirmed; broken down as 16-cell legality matrix with 12 orphan combinations. ([`reviews/frontend-auth-stores.md`](reviews/frontend-auth-stores.md))

### 9.2 Total findings count per per-feature file

For traceability — counts of `| Sev | Dim | ...` rows (or equivalent finding IDs) per file. Drift is expected as fixes land.

```
$ wc -l docs/reviews/*.md
```

See per-file headers for per-file invariant and finding counts; aggregate is roughly:
- Tier-1 backend (9 files): ~140 invariants, ~130 findings
- Tier-2 backend (8 files): ~95 invariants, ~70 findings
- Tier-3 + schema (2 files): ~25 invariants, ~45 findings
- Frontend (13 files): ~120 invariants, ~110 findings
- Landing: 12 invariants, 6 findings

---

*End of index. For follow-up sessions, work top-down through §5 (P0 → P3). Each P0/P1 item references either a finding ID traceable to its per-feature file's §7, or directly to the per-feature file path. The 2026-04-27 first-round report is preserved in git history at commit `cd0731d`.*
