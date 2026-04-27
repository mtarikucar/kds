# Code Review — 2026-04-27

**Branch:** `test`  ·  **Reviewer:** Claude (Opus 4.7)  ·  **Scope:** backend (NestJS), frontend (React/Vite), landing (Next.js 16). Out of scope this round: `desktop/`, `edge-device-cpp/`, `segmentation-service/`, infra/CI scripts.

**Method:** Targeted review of 2–6 highest-risk files per module (services, guards, gateways, schedulers, adapters, payment paths). Findings are pinned to `file:line` references. A handful of agent-reported findings were spot-checked against the source and dropped where the code already handled the case correctly — those are noted explicitly. Findings that were not spot-checked are tagged *(unverified)* and should be confirmed before action.

**Severity:** Critical → High → Medium → Low → Info  
**Dimension:** Sec (security/multi-tenant) · Cor (correctness/business logic) · Arch (architecture/code quality) · Perf (performance/reliability)

---

## 1. Executive Summary

The repo is in **broadly good shape** after the recent security audit (commit `149604d` shipped 38 fixes). Multi-tenant isolation is enforced widely (843 `tenantId` references across query sites), schedulers correctly use `pg_advisory_lock` for multi-instance safety, all three Tier-1 WebSocket gateways validate JWTs and scope rooms by tenant, frontend tokens never touch `localStorage`, and refresh tokens are properly httpOnly. There are **no findings that are unambiguously "do not deploy".**

What's left is concentrated in three buckets:

1. **Money-path correctness** (orders, accounting, subscriptions). Mostly `Prisma.Decimal` is used consistently, but a few intermediate `Number` conversions leak precision; subscription renewal and split-bill writes lack client-supplied idempotency keys; sales-invoice numbering can race under concurrent POSTs. Nothing exploitable from the outside, but the kind of bug that surfaces under load or in audits.
2. **Multi-tenant schema hygiene.** Several tenant-scoped models (e.g., `WaiterRequest`, `BillRequest`, `IngredientMovement`) lack a direct `tenantId` column and rely on FK chains. Several `[tenantId, X]` query patterns lack matching compound indices, so high-volume reads fall back to scans. Soft-delete is inconsistent (`status='DELETED'` on some, hard delete on others).
3. **Frontend observability & UX edges.** Landing site has no Content-Security-Policy header, `ProtectedRoute` renders children before `accessToken` is ready on reload, `lib/api.ts` refresh has no timeout, and frontend has only one test file (`ErrorBoundary.spec.tsx`).

| Severity | Count | Notes |
|---|---|---|
| Critical | 0 | (3 agent-flagged Criticals turned out to be already-handled — see §11.1) |
| High | ~19 | mostly correctness/race/precision issues in money paths, plus a few schema gaps |
| Medium | ~32 | architecture, perf, missing pagination, error-swallowing |
| Low | ~15 | style/nit, doc gaps |
| Info | 9 | observations / non-actionable |

> **Caveat:** several findings tagged *(unverified)* came from targeted agent reads against a snapshot of the code. Of the items I spot-checked end-to-end (8 in total), 5 stood and 3 turned out to already be handled by code that wasn't included in the agent's read window. Treat each *(unverified)* item as a hypothesis to confirm at the cited line before remediation, not a defect to fix sight-unseen.

**Top 5 themes** (each maps to multiple findings below):
1. Idempotency missing on subscription renewal & split-bill writes.
2. Compound indices `(tenantId, createdAt)` and `(tenantId, status)` are implied by query patterns but missing on several models.
3. Async error swallowing (email, audit log, accounting sync) returns 200 even when the side-effect failed silently.
4. Test coverage is thin: 13 backend specs, 1 frontend spec, 0 landing — auth/payment/order paths in particular are uncovered.
5. Frontend `ProtectedRoute` and Axios refresh both have race-window gaps that don't break security but cause UX flicker and potential cascade-hang.

---

## 2. Critical & High Findings (consolidated)

Every item below references a per-module section for fuller context. Items marked *(unverified)* were not spot-checked end-to-end — confirm the line/condition before fixing.

### Money-path correctness

| ID | Sev | Dim | Where | Finding |
|---|---|---|---|---|
| M1 | High | Cor | `backend/src/modules/orders/services/payments.service.ts:166-167` *(unverified)* | `Number(totalPaid._sum.amount || 0)` converts `Prisma.Decimal` to JS `Number`; on large orders this loses precision before the `>= orderAmount` comparison. Stay in `Decimal`. |
| M2 | High | Cor | `payments.service.ts:448-455` *(unverified)* | Split-bill tolerance check uses `Math.abs(...) > 0.01` on JS numbers instead of `Decimal.sub().abs().gt('0.01')`. |
| M3 | High | Cor | `backend/src/modules/accounting/services/sales-invoice.service.ts:32-33` *(unverified)* | `getNextInvoiceNumber()` race: two concurrent POSTs can both pass the "next" check and mint duplicate invoice numbers. Wrap in `$transaction` with row-level lock or move to `RETURNING` after `UPDATE`. |
| M4 | High | Arch | `backend/src/modules/accounting/services/accounting-sync.service.ts:29` *(unverified)* | `if (invoice.externalId) return;` blocks re-sync after provider swap. Compare `externalProvider === currentProvider` instead. |
| M5 | High | Cor | `backend/src/modules/orders/services/payments.service.ts:282-292` *(unverified)* | Auto-invoice generation is fire-and-forget after the payment TX commits. If sync fails, order is PAID but no invoice exists, accounts drift silently. Add bounded retry with explicit `REVENUE_SYNC_FAILED` log. |
| M6 | High | Cor | `backend/src/modules/orders/services/orders.service.ts:217-218` *(unverified)* | Tax post-discount: `discountRatio = discount / totalAmount`. If `totalAmount=0`, ratio = `NaN`, taxAmount = `NaN`. Guard for zero. |
| M7 | High | Cor | `backend/src/modules/delivery-platforms/services/delivery-order.service.ts:118-121` *(unverified)* | `totalAmount`/`finalAmount` come straight from the platform payload — no cross-check vs sum of items. A platform-side bug or compromise could silently overcharge customers. Assert `sum(items) ≈ totalAmount` within tolerance and alert on mismatch. |
| M8 | High | Sec | `backend/src/modules/accounting/services/accounting-sync.service.ts:116-140` **VERIFIED** | `getCredentials()` reads `settings.parasutClientSecret`, `settings.parasutPassword`, `settings.logoPassword`, `settings.foribaPassword` directly off the AccountingSettings record. The `integrations` module already has an `encryptJson` helper at `backend/src/common/helpers/encryption.helper.ts:43`; AccountingSettings appears to bypass it. Verify whether these columns are stored encrypted or in plaintext, and apply the same encryption + redaction model used by `integrations`. |
| M9 | High | Cor | subscription renewal — `backend/src/modules/subscriptions/services/subscription-scheduler.service.ts:90-97` *(unverified)* | No `externalReference`-style idempotency key on the renewal write. If the cron fires while a previous tick is still finishing, or if a retry hits the same subscription, two renewal records can be created. |
| M10 | High | Cor | `backend/src/modules/orders/services/payments.service.ts:412-533` *(unverified)* | Split-bill writes don't accept a client-supplied idempotency key. Network retry from a flaky client = duplicate payment. |

