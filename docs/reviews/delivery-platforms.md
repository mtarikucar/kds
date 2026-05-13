# `delivery-platforms` — Deep Review (2026-05-11)

**Tier:** 1
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/delivery-platforms/...`, `backend/prisma/schema.prisma` (DeliveryPlatformConfig / DeliveryPlatformLog / MenuItemMapping / Order)
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — M7 (§2), §3.6 (webhook signatures), §4.8 (per-module table)

---

## 1. Health & summary

🟡 yellow

This module owns the **inbound order pipeline** from Yemeksepeti, Trendyol, Getir, and Migros: webhook+polling intake → normalization → item mapping → KDS order creation → status fan-out → token refresh → menu sync. The security baseline is **strong** (credentials/tokens are AES-GCM encrypted at rest via `encryption.helper.ts`, webhook signatures are HMAC-verified with timing-safe compare, advisory locks gate both schedulers, a partial unique index closes the webhook-race door at the DB layer). The risk concentrates entirely on the **money + business-logic boundary** inside `delivery-order.service.ts`: platform-supplied totals are written through unchecked, unmapped items don't block auto-accept, and the deduplication path returns an ambiguous `null`. Two `(unverified)` findings from §4.8 of the prior round were spot-checked here — one (the `isRunning` flag race) turned out to be **wrong** and is downgraded; the others stand. No "do not deploy" findings.

---

## 2. Scope of this review

**Read end-to-end:**
- `services/delivery-order.service.ts` (279 LOC) — the inbound pipeline; contains M7
- `services/delivery-auth.service.ts` (102 LOC) — token refresh + ensureValidToken
- `services/delivery-config.service.ts` (287 LOC) — config CRUD, encryption, circuit breaker
- `services/delivery-log.service.ts` (146 LOC) — log writes, PII scrub, retry bookkeeping
- `services/delivery-status-sync.service.ts` (104 LOC) — outbound status writes
- `services/delivery-menu-sync.service.ts` (196 LOC) — menu push + mapping CRUD
- `schedulers/order-polling.scheduler.ts` (158 LOC) — 15s polling cron
- `schedulers/token-refresh.scheduler.ts` (49 LOC) — 5m token refresh cron
- `schedulers/retry.scheduler.ts` (111 LOC) — failed-op replay
- `adapters/base.adapter.ts` (76 LOC) — retry-after / exponential backoff
- `adapters/getir.adapter.ts` (189 LOC) — auth + polling + status fan-out
- `adapters/yemeksepeti.adapter.ts` (200 LOC) — webhook parser + OAuth
- `adapters/trendyol.adapter.ts` (238 LOC) — webhook + polling, v1/v2 auth
- `adapters/migros.adapter.ts` (163 LOC) — API-key auth + polling
- `guards/webhook-auth.guard.ts` (142 LOC) — HMAC verification
- `controllers/delivery-webhook.controller.ts` (183 LOC) — public webhook routes
- `controllers/delivery-platforms.controller.ts` (179 LOC) — admin CRUD
- `constants/platform-status-map.ts` (56 LOC) — status mapping tables
- `prisma/schema.prisma` `DeliveryPlatformConfig` / `DeliveryPlatformLog` / `MenuItemMapping` / `Order` (~line 496-2222)

**Skimmed only:**
- `adapters/adapter-factory.ts` — single switch; no logic
- `interfaces/*.ts` — type defs only
- `dto/*.ts` — class-validator DTOs, no business logic

**Skipped:**
- No tests exist in this module (zero `*.spec.ts` files under `delivery-platforms/`) — see §10.

---

## 3. Business-logic invariants

The contract this feature owes, derived by reading the inbound pipeline and the schema together. Each row is testable as an integration assertion.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | A duplicate webhook delivery for the same `(tenantId, platform, externalOrderId)` MUST NOT create a second `Order` row. | `delivery-order.service.ts:44-57` (fast-path findFirst) + `delivery-order.service.ts:199-209` (P2002 catch) + partial unique index `orders_tenant_source_external_uniq` (`prisma/migrations/20260312_add_order_timestamps_and_dedup_index/migration.sql:7-9`) | ❌ none | duplicate KDS tickets, double-fulfilled order, double-charged invoice on auto-payment |
| I-2 | Σ(orderItems.subtotal) ≈ `Order.totalAmount` within ± 0.01 TRY. | **NOT asserted anywhere** — `delivery-order.service.ts:118-121` writes platform-supplied totals; items are computed independently from `item.unitPrice * quantity + modifierTotal` at `delivery-order.service.ts:87`. See M7 in §7. | ❌ none | platform-side bug or compromise can silently overcharge customers; audit drift |
| I-3 | An order with any unmapped platform item MUST require staff approval (`requiresApproval=true`). | **NOT enforced** — `requiresApproval` is derived only from `!autoAccept` at `delivery-order.service.ts:149`. Unmapped items are stored as a free-text note (`delivery-order.service.ts:127-134`) but don't force approval. See F-2 in §7. | ❌ none | order auto-accepted at platform total with no internal line items billable; revenue leakage |
| I-4 | If `autoAccept=true` and at least one item is unmappable, the order MUST still surface in KDS with a clear unmapped-items annotation. | `delivery-order.service.ts:101-106` (logger.warn when all items unmapped) + `delivery-order.service.ts:127-134` (notes built with `[UNMAPPED - needs menu mapping]`) — but the order is still created with `validItems` (possibly empty). | ❌ none | hidden zero-line-item order |
| I-5 | Webhook signatures MUST be verified before parsing — guard runs before controller. | `delivery-webhook.controller.ts:38` (`@UseGuards(WebhookAuthGuard)` at class level) + `webhook-auth.guard.ts:34-52` (fail-closed default branch) | ❌ none | unsigned attacker payload reaches `parseWebhookOrder` and order pipeline |
| I-6 | Trendyol webhook replay window MUST be ≤ 5 minutes. | `webhook-auth.guard.ts:23` constant + `webhook-auth.guard.ts:121-126` — **but the timestamp check is conditional on the header being present** (`if (timestamp)`). See F-9 in §7. | ❌ none | infinite replay if attacker omits the `x-webhook-timestamp` header |
| I-7 | Every `DeliveryPlatformConfig` query MUST be tenant-scoped, except webhook lookups via `(platform, remoteRestaurantId)` which are platform-globally unique. | All admin reads at `delivery-config.service.ts:62-78, 109-145` filter by `tenantId`; webhook lookup at `delivery-config.service.ts:97-107` uses the `@@unique([platform, remoteRestaurantId])` constraint (`prisma/schema.prisma:2153`). | ❌ none | cross-tenant data leak |
| I-8 | Two replicas / pods MUST NOT poll the same platform simultaneously. | `order-polling.scheduler.ts:45-48` (`pg_try_advisory_lock`) — released in `finally` at `:53-55` | ❌ none | doubled platform API spend; doubled rate-limit hits; duplicate-detection load |
| I-9 | Two replicas MUST NOT race the token-refresh cron and over-write each other's freshly minted token. | `token-refresh.scheduler.ts:21-24` (advisory lock) | ❌ none | half-stored tokens, intermittent 401s |
| I-10 | Credentials and `accessToken` MUST be encrypted at rest and MUST NOT be returned by any tenant-facing endpoint. | `delivery-config.service.ts:53-60` (`stripSensitiveFields`) + `delivery-config.service.ts:120-130` (encryptJson on create) + `delivery-config.service.ts:167-169, 220-221` (encrypt on update / token write); decrypt only via `findOneInternal` / `findByRemoteRestaurantId` (`:80-107`). | ❌ none | credential exfiltration via admin-readable response |
| I-11 | After `CIRCUIT_BREAKER_THRESHOLD` (10) consecutive errors a config MUST auto-disable to stop spamming the platform and the log table. | `delivery-config.service.ts:235-253` (`recordError` increments + auto-disables); polling honors it at `order-polling.scheduler.ts:76` (`errorCount: { lt: CIRCUIT_BREAKER_THRESHOLD }`) | ❌ none | runaway logs / API-quota burn / 3rd-party suspension |
| I-12 | Rotating `credentials` MUST invalidate any cached `accessToken`. | `delivery-config.service.ts:166-175` clears `accessToken`/`tokenExpiresAt` on credentials update | ❌ none | stale token used after key rotation → silent 401s |
| I-13 | The `MenuItemMapping` create endpoint MUST enforce that `productId` belongs to the same tenant. | `delivery-menu-sync.service.ts:166-172` (tenant-scoped product check before create) | ❌ none | cross-tenant product reference |
| I-14 | An auto-accept that fails on the platform side MUST be retryable AND MUST NOT silently flip a staff-cancelled/rejected order back to ACCEPTED. | `retry.scheduler.ts:58-69` (skip if order status is CANCELLED/REJECTED/PAID) | ❌ none | "zombie" platform-accepted orders that staff already rejected |
| I-15 | Status-sync retries MUST re-read current order status before re-sending; cannot replay a stale snapshot. | `retry.scheduler.ts:34-46` (re-reads `order.status` before calling `syncStatusToPlatform`) | ❌ none | stale `PREPARING` re-sent after order has been `CANCELLED` |
| I-16 | Raw webhook bodies persisted in `DeliveryPlatformLog.request` and `Order.externalData` MUST have PII (name/phone/address/etc.) redacted. | `delivery-log.service.ts:64-79` (`scrubPii`) called from `delivery-order.service.ts:156` and from controller error-path `delivery-webhook.controller.ts:97, 170` and from polling failure path `order-polling.scheduler.ts:127` | ❌ none | GDPR-style PII retention beyond the dedicated order columns |

---

## 4. State machine

**Status enum:** `common/constants/order-status.enum.ts:1-9` — `PENDING_APPROVAL | PENDING | PREPARING | READY | SERVED | PAID | CANCELLED`.
Schema column is `String` with default `"PENDING"` (`prisma/schema.prisma:500`). The Order model uses the **internal KDS** state machine — there is no separate `DeliveryOrder` state column. Delivery orders are differentiated by `source != null` + `externalOrderId != null` (`prisma/schema.prisma:510-513`).

Mapping to the (informal) platform vocabulary requested in the prompt:
- internal `PENDING_APPROVAL` / `PENDING` ≈ platform "NEW" / "ACCEPTED"
- internal `PREPARING` ≈ platform "PREPARING"
- internal `READY` ≈ platform "READY"
- internal `SERVED` is **dine-in only** and is intentionally NOT propagated to platforms; courier pickup is the platform's concern (`constants/platform-status-map.ts:18-21`).
- internal `CANCELLED` → platform `CANCELLED`.

| From → To | Trigger | Guard / Side-effect (`file:line`) | Idempotent? | Notes |
|-----------|---------|-----------------------------------|-------------|-------|
| `∅ → PENDING_APPROVAL` | inbound webhook/poll with `autoAccept=false` | `delivery-order.service.ts:140-150` — `requiresApproval=true` flag set | yes (partial unique index on `(tenantId, source, externalOrderId)`) | KDS emit at `:260` |
| `∅ → PENDING` | inbound with `autoAccept=true` | `delivery-order.service.ts:140-141` | yes (same index) | also fires `adapter.acceptOrder` at `:229` |
| `PENDING_APPROVAL → PENDING` | staff approves in KDS | outside this module (orders service) | — | should also trigger status sync to platform |
| `PENDING → PREPARING` | KDS / POS marks preparing | `delivery-status-sync.service.ts:30-83` → `STATUS_TO_PLATFORM_ACTION[PREPARING]` = `markPreparing` (`platform-status-map.ts:24`) | **partial** — adapter call is not idempotent on the platform side; relies on retry skipping if status drifted (`retry.scheduler.ts:34-46`) | re-reads current status on retry |
| `PREPARING → READY` | KDS marks ready | `STATUS_TO_PLATFORM_ACTION[READY]` = `markReady` (`platform-status-map.ts:25`) | partial — same as above | |
| `READY → SERVED` | dine-in concept; **no platform sync** | `platform-status-map.ts:18-21` comment | n/a | intentional |
| `READY → PICKED_UP` (platform-side) | courier picks up at platform; **does not write back to KDS** in current code | no inbound webhook handler updates status; only `delivery-webhook.controller.ts:114-122` logs the body and returns 200 without acting | — | see F-5 |
| `* → CANCELLED` (staff) | KDS cancel | `STATUS_TO_PLATFORM_ACTION[CANCELLED]` = `cancelOrder` (`platform-status-map.ts:26`) | partial | platform's `cancelOrder` endpoint typically idempotent but not guaranteed |
| `* → CANCELLED` (platform-side) | courier/customer cancels on platform | **no implementation** — Yemeksepeti `yemeksepetiStatusUpdate` at `delivery-webhook.controller.ts:113-123` only logs; status from platform never propagates to internal Order | — | see F-5 |
| `PAID` | payment write in orders module | — | — | retry scheduler skips retries against `PAID` orders (`retry.scheduler.ts:63`) |

**Forbidden transitions** (none explicitly guarded inside this module — relies on the orders module's own state-machine):
- `CANCELLED → *` — not guarded inside `delivery-status-sync.service.ts`; if an external caller asks to sync `PREPARING` for a cancelled order it will be sent. Retry-path does guard it (`retry.scheduler.ts:61-69`) but the live path (`syncStatusToPlatform`) does not re-check that the new status is reachable from the prior.
- `PAID → *` — same.

**Transitions that should be idempotent but aren't** — see F-1 (inbound dedup ambiguous null return) and F-5 (no inbound platform-status webhook handler).

---

## 5. Money & precision audit

**Decimal entry points** (where `Prisma.Decimal` first enters this flow):
- `delivery-order.service.ts:157-159` — `totalAmount`, `discount`, `finalAmount` written to the Order. Prisma will coerce the JS `number` from `NormalizedOrder` into the `Decimal(10,2)` column (`prisma/schema.prisma:502-504`). The values arrive as **plain JS numbers** from the adapters — never as `Decimal`.

**Number entry points (every one is a precision-loss hazard) — adapters parse platform JSON straight into JS numbers:**
- `adapters/getir.adapter.ts:163, 168, 182-184` — `Number(product.price || 0) / 100` (kuruş → TRY conversion), `(raw.totalPrice || 0) / 100`, etc. Division on `Number` ⇒ binary-FP rounding; `(123) / 100 === 1.23` is fine but `(12345) / 100 === 123.45` only by luck of the binary representation. Acceptable here only because totals are persisted as `Decimal(10,2)` which truncates/rounds — but the **reconciliation** in I-2 cannot be done in `Number` arithmetic without ± 0.01 tolerance.
- `adapters/yemeksepeti.adapter.ts:118, 122, 136-138` — `product.unitPrice || product.price || 0` straight off the JSON, no normalization.
- `adapters/trendyol.adapter.ts:214, 218, 231-233` — same.
- `adapters/migros.adapter.ts:139, 143, 156-158` — same.

Reproduce with:
```
grep -n 'Number(\|/ 100\|parseFloat(' backend/src/modules/delivery-platforms/adapters/*.ts
```

**Item subtotal math** (`delivery-order.service.ts:79-87`):
```ts
const modifierTotal = (item.modifiers || []).reduce(
  (sum, m) => sum + m.price * m.quantity,
  0,
);
// ...
subtotal: item.quantity * item.unitPrice + modifierTotal,
```
All `Number` arithmetic. Persisted to `OrderItem.subtotal` and `modifierTotal` as `Decimal(10,2)`. **No assertion** that `Σ(orderItems.subtotal) ≈ totalAmount`. M7 / I-2.

**Rounding policy + tolerance constants:** none declared anywhere in this module. The Order schema's `Decimal(10,2)` does implicit half-up rounding on insert.

**Sum-of-parts reconciliation:**
- Σ(items.subtotal + modifierTotal) vs `totalAmount` — **NOT asserted**. The platform's claimed `totalAmount` is written verbatim. See M7 / F-3.
- `totalAmount - discount === finalAmount` — **NOT asserted**. Migros, Trendyol, and Yemeksepeti normalizers compute `finalAmount` as a fallback to `totalPrice` if the platform doesn't supply `payableAmount`/`paymentAmount` (`yemeksepeti.adapter.ts:138`, `trendyol.adapter.ts:233`, `migros.adapter.ts:158`) — so `finalAmount` may silently equal `totalAmount` (no discount applied) even when `discount > 0`. See F-4.

**Commission calculations:** none — this module does not compute or store platform commissions. If/when commissions are added, they should be modelled as a separate `Decimal` column rather than back-derived from totals.

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**
- `delivery-order.service.ts:43-211` — `prisma.$transaction` wraps the dedup `findFirst` + `create`. The transaction is **not** `Serializable` (default `ReadCommitted`), but the partial unique index `orders_tenant_source_external_uniq` (`prisma/migrations/20260312_add_order_timestamps_and_dedup_index/migration.sql:7-9`) plus the P2002 catch at `:199-209` provides the actual race-safety. Idempotent outcome on concurrent webhook + poll arrivals.
- `order-polling.scheduler.ts:45-55` — `pg_try_advisory_lock(djb2('order-polling'))`, released in nested `finally`. Multi-instance safe.
- `token-refresh.scheduler.ts:21-36` — same pattern. Multi-instance safe.
- `delivery-config.service.ts:120-145` — `create` relies on `@@unique([tenantId, platform])` + `@@unique([platform, remoteRestaurantId])` (`prisma/schema.prisma:2149-2153`) and catches P2002 explicitly.

**Race windows still open** (each with a reproduction sketch):

*Sketch:* `ensureValidToken` (`delivery-auth.service.ts:79-101`) reads `config`, finds the token "near expiry" → calls `refreshToken` → re-reads. Two callers can arrive simultaneously, both observe near-expiry, both invoke `adapter.authenticate`, both write a fresh token to the same row.
*Where:* `delivery-auth.service.ts:79-101`.
*Severity:* Medium Cor — the platform almost always returns the same (or a new but equally valid) token, so the lost-update is rarely observable. Still, two extra `/auth/login` round-trips and two extra log writes for every concurrent inbound order.
*Fix:* either single-flight the refresh (in-process map keyed by `configId`, mirroring the frontend's `refreshInFlight` pattern at `frontend/src/lib/api.ts`), or wrap the read-and-refresh in a row-level lock (`SELECT ... FOR UPDATE`).
The scheduled refresh at `token-refresh.scheduler.ts` does NOT close this window because `ensureValidToken` runs on every inbound webhook / poll-tick / status-sync, not just on the cron tick.

*Sketch:* `delivery-config.service.ts:235-253` (`recordError`) increments `errorCount` and then in a separate `update` writes `isEnabled=false`. Two concurrent error reports can both see `errorCount=10` before either writes the disable, leading to two redundant disable writes (harmless) and to the warning being logged twice. Not a correctness bug — just noise.

*Sketch:* `OrderPollingScheduler.runOnce` (`order-polling.scheduler.ts:70-94`) reads all eligible configs, filters by `lastOrderPollAt`, then polls. If `processIncomingOrder` is slow and a tick is skipped (the `isRunning` short-circuit at `:38`), the next tick re-reads `lastOrderPollAt` only AFTER `updateLastPollTime` ran for the prior poll → fine. No race.

**Idempotency keys:**
- Present at the inbound DB layer: `(tenantId, source, externalOrderId)` partial unique index — race-safe across webhook + poll concurrency.
- Present at the auto-accept side: none. If `adapter.acceptOrder` succeeds on the platform but the local log-write times out, the retry scheduler re-calls accept (`retry.scheduler.ts:50-90`). Most platform `accept` endpoints are idempotent (PUT-style state set), but Getir's is `POST /verify` and not documented as such — possible double-accept noise.
- Outbound status sync `delivery-status-sync.service.ts:68` calls the adapter then writes the log. If the log write fails after the platform call succeeded, the retry scheduler re-sends the same status (idempotent only because PUT-status endpoints are state-set).

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Cor | `delivery-order.service.ts:56, 208, 213-215` | Duplicate-webhook path returns bare `null`. Callers (`delivery-webhook.controller.ts:81-83, 156-158`) translate this into HTTP 200 `"duplicate order ignored"` — fine for the controller, but **`OrderPollingScheduler.pollPlatform` cannot distinguish "duplicate-skipped" from "successfully-processed"** (`order-polling.scheduler.ts:111-133`). Both paths fall through to the success branch. Telemetry / dashboards lose the dedup count. Source: `CODE_REVIEW.md §4.8`. | Return `{ created: false, reason: 'duplicate' \| 'no-mapping' }` from `processIncomingOrder`; let scheduler/controller emit distinct metrics. |
| F-2 | High | Cor | `delivery-order.service.ts:101-106, 124-134, 149` | Unmapped items don't force `requiresApproval=true`. If `autoAccept=true` and **every** platform item is unmapped, the order is created with **zero** `validItems` (`:101`), `requiresApproval=false`, and is auto-accepted on the platform side at the platform-claimed `totalAmount`. KDS gets a zero-line ticket with the unmapped names buried in `notes`. Source: `CODE_REVIEW.md §4.8`. | If `unmappedCount > 0` (even partial), force `requiresApproval = true` and `status = PENDING_APPROVAL` regardless of `config.autoAccept`. Block the platform-side `acceptOrder` call until a human reconciles. |
| F-3 | High | Cor | `delivery-order.service.ts:118-121, 157-159` | M7 (renamed). `totalAmount` / `discount` / `finalAmount` come straight off the platform payload — no cross-check against `Σ(items.subtotal + modifierTotal)`. A platform-side bug, compromise, or replay attack against an unsigned platform (Getir/Migros polled) can silently overcharge customers. Source: `CODE_REVIEW.md §2 M7`. | Compute `expectedTotal = Σ(items.subtotal + modifierTotal) - discount` in `Decimal`; assert `abs(expectedTotal - finalAmount) <= 0.01`; on mismatch, force `requiresApproval=true`, log a Sentry-level error, and surface in the platform-logs UI. |
| F-4 | Medium | Cor | `adapters/yemeksepeti.adapter.ts:138`, `adapters/trendyol.adapter.ts:233`, `adapters/migros.adapter.ts:158` | `finalAmount` falls back to `totalPrice` when the platform omits the discounted payable field. So an order with a real `discount` may silently land with `finalAmount == totalAmount`. The reconciliation in F-3 would catch this if implemented. | Fail loudly if both `payableAmount`/`paymentAmount` and `discount` are present-but-inconsistent (`abs(totalPrice - discount - payableAmount) > 0.01`). |
| F-5 | High | Cor | `delivery-webhook.controller.ts:113-123` | Yemeksepeti `yemeksepetiStatusUpdate` handler logs the body and returns `200 ok` without **any** internal Order update. Platform-driven `PICKED_UP` / `CANCELLED` events are silently dropped. KDS will continue to show the order as `READY` indefinitely. There is also no Trendyol equivalent endpoint at all. | Implement inbound status routes for Yemeksepeti and Trendyol that map `delivered/cancelled` → internal status changes; emit a KDS event so the screen clears. |
| F-6 | High | Cor | `delivery-order.service.ts:198-211` | The transaction body uses `tx` for queries but the outer scope catches P2002 to mean "duplicate, ignore". If the transaction throws P2002 from a **non-dedup** unique constraint (e.g., `Order.tenantId_orderNumber` colliding on the generated `orderNumber` at `:116` after a Date.now() collision + UUID-prefix collision — astronomically unlikely but possible), the code silently returns `null` instead of erroring. | Narrow the catch by checking `err.meta?.target` contains `externalOrderId`; rethrow otherwise. |
| F-7 | High | Cor | `delivery-auth.service.ts:79-101` | `ensureValidToken` has a single-flight race across concurrent inbound webhooks/poll-ticks. See §6 sketch. Result: 2-N concurrent `authenticate()` calls + 2-N redundant log rows + 2-N writes to the same `accessToken` column. Not a correctness bug for tokens that the platform happily re-mints, but wasteful and noisy. | Add an in-process `Map<configId, Promise<config>>` so concurrent callers share the refresh promise. Mirror the frontend `refreshInFlight` pattern. |
| F-8 | Medium | Cor | `delivery-status-sync.service.ts:30-83` | The "live" path does not guard against forbidden transitions — if `syncStatusToPlatform(orderId, 'PREPARING')` is called for an order that is already `CANCELLED`, the call is sent. The **retry** path does guard (`retry.scheduler.ts:58-69`). Inconsistent. | Re-read current `order.status` at `:35-37` and `return` if it differs from the requested `newStatus`. |
| F-9 | High | Sec | `webhook-auth.guard.ts:120-126` | Trendyol replay protection is **conditional on the timestamp header being present**: `if (timestamp) { ...check window... }`. If an attacker omits `x-webhook-timestamp`, the signed payload is accepted forever — they only need one valid signed body. The signature itself is over `timestamp ? \`${timestamp}.${body}\` : body` (`:129`), so an attacker who recorded a real signed-without-timestamp body could replay it indefinitely. (If Trendyol always includes the header, this is closed in practice — but the guard should enforce.) | Make the timestamp header **required**: `if (!timestamp) throw UnauthorizedException`. Document the dependency on Trendyol's webhook contract. |
| F-10 | Medium | Sec | `webhook-auth.guard.ts:128` | `body = request.rawBody?.toString('utf8') \|\| JSON.stringify(request.body)`. Falling back to `JSON.stringify(request.body)` is unsafe for signature verification — key order, whitespace, and number formatting differ between what the platform signed and what `JSON.stringify` emits. Will produce false-negative signature failures whenever raw body is unavailable; worse, if a future refactor strips/reorders fields before this point, signatures can falsely succeed against attacker-controlled re-serialization. | Hard-fail if `rawBody` is missing. Configure NestJS to retain raw bodies on webhook routes (`bodyParser` raw option). |
| F-11 | Medium | Cor | `delivery-order.service.ts:127-134, 156` | `orderNotes` is computed inside the transaction using the raw `unmappedItems` array, but the same `rawPayload` is then `scrubPii`'d before persisting to `externalData`. The **notes column** itself can contain PII via `item.name` (typically a menu item, but customer-customised names occur — "Add Extra Mayo for Tarik" style). Not a guaranteed leak, but inconsistent with the rest of the PII story. | Sanitize the notes pipeline too, or document the trade-off. |
| F-12 | Medium | Cor | `delivery-order.service.ts:78-87` | Item subtotal is computed only in `Number` math; modifier total uses `m.price * m.quantity` without verifying `m.quantity` is a positive integer. A platform that emits `quantity: "2"` (string) would silently turn into `0 + NaN = NaN`, then `subtotal: NaN`, then Prisma write fails or stores `NULL` depending on coercion. | Validate at the adapter boundary: `Number.isFinite(m.price) && Number.isInteger(m.quantity) && m.quantity > 0`. Reject (or clamp to 0) at adapter level. |
| F-13 | Low | Arch | `adapters/migros.adapter.ts:24` | `expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)` — "effectively never expires" comment is fine, but the 365-day TTL means `tokenRefreshScheduler` never picks Migros configs up. Acceptable today, but if Migros ever rotates API keys the cache will hold a stale key for a year. | Set a shorter sentinel TTL (24h) so the scheduler at least re-reads `credentials.apiKey` and notices an admin-side rotation. |
| F-14 | Low | Arch | `adapters/trendyol.adapter.ts:38-44` | Deprecated v1 path Base64-encodes `username:password` and stores the encoded string in `accessToken` (encrypted at rest). Fine, but the 24h TTL means it does refresh, doing a (no-op for Basic Auth) base64 every day. Cheap, but harmless to gate. | Skip the refresh path entirely when `credentials.apiVersion !== 'v2'`. |
| F-15 | Low | Perf | `order-polling.scheduler.ts:71-78` | `findMany` of `DeliveryPlatformConfig` runs every 15s with no compound `(isEnabled, platform, errorCount)` index — falls back to `@@index([isEnabled])`. With < ~1k configs this is fine; flag if the table grows. | Add `@@index([isEnabled, platform])` if profiling shows the scan. |
| F-16 | Low | Cor | `delivery-order.service.ts:116` | `orderNumber = \`${platform.substring(0,3)}-${Date.now()}-${uuid.substring(0,8)}\``. UUIDv4 first 8 hex chars ≈ 4.3 billion combinations and Date.now() resolution is 1ms, so a same-ms collision needs ~65k orders in the same ms for ~50% birthday-paradox collision — astronomically safe in practice. Worth a one-line comment so a future reader doesn't shorten the UUID slice. | Add a comment. |
| F-17 | Info | Arch | `adapters/migros.adapter.ts:77-83`, `adapters/getir.adapter.ts:84-90` | `markPickedUp` is a logger-only no-op on Migros and Getir. Combined with F-5 (no inbound pickup webhook), this means **PICKED_UP is never reached in either direction** for these two platforms. Acceptable today (the staff manually marks `READY` and moves on), but should be documented. | Add a note in the platform-status-map. |

---

## 8. What's solid (positive findings)

- `delivery-order.service.ts:43-211` — **transaction + partial unique index + P2002 catch** is the right shape for webhook idempotency. The DB layer is the single source of truth for "this order already exists"; the `findFirst` is just a fast-path. Pattern worth replicating in `subscriptions` (M9) and `split-bill` writes (M10).
- `webhook-auth.guard.ts:34-52` — **`@WebhookPlatform()` decorator + reflector lookup + fail-closed default branch.** Reads platform from handler metadata rather than parsing the URL, so a route refactor / global-prefix change can't silently disable signature verification. Pattern worth replicating in any other multi-tenant webhook surface (Stripe / Iyzico / PayTR when added).
- `delivery-config.service.ts:53-60, 120-130, 166-175, 217-228` — **encrypt-on-write + redact-on-read** for both credentials and access tokens. Mirrors the gold-standard `settings/integrations` module per `CODE_REVIEW.md §4.12`. Confirms M8 is **not** a concern in this module.
- `retry.scheduler.ts:34-46, 58-69` — **re-read current state before retrying**, plus a status whitelist that prevents replaying an `ACCEPTED` against a `CANCELLED` order. Solid defence against stale-snapshot replay.
- `delivery-config.service.ts:235-253` — **circuit breaker** that auto-disables a config after 10 consecutive errors. Stops runaway log writes and runaway 3rd-party API hits.
- `delivery-log.service.ts:64-79` — **`scrubPii` regex** is generous (matches `phone|email|address|customer|name|buyer|recipient|gsm`, recursive into nested objects). Conservative-by-default redaction is the right call for an audit/log table.
- `base.adapter.ts:42-67` — **honours `Retry-After`** (seconds or HTTP-date) before falling back to exponential backoff; capped at 30s. Defensive against rate-limit cascades.
- `prisma/schema.prisma:2153` — **`@@unique([platform, remoteRestaurantId])`** closes a prior gap where disabled configs could collide with enabled ones across tenants and mis-route webhooks. Migration `20260419160000_delivery_hardening` is the right kind of fix.
- `delivery-menu-sync.service.ts:166-172` — **tenant-scoped product existence check** before creating a `MenuItemMapping`. Closes the cross-tenant-FK gap.
- `order-polling.scheduler.ts:42-59` & `token-refresh.scheduler.ts:20-39` — **advisory lock + outer try/finally + nested try/finally for the unlock.** Multi-instance-safe AND the `isRunning` flag is in fact wrapped in `finally` (see §9 spot-check below — the prior round's `(unverified)` claim was wrong).

---

## 9. Spot-checks performed

**Verified:**
- **F-3 / M7** confirmed at `delivery-order.service.ts:118-121, 157-159`: platform-supplied totals are written through unchanged. Adapter normalizers (`getir.adapter.ts:182-184`, `yemeksepeti.adapter.ts:136-138`, `trendyol.adapter.ts:231-233`, `migros.adapter.ts:156-158`) emit JS-number totals; no reconciliation step exists between adapter output and the `tx.order.create` payload.
- **F-2** confirmed at `delivery-order.service.ts:101-106, 149`: `requiresApproval` is `!autoAccept` only; unmapped count is logged but does not feed the gate.
- **F-1** confirmed at `delivery-order.service.ts:56` (early return on existing) and `:208` (P2002 catch return null). Both produce the same `null` to callers.
- **F-5** confirmed at `delivery-webhook.controller.ts:113-123`: handler body is just `logger.log(...)` and `return { status: 'ok' }`. No internal status update.
- **F-9** confirmed at `webhook-auth.guard.ts:121` (the `if (timestamp)` makes the freshness check optional).
- **F-10** confirmed at `webhook-auth.guard.ts:128` (the `|| JSON.stringify(request.body)` fallback).
- **I-1** confirmed by reading the migration: `prisma/migrations/20260312_add_order_timestamps_and_dedup_index/migration.sql:7-9` creates `CREATE UNIQUE INDEX ... ON "orders" ("tenantId", "source", "externalOrderId") WHERE "externalOrderId" IS NOT NULL;`.
- **I-10** verified: `delivery-config.service.ts:53-60` strips `credentials` and `accessToken` from any response; `findOneInternal` / `findByRemoteRestaurantId` are only called from server-side adapters, never from `delivery-platforms.controller.ts`.

**Dropped (initial agent report was wrong):**
- **`CODE_REVIEW.md §3.3` and §4.8: "order-polling.scheduler `isRunning` flag outside lock try/finally — stuck-true if the lock holder crashes."** Verified at `order-polling.scheduler.ts:37-59`: `isRunning` IS set inside an outer `try { ... } finally { this.isRunning = false }` block (`:42` and `:57`). On a crash that throws, the outer `finally` resets the flag; on a hard process-crash the flag dies with the process. The advisory lock is in a **nested** try/finally so it always unlocks regardless of `isRunning`. **Finding is incorrect as stated and is downgraded out of §7.** The actual concurrency design is sound. (The recommendation "drop the flag and rely on advisory lock alone" is still defensible as a simplification, but it's not a bug — `isRunning` provides a same-process short-circuit cheaper than a DB round-trip for the lock.)
- **`CODE_REVIEW.md §3.6`: "Getir/Migros webhooks unsigned."** Re-confirmed dropped: both platforms are in `POLLING_PLATFORMS` (`constants/platform-status-map.ts:42`), have no webhook routes, and the guard's default branch fails closed at `webhook-auth.guard.ts:49-52`.

**Downgraded:**
- "`isRunning` outside try/finally" — High Cor → **dropped entirely** (not just downgraded). See above.
- `CODE_REVIEW.md §4.8` "Duplicate webhook returns null silently, caller can't tell if it was created or skipped" — verified and **kept at Medium** as F-1 (raised back to High for the scheduler-telemetry implication).

---

## 10. Recommended tests

The 5 highest-leverage integration tests. Skeletons only.

```ts
// backend/src/modules/delivery-platforms/__tests__/delivery-order.integration.spec.ts
describe('delivery-order invariants', () => {
  it('I-1: duplicate webhook for same (tenant, platform, externalOrderId) creates exactly one Order', async () => {
    // arrange: tenant A, platform=YEMEKSEPETI, externalOrderId='X1', one mapped item
    // act: await Promise.all([
    //   processIncomingOrder(tenantA, payload),
    //   processIncomingOrder(tenantA, payload),
    //   processIncomingOrder(tenantA, payload),
    // ])
    // assert: prisma.order.count({ where: { tenantId, source, externalOrderId } }) === 1
    // assert: at least 2 of the 3 returns are `{ created: false, reason: 'duplicate' }` (after F-1 fix)
  });

  it('I-2 / F-3 (M7): totals reconciliation rejects platform-claimed mismatch', async () => {
    // arrange: items sum to 90.00 (3x30.00), discount=0, but payload says totalAmount=900.00
    // act: processIncomingOrder
    // assert: order is created with requiresApproval=true
    // assert: a Sentry event of type 'DELIVERY_TOTAL_MISMATCH' was captured
    // assert: order.notes contains "[TOTAL MISMATCH]" or similar
  });

  it('I-3 / F-2: unmapped item forces requiresApproval even when autoAccept=true', async () => {
    // arrange: config { autoAccept: true }; payload has 2 items, only 1 mapped
    // act: processIncomingOrder
    // assert: order.requiresApproval === true
    // assert: order.status === 'PENDING_APPROVAL'
    // assert: adapter.acceptOrder was NOT called (platform side not auto-accepted)
  });

  it('I-5 / F-9: Trendyol webhook without x-webhook-timestamp header is rejected', async () => {
    // arrange: valid signature over body-without-timestamp, omit the timestamp header
    // act: POST /webhooks/delivery/trendyol/order/:remoteId with valid HMAC but no timestamp
    // assert: 401 Unauthorized
  });

  it('I-8 / scheduler concurrency: two replicas don\'t double-poll', async () => {
    // arrange: spin up two scheduler instances against the same DB
    // act: trigger both pollOrders() in the same tick
    // assert: adapter.pollNewOrders was called exactly once for each enabled config
  });
});

// Cross-tenant invariant test (style from CODE_REVIEW.md §3.1):
describe('delivery-platforms cross-tenant isolation', () => {
  it('admin in tenant A cannot read/update/delete tenant B platform configs via any endpoint', async () => {
    // arrange: create tenants A and B, each with a YEMEKSEPETI config; admin token for A
    // act+assert each endpoint in delivery-platforms.controller.ts returns 404 or empty
    //   GET /delivery-platforms/configs           → list contains only A
    //   GET /delivery-platforms/configs/:platform → 404 for B's platform if not in A
    //   PATCH /delivery-platforms/configs/:platform → 404 with B's tenant scope
    //   DELETE /delivery-platforms/configs/:platform → 404
    //   POST /delivery-platforms/menu-mappings (with B's productId) → 404
  });
});
```

Plus a property-style test for the dedup race: `fc.assert(fc.asyncProperty(fc.scheduler(), async (s) => { /* interleave 5 webhook calls + 1 poll-tick */ }))` — confirms `Order.count(...) === 1` under all interleavings.

---

*End of review. F-1, F-2, F-3, F-5, F-9 are the P0 candidates from this module; F-4, F-7, F-8, F-10 are P1. The state-machine gap in §4 (no inbound platform-side `PICKED_UP`/`CANCELLED` handlers, F-5) is the largest customer-visible defect — a delivered order sits in KDS as `READY` forever.*