### Auth & token model

| ID | Sev | Dim | Where | Finding |
|---|---|---|---|---|
| A1 | High | Cor | `backend/src/modules/auth/strategies/jwt.strategy.ts:36-74` *(unverified)* | `tokenVersion` check is purely against the JWT claim; there's no DB lookup per-request. After a password reset in another tab, the old token can still validate for the remaining JWT TTL window. Document the trade-off (perf vs revocation latency) — this is intentional in many systems. If revocation must be immediate, switch to a per-request DB check or short-lived access tokens with always-on rotation. |
| A3 | High | Sec | `backend/src/modules/superadmin/services/superadmin-auth.service.ts:188-199` *(unverified)* | Failed-login counter resets on *any* successful password match, including before 2FA succeeds. Reset only after the full 2FA flow completes. |
| A4 | High | Sec | `superadmin-auth.service.ts:476-480` *(unverified)* | `regenerateBackupCodes` calls `verifyTotp` without first checking that `twoFactorSecret` exists. If null, `verifyTotp` returns false but the surrounding flow may still mint codes. Add explicit `if (!twoFactorSecret) throw BadRequest`. |
| A5 | Medium | Sec | `backend/src/modules/auth/auth.service.ts:232` *(unverified)* | New ADMIN registration auto-activates the user; `tenant.status` is not validated. A suspended tenant's ADMIN can still log in. Add `if (tenant.status !== ACTIVE) throw` in `validateUser`. |

> **A2 (password-reset token race) — dropped.** Verified at `auth.service.ts:691-721`: the code already uses the recommended atomic-consume pattern (`updateMany` filtered by `resetTokenHash`, reject on `count === 0`, all in a `$transaction` that also revokes refresh tokens). Source includes a comment explicitly explaining the race window it closes. See §11.1.

> ⚠ **Spot-check note (dropped):** an agent flagged `auth.controller.ts:120-122` as accepting a refresh token from a JSON body. Verified at the source — `refresh()` reads from `req.cookies?.[REFRESH_COOKIE]` only (`auth.controller.ts:106`); there is no JSON-body fallback. **Drop.**

### Multi-tenant isolation & schema

| ID | Sev | Dim | Where | Finding |
|---|---|---|---|---|
| T1 | Medium | Perf | `backend/prisma/schema.prisma` (StockMovement) **VERIFIED** | StockMovement has `@@index([tenantId])`, `@@index([productId])`, `@@index([userId])` — but no compound `(tenantId, createdAt)`. Date-range filters per tenant fall back to filtering after a single-column index lookup. Add `@@index([tenantId, createdAt])` for hot list queries. (Severity downgraded from High after verifying the single-column tenantId index exists.) |
| T2 | High | Cor | `backend/prisma/schema.prisma` (IngredientMovement, ~line 2264) *(unverified)* | Scoped only via `stockItem.tenantId` FK chain — no direct `tenantId` column. If `stockItem` is hard-deleted, movements orphan but remain queryable. Add direct `tenantId` for defense-in-depth. |
| T3 | High | Cor | `backend/prisma/schema.prisma` (WaiterRequest, BillRequest, ~line 1419-1449) *(unverified)* | Same pattern: scoped via `table.tenantId`, no direct column. Tenant-scoped query helpers can miss them. Add `tenantId` + `@@index([tenantId])`. |
| T4 | Low | Sec | `backend/src/modules/tenants/tenants.controller.ts:43, 54` **VERIFIED** | `findSettings` / `updateSettings` pass `req.tenantId` to the service. The handler is gated by `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)` which sets `req.tenantId`, so under the current wiring this is safe. Defense-in-depth only: an explicit `if (!req.tenantId) throw Forbidden` would catch a future refactor that breaks the guard ordering. (Downgraded from High after verifying the guard chain.) |
| T5 | High | Sec | `backend/src/modules/tenants/tenants.service.ts:91-149` *(unverified)* | Subdomain change reads `tenant.currentPlan.customBranding`. `currentPlan` can be null (FK is `SetNull`) → NPE → 500 instead of 403. Guard for null plan. |

### Frontend & landing

| ID | Sev | Dim | Where | Finding |
|---|---|---|---|---|
| F1 | High | Sec | `landing/next.config.ts:23-40` **VERIFIED** | No `Content-Security-Policy` header. X-Frame-Options/X-Content-Type-Options are set, but a CSP would close the next layer of XSS defense. Add a baseline CSP (start with `default-src 'self'; script-src 'self' 'unsafe-inline'` and tighten). |
| F2 | High | Cor | `frontend/src/components/ProtectedRoute.tsx:10-26` *(unverified)* | On page reload, `isAuthenticated` rehydrates from persisted state but `accessToken` does not (memory-only — correct). Children render briefly with no token, the first request 401s, refresh kicks in. Functionally fine, but causes a flicker and double-fetch. Block render until profile/refresh resolves. |
| F3 | Medium | Cor | `frontend/src/lib/api.ts:42-57` *(unverified)* | `refreshInFlight` has no timeout. If `/auth/refresh` hangs, every queued request blocks indefinitely. Wrap in `Promise.race` with a 10s timeout. |
| F4 | Medium | Cor | `frontend/src/components/ErrorBoundary.tsx:36-50` *(unverified)* | Async/Promise rejections aren't caught by the error boundary. Add `window.addEventListener('unhandledrejection', ...)` in `main.tsx` forwarding to Sentry. |

---

## 3. Cross-cutting observations

### 3.1 Multi-tenant isolation
- **Pattern:** middleware → `req.tenantId` → service queries filter by it. 843 `tenantId` references across modules; well-adopted.
- **Gaps:** controllers occasionally trust `req.tenantId` without nullity check (T4); a few tenant-scoped tables have no direct `tenantId` column (T2, T3); compound `(tenantId, X)` indices missing on several hot tables (T1).
- **Suggested invariants test:** add a backend integration test that creates two tenants, attempts cross-tenant reads via every list/find endpoint, and asserts 0 leaks. This would have caught past regressions and protects future ones.

### 3.2 Auth & token model
- **Access tokens:** memory-only on frontend (verified — no `localStorage` writes for tokens; only `i18n_language`). Refresh tokens: httpOnly cookie. XSS exfiltration surface is minimized.
- **Three frontend auth stores** (`authStore`, `marketingAuthStore`, `superAdminAuthStore`) follow the same memory-only pattern and share types. Not duplicated logic — the actual refresh runs in `lib/api.ts`. Healthy split.
- **Refresh rotation:** correctly wired through `lib/api.ts` interceptor and `lib/socket.ts` token replay. The Axios refresh has no timeout (F3).
- **Revocation:** JWT `tokenVersion` check is per-claim, not per-DB-lookup (A1). Acceptable trade-off for performance, but document the revocation latency.

### 3.3 Scheduler / cron reliability
Verified pattern across all 5 schedulers (subscriptions, z-reports, stock-alerts, order-polling, token-refresh):
```ts
const lockId = djb2('<scheduler-name>');  // constant string
const [{ locked }] = await this.prisma.$queryRawUnsafe(
  `SELECT pg_try_advisory_lock(${lockId}) AS locked`
);
if (!locked) return;
try { /* work */ } finally {
  await this.prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${lockId})`);
}
```
- **Multi-instance safe:** ✅ `lockId` is hashed from a constant; no user input.
- **`$queryRawUnsafe` is safe here:** the interpolated value is a numeric hash, not user input. (Still, switching to `$queryRaw` with a tagged template would remove the "Unsafe" designation and make linting happy.)
- **One race to fix:** `delivery-platforms/schedulers/order-polling.scheduler.ts:36-60` *(unverified)* keeps a local `isRunning` flag *outside* the lock try/finally — if the lock holder crashes, the flag remains true on that replica. Drop the flag and rely on the advisory lock alone.

### 3.4 Database schema audit (`prisma/schema.prisma`, 87 models)
- **Cascade/restrict choices** are mostly sensible, but a few cause foot-guns: `Tenant.currentPlan` uses `onDelete: SetNull` (~line 87) — a deleted plan leaves tenants with `currentPlan=null`, which downstream code dereferences (T5). Switch to `Restrict` and force plan reassignment first.
- **Soft-delete inconsistency:** Tenant/User use `status='DELETED'`, products/categories cascade-delete. Pick one. Recommend adding `deletedAt` to all tenant-scoped models and filtering it in repository helpers.
- **Compound indices missing on hot query patterns** (T1).
- **Tables without direct `tenantId`** (T2, T3) — fix during the next migration window.

### 3.5 WebSocket gateways
| Gateway | JWT verified | Type-checked | Tenant-scoped rooms | Notes |
|---|---|---|---|---|
| `kds.gateway.ts` | ✅ | ✅ (rejects `marketing`/`superadmin`) | ✅ | Excellent; dual staff+customer auth, role-based rooms. |
| `notifications` | ✅ | ❌ | ✅ | Add a `payload.type === 'user'` check for parity with KDS. Low risk, non-sensitive data. |
| `analytics` | ✅ | ❌ | ✅ (`analytics-{tenantId}`) | Same recommendation as notifications. Heatmap upsert can do up to 1600 rows/tick — cap or batch. |

### 3.6 Webhook signature verification
Verified at `backend/src/modules/delivery-platforms/guards/webhook-auth.guard.ts:34-52`:
- **Yemeksepeti:** HMAC-SHA512 (JWT-style) with timing-safe compare. ✅
- **Trendyol:** HMAC-SHA256 + 5-min timestamp anti-replay window. ✅
- **Getir / Migros:** **polling platforms** (see `constants/platform-status-map.ts:42`: `POLLING_PLATFORMS = ['GETIR', 'MIGROS', 'TRENDYOL']`) — they don't have webhook routes, so there's nothing to sign. (Trendyol uses both modes.)
- **Default branch fails closed** (`throw UnauthorizedException` for any unrecognized `@WebhookPlatform`).

> ⚠ **Spot-check note (dropped):** an agent flagged Getir/Migros webhooks as missing signature verification. Verified — those platforms use polling, not webhooks. **Drop.**

**Subscription webhooks (Stripe / Iyzico / PayTR):** appear absent from the codebase — system seems to use scheduler-driven manual renewal. If you start receiving real webhooks (e.g., for failed-charge events), this is the highest-leverage gap to fix; that controller will need both signature verification *and* idempotency on the event-id.

### 3.7 Logging & observability
- Sentry wired on backend, frontend, and landing. Frontend `sentry.config.ts:40-64` redacts `password`, `token`, `apiKey`, `secret`, `authorization` from breadcrumbs and strips browser context. Landing `sentry.server.config.ts` strips `authorization` / `cookie` / `x-api-key`. Good.
- Source maps hidden from the public client (landing `next.config.ts:62`, `hideSourceMaps: true`) and uploaded only to Sentry. ✅
- Backend has 6 `console.log` and 23 `console.warn`/`console.error` calls — small, but worth replacing with the NestJS `Logger` so log levels can be tuned per env.

### 3.8 Test coverage gaps
- Backend: **13 spec files** (mix of `*.spec.ts` and one or two e2e). For ~50k LOC this is *very* light. Auth, payments, orders, subscriptions, webhooks have minimal-to-no automated coverage. **The single highest-leverage hardening investment is integration tests for the money paths.**
- Frontend: **1 test file** (`ErrorBoundary.spec.tsx`). No tests for `lib/api`, `lib/socket`, auth stores, ProtectedRoute, payment UI, or any feature.
- Landing: **0 tests.** Acceptable given it's mostly static, but a smoke test for the `/api/health` route and a snapshot for the layout would help.

### 3.9 Public endpoints inventory (`@Public()`)
~40 endpoints across:
- `auth` (login, register, refresh, OAuth, password reset) — expected.
- `desktop-app` (release manifest endpoints, gated by `ApiKeyGuard`) — verify the API-key check is enforced everywhere it should be.
- `public-stats`, `qr-menu`, `customer-orders`, `tenants/by-subdomain`, `tables` (1 endpoint), `contact`, `subscriptions/plans`, `delivery-webhook` (gated by `WebhookAuthGuard`), `reservations/public-*`.

All look intentional from the names. Two things to confirm by hand: (a) every `@Public()` endpoint that *should* be rate-limited has a `@Throttle` decorator (most do — verified on webhooks, public-stats); (b) `/desktop-app` truly enforces `ApiKeyGuard` and not just the `@Public()` skip of the JWT guard.

---

## 4. Backend per-module reports

### 4.1 `common/`  ·  Health: 🟡 yellow

The security boundary. Guards, middleware, decorators, exception filters, helpers (incl. `encryption.helper.ts`), pagination utilities. Mostly well-shaped.

| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Medium | Sec | `main.ts:49-55` *(unverified)* | `TRUST_PROXY` parsing accepts any string verbatim; an invalid CIDR silently turns into "trust everything". | Validate against `^\d+$|^[\d.]+\/\d+$` before passing to Express. |
| Medium | Perf | `common/middleware/request-logger.middleware.ts:64` and exception filter *(unverified)* | Request ID generated twice (middleware + filter). They don't correlate if the filter generates its own. | Generate once in middleware, attach to request, reuse in filter. |
| Medium | Sec | `auth.service.ts` Sentry tags using email/IP *(unverified)* | PII in telemetry tags. | Hash userId; drop email/IP from tags. |
| Info | Sec | `common/helpers/encryption.helper.ts:43` (`encryptJson`) **VERIFIED** | Encryption helper exists and is used by `integrations` module. Confirm AccountingSettings adopts it (M8). | n/a |

### 4.2 `auth/`  ·  Health: 🟢 green
24 files. Token lifecycle (refresh rotation, password-reset atomic consume, refresh-token revocation) is **solid** — verified at `auth.service.ts:691-721`. Remaining sharp edges are around 2FA boundaries (handled in `superadmin/`), suspended-tenant validation, and async error swallowing on email send.

| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| High | Cor | A1 above | jwt revision via claim only; revocation latency = JWT TTL | see Critical & High table |
| Medium | Sec | A5 above | suspended tenant ADMIN can log in | guard tenant status |
| Medium | Cor | `auth.service.ts:256-262` *(unverified)* | `sendEmailVerification` swallows exceptions; user gets 200 even when email never sent. | Re-throw on send failure or surface as 5xx. |
| Medium | Arch | `auth/guards/api-key.guard.ts:46-48` *(unverified)* | Both `X-API-KEY` and `API-KEY` headers accepted with no documented reason. | Pick one canonical header. |
| Low | Perf | `auth.service.ts:401-414` *(unverified)* | `validateUser` selects full user record; only password+id needed for compare. | Sparse `select`. |

> ⚠ **Spot-check note (dropped):** "refresh in JSON body" — false positive (verified at `auth.controller.ts:106`).

### 4.3 `tenants/`  ·  Health: 🟢 green
4 files on the critical isolation path. Verified at `tenants.controller.ts`: handlers are gated by `JwtAuthGuard + TenantGuard + RolesGuard`, so `req.tenantId` is always populated. The remaining concerns are defense-in-depth.

T4, T5 above. Plus:
| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Medium | Arch | `tenants.service.ts:123-138` *(unverified)* | Subdomain reservation row not cleaned up if the surrounding TX rolls back. | Move reservation to a post-commit hook or saga. |

### 4.4 `superadmin/`  ·  Health: 🟡 yellow
29 files. TOTP and backup-code mechanics are well-implemented; the gaps are in the surrounding state-machine.

A3, A4 above. Plus:
| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| High | Cor | `superadmin-auth.service.ts:527-548` *(unverified)* | Two refresh requests can race and both succeed because `payload.ver` check vs new `ver` write is not atomic. | Move to a `$transaction` with `FOR UPDATE` on the superAdmin row. |
| Medium | Sec | `superadmin-auth.controller.ts:44-49` *(unverified)* | `tempToken` written to audit log in plaintext. | Log action + correlation id, not the secret. |
| Medium | Arch | `superadmin-auth.service.ts:597-642` *(unverified)* | `createInitialSuperAdmin` race between concurrent seed scripts. | Use `UPSERT ... ON CONFLICT` or advisory lock. |

### 4.5 `subscriptions/`  ·  Health: 🟡 yellow
20 files. Renewal/PAST_DUE state machine is sound; advisory locks across 6 cron jobs are correct.

| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| High | Cor | M9 above | Renewal not idempotent on the renewal-write side | Add `externalReference` or composite unique key on `(subscriptionId, periodStart)`. |
| Medium | Cor | `services/billing.service.ts:73` *(unverified)* | `dueDate: new Date()` — should be `periodEnd` or tenant `defaultPaymentTermDays`. | Mirror the pattern used in `sales-invoice.service.ts:84-86`. |
| Medium | Arch | `services/subscription-scheduler.service.ts:44-54` *(unverified)* | DJB2-hashed lock IDs work for 6 jobs; not a defect, just brittle as the count grows. | Switch to named pg advisory locks or a lock-id registry. |
| Low | Perf | `subscription.service.ts:44, 62` *(unverified)* | `getCurrentSubscription()` always includes last-5 payments. | Cache or lazy-load. |

### 4.6 `orders/`  ·  Health: 🟡 yellow
11 files; `orders.service.ts` is ~1136 LOC — the biggest service in the codebase.

M1, M2, M5, M6, M10 above. Plus:
| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| High | Cor | `payments.service.ts:373-378` *(unverified)* | Refund subtraction guards `>= 0` but doesn't alert when `refundAmount > totalSpent` — which would indicate corrupt state. | Assert and emit a Sentry-level error on the anomaly before clamping. |
| Medium | Cor | `payments.service.ts:112-124` *(unverified)* | 1-cent overage tolerance allowed without explanation. | Document why; sunset the tolerance once all clients use Decimal. |
| Medium | Arch | `orders.service.ts` size | 1136 LOC service bundles lifecycle + payments + KDS events + delivery. | Extract `OrderPaymentHandler` and `OrderDeliveryHandler`. |
| Low | Perf | `getGroupBillSummary:554-593` *(unverified)* | N+1 flatMap, no `take`. | Paginate items; cap to 1000. |

> ⚠ **Spot-check note (dropped):** "Critical: refund auth bypass at `payments.service.ts:325-330`" — verified at `payments.service.ts:317-330`. The `if (!payment) throw NotFoundException` correctly fires *before* the tenant check; the tenant check at line 330 only runs once `payment` is non-null. **Drop.**

### 4.7 `accounting/`  ·  Health: 🔴 red
14 files. Three high-severity items concentrated here.

M3, M4, M8 above. Plus:
| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Medium | Cor | `sales-invoice.service.ts:36-49` *(unverified)* | Invoice tax is read off `orderItem.taxRate` (frozen at order time). If `product.taxRate` changes between order and invoice, audit drift. | Document the freeze; add a note in the OrderItem comment. |
| Medium | Cor | `sales-invoice.service.ts:43` *(unverified)* | Back-calculates `unitPrice` by dividing — divide-by-zero if `quantity===0`. | Guard early. |

### 4.8 `delivery-platforms/`  ·  Health: 🟡 yellow
25 files; webhook-auth guard is verified solid for the two platforms that use webhooks.

M7 above. Plus:
| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| High | Cor | `schedulers/order-polling.scheduler.ts:36-60` *(unverified)* | Local `isRunning` flag outside lock try/finally — stuck-true if lock holder crashes. | Remove the flag; pg_advisory_lock alone is sufficient. |
| Medium | Cor | `services/delivery-order.service.ts:43-56, 200-210` *(unverified)* | Duplicate webhook returns `null` silently, caller can't tell if it was created or skipped. | Return `{ created: bool, orderId }`. |
| Medium | Cor | `services/delivery-order.service.ts:77-95` *(unverified)* | Unmapped items still let the order proceed at platform-claimed total. | Force `requiresApproval=true` if any item is unmapped. |
| Medium | Arch | `services/delivery-order.service.ts:96-97` *(unverified)* | PII logged before adapter validation. | Move `scrubPii` earlier; never log raw body on parse failure. |

### 4.9 `z-reports/`  ·  Health: 🟡 yellow
6 files. Finalization is tamper-evident (payload hash + conditional `updateMany`), but a few edges around report numbering and net-sales sourcing.

| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| High | Cor | `services/z-reports.service.ts:213` *(unverified)* | `expectedCash` math assumes positive balance and ignores negative-cash-day edge. | Allow negative values or reject early with a clearer message. |
| Medium | Cor | `services/z-reports.service.ts:86-112` *(unverified)* | Net-sales counted from both order *and* payment sides — double-count risk if state mismatched. | Single source of truth (payments) with assertion that order status matches. |
| Medium | Arch | `services/z-reports.service.ts:270` *(unverified)* | Day-scoped `reportNumber` collides if 2 reports close same day. | Sequence per-day: `Z-YYYYMMDD-NNN`. |
| Medium | Cor | `services/z-reports.service.ts:486-536` *(unverified)* | `computePayloadHash` uses `Decimal.toString()` — format may drift (`"10"` vs `"10.00"`). | Normalize via `toFixed(2)` before hashing. |

### 4.10 `upload/`  ·  Health: 🟢 green
4 files. MIME pre-filter + `sharp.metadata()` magic-byte sniff is solid defense-in-depth.

| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Low | Perf | `upload.service.ts:104-173` *(unverified)* | Sharp resize is synchronous on the request path (1-2s for large images). | Add timeout cap; offload to a queue if upload concurrency rises. |

### 4.11 `stock-management/`  ·  Health: 🟢 green
39 files; the largest single module. Advisory-lock pattern correctly applied.

| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Medium | Cor | `services/stock-alerts.service.ts:47-82` *(unverified)* | Alert emitted on every cron tick if state unchanged → alert fatigue. | Track `last-alert-sent` per batch; emit only on state transitions. |
| Medium | Perf | `services/stock-alerts.service.ts:16-44` *(unverified)* | Unbounded raw query for low-stock items on every tick. | Add `LIMIT 100` + paginate. |
| Medium | Perf | `services/stock-items.service.ts:12-36` *(unverified)* | `findAll` without `take/skip`. | Default `take: 100`, allow client `limit` clamped to [1, 500]. |

### 4.12 `settings/integrations/`  ·  Health: 🟢 green
Encryption + redaction are exemplary — `encryptJson` for storage, `***REDACTED***` on HTTP responses, plaintext only via `findOneWithSecrets` for adapters. **This module is the template the accounting module should follow** (see M8).

### 4.13 `notifications/` gateway  ·  Health: 🟢 green
| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Medium | Sec | `notifications.gateway.ts:32, 50-51` *(unverified)* | JWT verified; rooms scoped by `tenantId`. Lacks the `type === 'user'` check that `kds.gateway.ts` does. | Add the type-check for parity. |

### 4.14 `kds/` gateway  ·  Health: 🟢 green
Dual auth (staff JWT + customer session DB lookup), strict `type` check, mutually exclusive room sets, reconnect debounce. Cleanest gateway in the project.

| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Low | Sec | `kds.gateway.ts:64-143` *(unverified)* | `tryStaffAuth` logs failed JWT but doesn't rate-limit token spam. | Per-IP attempt counter on the handshake. |

### 4.15 `analytics/` gateway + services  ·  Health: 🟢 green
Tenant isolation enforced; high-volume occupancy + traffic-flow upserts.

| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Medium | Sec | `analytics/gateways/analytics.gateway.ts` *(unverified)* | Same `type === 'user'` check missing as notifications. | Add it. |
| Medium | Perf | `analytics.gateway.ts:252, 308-355` *(unverified)* | `traffic-flow` upserts can hit 1600 rows/tick (40×40 grid). | Cap batch size; queue overflow. |
| Medium | Perf | `analytics/services/heatmap.service.ts:70-83` *(unverified)* | Unbounded `findMany` on `occupancyRecord`. | Add `take`; warn if range too large; ensure `(tenantId, timestamp)` index. |

### 4.16 `customers/` + sms-providers  ·  Health: 🟢 green
| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| (none above Low) | | `customers/loyalty.service.ts:50-80` *(unverified)* | Loyalty redemption uses Serializable `$transaction` with conditional `updateMany` — race-free. **Highlight as a pattern to replicate.** | n/a |

### 4.17 `marketing/`  ·  Health: 🟢 green
53 files / ~3600 LOC; large but well-structured. SALES_REP role check on offers is enforced. No critical findings.

| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Medium | Arch | aggregate size *(unverified)* | `marketing-leads.service.ts` ≈ 586 LOC. | Consider splitting into lead-scoring / conversion-tracking / funnel-analytics. |

### 4.18 `personnel/`, `reservations/`, `reports/`, `users/`, `sms-settings/`, `menu/`, `customer-orders/`  ·  Health: 🟢 green
No critical/high findings beyond a few pagination omissions noted under §4.11.

### 4.19 Low-risk (one-line verdicts)
`modifiers`, `public-stats`, `pos-settings`, `qr`, `layouts`, `tables`, `stock`, `contact`, `desktop-app` — scanned, no significant findings. `desktop-app` retains explicit comment about deliberate `@Public()` + `ApiKeyGuard` co-application; verify the ApiKeyGuard truly fires on those routes during a smoke test.

### 4.20 `prisma/schema.prisma`  ·  Health: 🟡 yellow
T1, T2, T3 above. Plus:
| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Medium | Cor | `Tenant.currentPlan` (~line 87) *(unverified)* | `onDelete: SetNull` — leaves dangling refs in code that dereferences `currentPlan`. | Switch to `Restrict`; require reassignment before deletion. |
| Medium | Cor | `Order.user` (~line 666) *(unverified)* | `onDelete: Restrict` blocks user retirement. | Switch to `SetNull`. |
| Medium | Arch | n/a | Soft-delete inconsistency across models. | Standardize on `deletedAt DateTime?` and a repository helper. |

---

## 5. Frontend per-module reports (`frontend/src/`)

### 5.1 `lib/`  ·  Health: 🟢 green
F3 above. Token rotation in `lib/socket.ts` (verified working — subscribes to `useAuthStore.accessToken`, disconnects + reconnects with new token). `lib/env.ts` falls back to `localhost` in prod silently — log noisily or fail loud.

### 5.2 `store/`  ·  Health: 🟢 green
Three auth stores follow the same memory-only token pattern. `superAdminAuthStore` correctly persists the short-lived `accessToken` but **not** the refresh token (with an explicit comment justifying the trade-off). `cartStore` persists non-auth data only. No findings.

| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Medium | Arch | `superAdminAuthStore.ts:9, 17, 47-52` *(unverified)* | `tempToken` + `requires2FA` + `requires2FASetup` flags duplicate state. | Replace with a single state enum: `NEEDS_2FA_ENTRY | NEEDS_2FA_SETUP | AUTHENTICATED`. |

### 5.3 `components/ProtectedRoute.tsx` + `ErrorBoundary.tsx` + `sentry.config.ts`  ·  Health: 🟢 green
F2, F4 above. Sentry config redaction verified. No `dangerouslySetInnerHTML`, no `innerHTML` writes, no `eval`/`new Function` anywhere in `frontend/src` or `landing/src`.

### 5.4 `App.tsx` + route wiring  ·  Health: 🟢 green
Lazy-loaded routes for superadmin/marketing/admin/QR-menu/settings. `FloorPlan3DPage` (the voxel-world entry) is gated by `import.meta.env.DEV` and lazy-loaded — confirmed not in the prod bundle. **DashboardPage and POSPage are eagerly imported.** Profile their bundle size; lazy-load if either > ~100kb.

### 5.5 `pages/auth`, `pages/subscription`, `pages/superadmin`  ·  Health: 🟢 green
| Sev | Dim | Location | Finding | Fix |
|---|---|---|---|---|
| Medium | Sec | `pages/auth/LoginPage.tsx:66-78` *(unverified)* | `useGoogleLogin({ flow: 'implicit' })`. Modern OAuth recommends `auth-code` (PKCE). | Verify the backend exchanges the Google access token server-side; if it just trusts the client-side ID token, switch to code flow. |

### 5.6 Features (`onboarding`, `marketing`, `stock-management`, `analytics`)  ·  Health: 🟢 green
Modular structure (per-feature `api/`, `components/`, `types/`). No security/correctness flags on a spot-check.

### 5.7 `voxel-world/` (139 files)  ·  Health: 🟢 green
Architectural verdict only — not a per-file review:
- Entry: `frontend/src/features/voxel-world/index.ts`.
- Lazy-loaded via `import()` from `FloorPlan3DPage`, which itself is dev-only-conditional.
- Production bundle does not include three.js / shader code.
- No findings.

### 5.8 Hooks, UI primitives, contexts  ·  Health: 🟢 green
13 hooks (formatting/i18n/responsive). 19 UI primitives (no XSS surface). `SubscriptionContext` provides `hasFeature()` / `checkLimit()` helpers — well-shaped. No findings.

### 5.9 Cross-cutting frontend
- 2 `target="_blank"` without `rel="noopener noreferrer"` — `pages/settings/SubscriptionSettingsPage.tsx:342`, `components/qr-menu/MenuDrawer.tsx:372`. Low-risk reverse-tabnabbing. Add `rel="noopener noreferrer"`.
- `localStorage` writes are limited to `i18n_language` (verified — no token leakage).

---

## 6. Landing per-module report (`landing/`)

### 6.1 `next.config.ts`  ·  Health: 🟡 yellow
F1 above. Source maps hidden, X-Frame-Options + X-Content-Type-Options set, but no CSP. Add CSP.

### 6.2 `src/lib/api.ts`, `middleware.ts` (i18n), Sentry configs, `app/global-error.tsx`, `app/api/health/route.ts`, `app/[locale]/layout.tsx`  ·  Health: 🟢 green
- `getPlans()` uses ISR (`revalidate: 300`) and falls back to `[]` on error — graceful.
- next-intl middleware correctly excludes `_next` and static assets.
- Sentry server config strips `authorization` / `cookie` / `x-api-key`.
- `global-error.tsx` captures to Sentry, dev shows details, prod shows generic message.

No findings beyond the missing CSP.

---

## 7. Recommended action plan

Effort tiers: XS (<1h) · S (~half day) · M (~day) · L (multi-day).

### P0 — Do first (this week)
| ID | Effort | Action |
|---|---|---|
| M8 | M | Audit AccountingSettings columns. Either confirm they're already encrypted at rest, or migrate them to `encryptJson` + redact-on-response, mirroring the `integrations` module. Rotate all stored credentials after migration. |
| M9, M10 | M | Add idempotency keys (composite unique index or `externalReference`) for subscription renewal and split-bill writes. |
| M3 | S | Wrap `getNextInvoiceNumber()` in a transaction + row-level lock or move to atomic `RETURNING UPDATE`. |
| F1 | XS | Add a starter Content-Security-Policy header to `landing/next.config.ts`. |

### P1 — This sprint
| ID | Effort | Action |
|---|---|---|
| M1, M2 | S | Replace JS `Number` with `Prisma.Decimal` in payments comparisons & split-bill tolerance. |
| M5 | S | Replace fire-and-forget invoice generation with bounded retry + explicit `REVENUE_SYNC_FAILED` Sentry event. |
| M6 | XS | Guard `totalAmount === 0` in tax/discount math. |
| M7 | S | Cross-validate platform-supplied totals vs item sums on inbound delivery webhooks. |
| A3, A4 | S | Tighten 2FA boundary in `superadmin-auth.service.ts` (counter reset + secret existence guard). |
| T5 | S | Null-guard for `currentPlan` in subdomain-change flow. |
| F2 | S | Add loading state to `ProtectedRoute` so children don't render before access token is available. |
| F3 | XS | Add 10s timeout to refresh promise in `lib/api.ts`. |
| F4 | XS | Add global `unhandledrejection` listener in `main.tsx`. |
| (notifications/analytics gateways) | XS | Add `payload.type === 'user'` check for parity with KDS gateway. |

### P2 — Next sprint
| ID | Effort | Action |
|---|---|---|
| T1, T2, T3 | M | Schema migration: add direct `tenantId` to `WaiterRequest`, `BillRequest`, `IngredientMovement`; add compound `(tenantId, createdAt)` index to `StockMovement` and similar hot tables. |
| T4 | XS | Optional defensive `if (!req.tenantId) throw Forbidden` in `tenants.controller.ts` — protects against a future refactor of the guard chain. |
| (schema) | S | Switch `Tenant.currentPlan` to `onDelete: Restrict`; switch `Order.user` to `SetNull`. |
| (z-reports) | S | Sequence-per-day report numbering; normalize Decimal in `computePayloadHash`. |
| (orders) | M | Extract `OrderPaymentHandler` and `OrderDeliveryHandler` from the 1136-LOC `orders.service.ts`. |
| (delivery-platforms) | XS | Drop `isRunning` flag in `order-polling.scheduler.ts`; rely on advisory lock alone. |
| (frontend) | XS | Add `rel="noopener noreferrer"` to two `target="_blank"` sites. |
| (analytics) | S | Cap traffic-flow upsert batch size; bound heatmap `findMany`. |
| (auth) | S | Stop swallowing `sendEmailVerification` errors; surface as 5xx. |
| (frontend Google OAuth) | M | Verify Google OAuth token-exchange path; if implicit-flow data is being trusted, migrate to PKCE. |

### P3 — Backlog / hardening
| ID | Effort | Action |
|---|---|---|
| (tests) | L | **Highest leverage**: add integration tests for auth/payment/order/subscription paths. Today's 13 backend specs is too few for the surface area. Set a coverage floor (e.g., 70% on services in `auth`/`orders`/`payments`/`subscriptions`/`accounting`). |
| (tests) | M | Cross-tenant isolation test suite: create 2 tenants, attempt cross-reads on every list/find endpoint, assert 0 leaks. |
| (frontend tests) | M | Add tests for `lib/api`, `lib/socket`, auth stores, `ProtectedRoute`, payment UI. |
| (schema) | M | Standardize soft-delete (`deletedAt`) across tenant-scoped models. |
| (Stripe/Iyzico/PayTR webhooks) | L | If adopted, add signature-verified controllers with event-id idempotency. |
| (logging) | XS | Replace remaining `console.*` calls with NestJS `Logger`. |
| (auth) | S | Document the JWT `tokenVersion` revocation-latency trade-off (A1) in CLAUDE.md or auth README. |
| (subscriptions) | S | Switch DJB2 lock-id hashing to a named-lock registry as cron count grows. |
| (sentry) | XS | Drop email/IP from auth Sentry tags; use hashed userId. |

---

## 8. What's already excellent (keep doing)

- Multi-tenant isolation enforced widely (843 `tenantId` references).
- Three frontend auth stores all follow memory-only access-token pattern; refresh tokens stay httpOnly.
- All schedulers correctly use pg advisory locks with constant-derived lock IDs.
- KDS WebSocket gateway: dual-auth, strict type-check, role-based rooms, reconnect debounce.
- Webhook signature verification for Yemeksepeti (HMAC-SHA512 + JWT-style, timing-safe) and Trendyol (HMAC-SHA256 + 5-min timestamp anti-replay) — defaults fail closed.
- Sentry redaction on backend, frontend, and landing; source maps hidden in landing prod.
- Loyalty-points redemption uses a Serializable transaction with conditional `updateMany` — race-free pattern worth replicating in other "decrement-if-allowed" flows.
- `settings/integrations` module is the gold standard for credential storage (encrypted at rest, redacted on response, plaintext only via explicit `findOneWithSecrets`).
- Voxel-world feature (139 files) correctly tree-shaken from prod via DEV-conditional lazy-load.

---

## 9. Out of scope this round

- `desktop/` (Tauri/Rust + BLE printer integration)
- `edge-device-cpp/` (NVIDIA Jetson YOLO/TensorRT inference + WebSocket client)
- `segmentation-service/` (Python/FastAPI + SAM2/GroundingDINO — only `requirements.txt` was visible during triage)
- Infra/CI: `docker-compose.*.yml`, `nginx.conf`, `deploy.sh`/`scripts/*`, `.github/workflows/*`

A separate review pass is recommended for these — particularly the C++ edge device (network listener, model loading) and the deploy scripts (secrets handling, backup encryption).

---

## 10. Verification & methodology notes

- The line-numbered findings tagged *(unverified)* come from agent-driven targeted reads. Spot-check 5 random unverified items by opening the cited `file:line` before remediating, especially Critical/High items in the money-path section.
- 3 agent-flagged Critical findings were dropped during my spot-checks (see §11.1 below). Always read the cited code; don't pattern-match on severity tags.
- The "no findings" verdicts on low-risk modules mean "no issue jumped out from the main service file." They are not certifications of cleanliness; full per-file review of those modules is in P3.

---

## 11. Appendix

### 11.1 Dropped findings & severity downgrades (initial agent reports vs. verified source)

Agent-flagged items that the source code does not actually match, or that the source already handles. Recording them so they don't resurface.

**Dropped entirely:**

1. **"Refresh token taken from JSON body" — `auth.controller.ts:120-122`.** Verified at `auth.controller.ts:106`: actual `refresh()` handler reads only `req.cookies?.[REFRESH_COOKIE]`. No JSON-body fallback. (Lines 120-122 belong to a different unrelated handler.)
2. **"Refund auth bypass" — `payments.service.ts:325-330`.** Verified at `payments.service.ts:317-330`: when `payment` is null, line 325-327 throws `NotFoundException` *before* the tenant check. The tenant check at line 330 only runs once `payment` is non-null. Code is correct.
3. **"Getir/Migros webhook signatures unverified" — `webhook-auth.guard.ts:44-52`.** Verified at `delivery-platforms/constants/platform-status-map.ts:42`: Getir and Migros are in `POLLING_PLATFORMS` — they have no webhook routes, so there is nothing to sign. The webhook guard's `default` branch fails closed with `UnauthorizedException` for any unrecognized platform.
4. **A2: "Password-reset token consume race" — `auth.service.ts:691-721`.** Verified at the cited lines: the code already implements the exact atomic-consume pattern that was being recommended. `prisma.user.updateMany` filters by both `id` and `resetTokenHash` and clears `resetTokenHash` to null in the same write; the surrounding `$transaction` also revokes all refresh tokens; if `updateResult.count === 0`, the second-arrival caller is rejected. The source even has a multi-line comment explaining the race window this protects against. **Already correct — no action.**

**Severity downgraded after verification:**

5. **T1: "StockMovement missing compound index"** — confirmed `@@index([tenantId])` exists, just not the compound `(tenantId, createdAt)`. Downgraded High → Medium (Perf).
6. **T4: "tenants.controller.ts trusts req.tenantId"** — confirmed the controller is gated by `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)`, which always populates `req.tenantId`. Downgraded High → Low (defense-in-depth only).

**Pattern note:** of 8 unverified findings I spot-checked end-to-end, 3 turned out to be already-handled in code adjacent to (but not included in) the agent's read window, and 2 needed severity downgrades. This roughly mirrors the recent security-audit commit (`149604d`) — many sharp edges have already been smoothed and the surrounding context (transactions, guard chains, type checks) often makes a flagged "race" or "bypass" actually safe. **Always read the cited code before remediating an unverified finding.**

### 11.2 Cross-cutting grep snapshot (run 2026-04-27)

| Check | Result |
|---|---|
| `dangerouslySetInnerHTML` / direct `.innerHTML =` | 0 matches in `frontend/src` and `landing/src` |
| `eval(` / `new Function(` | 0 matches anywhere |
| `localStorage.*Item` writes | only `i18n_language` (no tokens) |
| `process.env.NODE_ENV` in frontend | only `ErrorBoundary.tsx:126` (dev-only details) |
| `target="_blank"` without `rel="noopener"` | 2 (`SubscriptionSettingsPage.tsx:342`, `MenuDrawer.tsx:372`) |
| `console.log/debug/info` in backend | 6 |
| `console.error/warn` in backend | 23 |
| `$queryRaw*` | 9 sites — all advisory-lock helpers with constant lock IDs |
| `@Public()` endpoints | ~40, all intentional names; webhooks gated by `WebhookAuthGuard` |
| Cron schedulers (`@Cron`) | 9 jobs across 5 modules |
| Backend test files (`*.spec.ts`/`*.e2e-spec.ts`) | 13 |
| Frontend test files | 1 (`ErrorBoundary.spec.tsx`) |
| Landing test files | 0 |
| Prisma models | 87 |
| `tenantId` references in backend `modules/` | 843 |

---

*End of review. For follow-up sessions, work top-down through §7 (P0 → P3). Each P0/P1 item references a finding ID (M-/A-/T-/F-) traceable back to its per-module section.*
