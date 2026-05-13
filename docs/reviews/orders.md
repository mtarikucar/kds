# `orders` — Deep Review (2026-05-11)

**Tier:** 1
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/orders/...`, `backend/src/common/utils/order-state-machine.ts`, `backend/prisma/schema.prisma` (Order, OrderItem, OrderItemModifier, Payment)
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — see §2 (M1, M2, M5, M6, M10) and §4.6 for the seed findings.

---

## 1. Health & summary

🟡 **yellow.** The `orders` feature owns the full order lifecycle (create → kitchen → serve → pay → refund), the partial-payment ledger, split-bill aggregation, table transfer/sync, and an explicit POS↔QR-menu approval handoff. Risk concentrates in (a) money arithmetic that drops in and out of `Prisma.Decimal` — every `>=` and `+` on a money column is a precision-loss site; (b) split-bill writes that have no client idempotency key (the single-payment path got one in migration `20260420180000` but split-bill writes go straight through), and (c) post-commit side effects (KDS emits, SMS, stock deduction, invoice generation) that are fire-and-forget after the DB transaction commits — failure modes are absorbed into logs, not surfaced. The state machine itself (`order-state-machine.ts:8-16`) is strict, terminal-aware, and centralized — that part is solid. Health changed from the 2026-04-27 audit only insofar as one verification round confirmed M6 has actually been partially fixed (the `totalAmount === 0` zero-guard is now in place at `orders.service.ts:217`); the residual concern is JS-Number-based tax rounding downstream.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/orders/services/orders.service.ts` (1136 LOC) — order create/update/status/approve/transfer/sync-tables, ingredient deduction hooks, KDS emits.
- `backend/src/modules/orders/services/payments.service.ts` (595 LOC) — single payment, refund, split-bill, group-bill summary.
- `backend/src/modules/orders/controllers/orders.controller.ts` (177 LOC) — REST surface for orders; guards + roles.
- `backend/src/modules/orders/controllers/payments.controller.ts` (62 LOC) — REST surface for payments and split-bill.
- `backend/src/common/utils/order-state-machine.ts` (76 LOC) — transition table + `validateTransition`.
- `backend/src/common/constants/order-status.enum.ts` — status/payment/method enums.
- `backend/prisma/schema.prisma` lines 496-649 — Order, OrderItem, OrderItemModifier, Payment.
- All DTOs (`create-order.dto.ts`, `create-payment.dto.ts`, `split-bill.dto.ts`, `transfer-table.dto.ts`, `update-order.dto.ts`, `update-order-status.dto.ts`).

**Skimmed only:**
- `backend/src/modules/orders/orders.module.ts` — wiring; no logic.
- `backend/src/modules/accounting/services/tax-calculation.service.ts:30-52` — only to confirm `extractTax()` does its arithmetic in Decimal but returns `.toNumber()`, which is the boundary where precision can be lost on the orders side.

**Skipped:**
- `payments.service.ts` accounting integration with `salesInvoiceService` / `accountingSettingsService` — owned by the accounting per-feature review.
- StockDeductionService, KdsGateway, DeliveryStatusSyncService internals — referenced only as collaborators here; covered in their own per-feature files.

---

## 3. Business-logic invariants

The contract the orders feature must keep. Each row is testable.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | Every Order, OrderItem write, and Payment write is filtered by `tenantId`; no list/find endpoint returns rows from another tenant. | `orders.service.ts:111, 125, 150, 332, 411, 482, 511, 645, 838, 942, 951, 1086`; `payments.service.ts:52, 86, 114, 134, 415, 433, 466, 537` | ❌ none | Cross-tenant data leak (Critical Sec). |
| I-2 | OrderItem.tenantId chain: items can only attach to a parent Order in the same tenant. Enforced indirectly — product IDs are filtered by `tenantId` *before* being added to the order create payload. | `orders.service.ts:122-127` (create), `481-486` (update) | ❌ none | Cross-tenant product attached to an order; revenue mis-attribution. |
| I-3 | Σ Payment.amount (status = COMPLETED) for an order ≤ Order.finalAmount + 0.01 (1-cent rounding tolerance). | `payments.service.ts:113-124` (single), `444-455` (split) | ❌ none | Customer is overcharged silently. |
| I-4 | Order moves to PAID only when Σ completed payments ≥ Order.finalAmount; PAID write happens inside the same `$transaction` as the qualifying Payment write. | `payments.service.ts:155-199` (single-payment flow), `474-490` (split flow) | ❌ none | Order marked PAID while payment is still pending → revenue drift. |
| I-5 | Order state transitions follow the table in `VALID_TRANSITIONS`; no skip-step, no resurrection from CANCELLED, no PAID→PENDING. | `order-state-machine.ts:8-16`; called at `orders.service.ts:664` | ❌ none (no spec on the state-machine util) | Out-of-band status writes desync KDS/stock/table state. |
| I-6 | Order prices are server-derived from `Product.price` and `Modifier.priceAdjustment`; client-supplied prices in the DTO are ignored. The DTO has no `unitPrice` field. | `orders.service.ts:165-187, 524-545`; `create-order.dto.ts:19-43` (no unitPrice) | ❌ none | Client-side price tampering → revenue loss. |
| I-7 | Tax math: `Order.taxAmount = round2(Σ items.taxAmount × (1 - discountRatio))`; `discountRatio = discount / totalAmount` if `totalAmount > 0` else `0` (no NaN). | `orders.service.ts:217-218, 575-576` | ❌ none | NaN tax on zero-amount orders; audit drift on discounted orders. |
| I-8 | `Order.finalAmount = totalAmount − discount`. Computed on create *and* on update *and* on discount-only updates. | `orders.service.ts:214, 572, 588` | ❌ none | Discount silently dropped → undercharged customer or audit mismatch. |
| I-9 | Status transitions update side-effect timestamps atomically with the status write: `preparingAt` set on → PREPARING, `readyAt` set on → READY, `paidAt` set on → PAID. | `orders.service.ts:667-669`; `payments.service.ts:195` | ❌ none | KDS / reports show inconsistent timing data. |
| I-10 | Ingredient deductions are idempotent per order — controlled by the `Order.stockDeducted` flag in the schema. Reversed on transition to CANCELLED. | `schema.prisma:524`; `orders.service.ts:719-728` (reverse); `293-305, 731-744` (deduct) | ❌ none | Stock double-decremented on a status retry; oversold inventory. |
| I-11 | Refund of a COMPLETED payment rolls back the order to a non-PAID state when Σ remaining completed payments < `Order.finalAmount`, *atomically* with the customer-stats decrement. | `payments.service.ts:345-396` | ❌ none | Order stuck as PAID after refund; customer lifetime-spend stays inflated. |
| I-12 | Payment status transitions: `PENDING → {COMPLETED, FAILED}`, `COMPLETED → REFUNDED`; FAILED and REFUNDED are terminal. | `payments.service.ts:310-315` (table), `334-339` (guard) | ❌ none | Forbidden round-trip (e.g., REFUNDED → COMPLETED) silently sets `paidAt` again. |
| I-13 | KDS events (`emitNewOrder`, `emitOrderUpdated`, `emitOrderStatusChange`, `emitCustomerOrderApproved`, `emitTableTransfer`) emit *after* the parent DB transaction commits — never before. | `orders.service.ts:290, 635, 747, 907-913, 1054`; `payments.service.ts` has no KDS emits | ❌ none (and §6 flags a partial gap) | KDS shows orders that never persisted; if the TX rolls back, the kitchen still prepares the food. |
| I-14 | Cross-tenant table transfer is impossible: source and target tables are both verified to belong to `req.tenantId` before any write. | `orders.service.ts:941-956` | ❌ none | Orders moved across tenants; revenue+inventory crossing boundaries. |
| I-15 | A Payment with a non-null `idempotencyKey` is unique per `(orderId, idempotencyKey)`; retries return the existing row. | `payments.service.ts:62-78` (fast-path), `253-280` (P2002 fallback); enforced by partial unique index documented at `schema.prisma:637-642` | ❌ none | Network retry on flaky client doubles the customer's bill. |

---

## 4. State machine

**Status enum:** `common/constants/order-status.enum.ts:1-9` — `PENDING_APPROVAL, PENDING, PREPARING, READY, SERVED, PAID, CANCELLED`. Encoded as a Prisma `String` column (`schema.prisma:500`) with a comment listing the allowed values — **not** a Prisma `enum` type, so DB-level integrity depends on application code.

**Transition table** (mirrors `order-state-machine.ts:8-16`):

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `PENDING_APPROVAL → PENDING` | Waiter approval | `orders.service.ts:858` (explicit status check, **not** routed through `validateTransition`) | **No** — second call throws `BadRequestException` rather than no-op | KDS `emitNewOrder` + `emitOrderUpdated`; table → OCCUPIED; SMS notify; `approvedAt`, `approvedById` set |
| `PENDING_APPROVAL → CANCELLED` | Customer cancels or staff rejects | `order-state-machine.ts:9` via `validateTransition` (`orders.service.ts:664`) | Same-state no-op only (`order-state-machine.ts:35-37`) | Stock reversal; KDS status emit |
| `PENDING → PREPARING` | Kitchen starts | `order-state-machine.ts:10` | Same-state no-op only | `preparingAt` set (`orders.service.ts:668`); stock deduction; KDS status; SMS notify; delivery-platform sync |
| `PENDING → CANCELLED` | Void | `order-state-machine.ts:10` | Same-state no-op only | Stock reversal (`orders.service.ts:719`); KDS status; SMS notify |
| `PREPARING → READY` | Kitchen done | `order-state-machine.ts:11` | Same-state no-op only | `readyAt` set (`orders.service.ts:669`); KDS status; SMS notify |
| `PREPARING → CANCELLED` | Mid-prep void | `order-state-machine.ts:11` | Same-state no-op only | Stock reversal; KDS status |
| `READY → SERVED` | Waiter delivers | `order-state-machine.ts:12` | Same-state no-op only | KDS status |
| `READY → CANCELLED` | Lost order | `order-state-machine.ts:12` | Same-state no-op only | Stock reversal; KDS status |
| `SERVED → PAID` | Final payment completes | `payments.service.ts:191-199` — **does NOT use `validateTransition`**; sets status directly inside the payment TX | Concurrent payments race; second write is a no-op only if the first already set PAID — but the partial unique-index on `idempotencyKey` only deduplicates *keyed* requests | `paidAt` set; table → AVAILABLE if no other active orders; customer stats updated; (post-commit) auto-invoice |
| `SERVED → CANCELLED` | Comp / void | `order-state-machine.ts:13` | Same-state no-op only | Stock reversal; KDS status |
| `PAID → CANCELLED` | Refund / void | `order-state-machine.ts:14` (allowed for refund flow) — also reached via `payments.service.ts:362-366` on refund | Same-state no-op via `validateTransition`; refund path checks `payment.order.status === OrderStatus.PAID` (`payments.service.ts:362`) so a second refund of a CANCELLED order won't re-flip it | Customer stats decrement (`payments.service.ts:368-392`); does **not** call `StockDeductionService.reverseForOrder` — see F-O5 |
| `CANCELLED → *` | — | `order-state-machine.ts:15` | Terminal | None |

**Forbidden transitions:**
- `CANCELLED → *` — terminal, enforced at `order-state-machine.ts:15`.
- `PAID → {PENDING, PREPARING, READY, SERVED}` — implicitly forbidden by `VALID_TRANSITIONS[PAID]` containing only `CANCELLED`; `validateTransition` raises `BadRequestException` for anything else.
- `* → PENDING_APPROVAL` — no transition into this state listed; it can only be reached as the initial state of customer-originated orders (the standard POS create path sets `status: PENDING` directly at `orders.service.ts:226`). Approval can only be granted, never re-instated.

**Transitions that should be idempotent but aren't:**
- **`PENDING_APPROVAL → PENDING` via `approveOrder()`** (`orders.service.ts:833-930`) bypasses `validateTransition` and uses an explicit equality check (`order.status !== OrderStatus.PENDING_APPROVAL` → `BadRequestException`). A retry on an already-approved order returns 400 instead of returning the existing approved order. Two waiter clicks within the TX race window will: first wins; second 400s. UX-acceptable for the rare case, but inconsistent with the rest of the state machine which uses `validateTransition` and treats same-state as a silent no-op (`order-state-machine.ts:35-37`). Flagged as F-O1.
- **`SERVED → PAID` via the payment write** does not pass through `validateTransition`. If a third path ever updates `status` without going through `validateTransition`, it can write a forbidden transition with no DB-level guard. Flagged as F-O2.
- **`PAID → CANCELLED` on refund** is conditional on the *current* `payment.order.status === OrderStatus.PAID` (`payments.service.ts:362`). If the underlying order is already CANCELLED for an unrelated reason, the refund of one of its payments will *not* re-cancel and not refund customer stats — borderline correct, but undocumented behavior.

---

## 5. Money & precision audit

**Decimal entry points** (where `Prisma.Decimal` first appears in the orders flow):
- `Product.price` — `schema.prisma:404-ish` (`@db.Decimal(10, 2)`).
- `Modifier.priceAdjustment` — schema.
- `Order.totalAmount`, `Order.discount`, `Order.finalAmount`, `Order.taxAmount` — `schema.prisma:502-505` (all `Decimal(10,2)`).
- `OrderItem.unitPrice`, `OrderItem.subtotal`, `OrderItem.modifierTotal`, `OrderItem.taxAmount` — `schema.prisma:571-575`.
- `Payment.amount` — `schema.prisma:621`.

**Decimal-to-Number conversions** — reproduced with `grep -n 'Number(\|parseFloat(\|toNumber()' backend/src/modules/orders/services/*.ts`:

| `file:line` | Conversion | Used for | Precision-loss risk |
|-------------|------------|----------|---------------------|
| `orders.service.ts:173` | `Number(product?.price ?? 0)` | server-derived `serverPrice` used to build `subtotal = quantity * (serverPrice + modifierTotal)` | Low for ≤ 6-digit prices, but `subtotal` flows into `OrderItem.subtotal` Decimal — round-trip loses sub-cent precision. |
| `orders.service.ts:180` | `Number(modifier?.priceAdjustment || 0)` | summed into `modifierTotal` | Same as above. |
| `orders.service.ts:218` | `Math.round(totalTaxAmount * (1 - discountRatio) * 100) / 100` | JS-Number rounding of tax post-discount | **High** for amounts that don't round cleanly in binary float (e.g., a `0.07 × 100` style edge); also see I-7 above. The zero-guard at line 217 prevents NaN — but the math itself is JS-float. |
| `orders.service.ts:532, 538, 571, 576, 588` | `Number(order.discount)`, `Number(order.totalAmount)`, equivalent rounding | order update path | Same JS-float pattern as create. |
| `payments.service.ts:166-167` | `Number(totalPaid._sum.amount || 0)`; `Number(order.finalAmount)` | `if (totalPaidAmount >= orderAmount)` — the **gate that flips an order to PAID** | **High.** This is the seed for **M1** — see §7. The same flow at lines 117-118 already does it in Decimal, so the regression is local. |
| `payments.service.ts:233` | `Number(customer.totalSpent) + orderAmount` | customer lifetime spend update | High — sum of monies in JS Number. |
| `payments.service.ts:444-446` | `Number(order.finalAmount)`, `Number(p.amount)` | split-bill `remaining` computation | Underpins **M2**. |
| `payments.service.ts:451` | `Math.abs(totalSplitAmount - remaining) > 0.01` | split-bill tolerance gate | **M2 — direct violation:** float math on monies. |
| `payments.service.ts:479-480` | `Number(totalPaid._sum.amount || 0); … >= orderAmount` | split-bill PAID-flip gate | Mirror of M1, inside split flow. |
| `payments.service.ts:563-585` | `Number(item.unitPrice)`, `Number(item.subtotal)`, `Number(o.finalAmount)`, etc. | group-bill summary — read-only aggregation for UI display | Lower-stakes (read-only), but the totals it returns may not match the DB sum-of-Decimals exactly. |
| `tax-calculation.service.ts:47-49` | `.toNumber()` at the boundary | every call to `extractTax()` returns Numbers | The Decimal math inside `extractTax` is correct; the `toNumber()` at the return boundary is the entry point of the JS-float problem in orders.service.ts. |

**Reproduction:** `grep -n 'Number(\|parseFloat(\|toNumber()' backend/src/modules/orders/` returns 21 hits (19 in services, 0 in controllers, 2 in tax-calculation collaborator). None use `parseFloat`. No `toNumber()` calls inside the orders module itself — but the result of `tax-calculation.service.ts:47-49` is a Number that flows in.

**Rounding policy + tolerance constants:**
- **1-cent tolerance on single payment:** `payments.service.ts:119-120` — `if (Decimal(amount).gt(remaining.add('0.01'))) throw`. The comment at line 119 ("1-cent rounding tolerance for float-legacy callers") documents the *why* but offers no sunset condition; until all clients send Decimal-aware amounts, this stays. Note: this path **does** use Decimal correctly.
- **1-cent tolerance on split-bill:** `payments.service.ts:451` — `Math.abs(totalSplitAmount - remaining) > 0.01` — **same tolerance, JS-Number math, no comment**. Inconsistent with the single-payment path.
- **Rounding of post-discount tax:** `orders.service.ts:218, 576` — `Math.round(... * 100) / 100`. Half-up at 2 dp via JS, not `Prisma.Decimal.ROUND_HALF_UP`. Tax-calculation's internal rounding uses `ROUND_HALF_UP` (`tax-calculation.service.ts:32-33`) but the post-discount adjustment in `orders.service.ts` bypasses that.

**Sum-of-parts reconciliation:**
- `Σ OrderItem.subtotal` vs `Order.totalAmount` is **not asserted** anywhere. They are both written by the same `orders.service.create` / `update` logic from a single source of truth (the in-memory sum), but no DB-level check or runtime invariant verifies they agree after the write. If an OrderItem is created/deleted out of band (currently only on update where `tx.orderItem.deleteMany` then nested create — `orders.service.ts:595-631`), they can drift. **Flag F-O4 in §7.**
- `Σ Payment.amount (COMPLETED)` vs `Order.finalAmount` is asserted at the PAID-flip gate (`payments.service.ts:170`, `payments.service.ts:480`) but in JS-Number — see M1.

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**
- `orders.service.ts:60-83` — `createWithOrderNumberRetry` wraps the order create in P2002 retry for the `(tenantId, orderNumber)` unique constraint. Up to 3 attempts; bails with `BadRequestException` after. **Good pattern** — leverages DB-level uniqueness instead of advisory locks.
- `orders.service.ts:642-716` — `updateStatus` wraps the read-validate-write in `prisma.$transaction`. Default isolation (Read Committed on Postgres) — *not* `Serializable`. Two concurrent status writes can both pass `validateTransition` against the same `order.status` snapshot and both write. Bounded only by the `order-state-machine.ts` allowing the joint transition. Example: order is `READY`; two clients both write `SERVED` — both succeed and the second clobbers `readyAt` with `serverAt`-equivalent. Fine. **But:** if one writes `SERVED` and the other writes `CANCELLED`, both pass — last-write-wins, no advisory lock. Flagged F-O3.
- `payments.service.ts:83-252` — payment create in `prisma.$transaction`. Re-reads order inside the TX (`payments.service.ts:85-87`) for a consistent view. **Single-payment idempotency is solid:** partial unique index on `(orderId, idempotencyKey) WHERE idempotencyKey IS NOT NULL` documented at `schema.prisma:637-642`, plus a P2002 try/catch (`payments.service.ts:253-280`) that returns the existing row on collision. Pre-check at `payments.service.ts:62-78` is a responsiveness optimization layered above the constraint.
- `payments.service.ts:412-533` — split-bill is wrapped in `$transaction` but **does not accept** any idempotency key from the client (`split-bill.dto.ts:44-66` — no field) and **does not write** an `idempotencyKey` to any of the per-split Payment rows (`payments.service.ts:459-469`). A retry of the same split-bill request creates duplicate payment rows. **This is M10.**
- `payments.service.ts:345-396` — refund of `PAID` order: wraps payment update + order update + customer stats update in `$transaction`. Atomic. No advisory lock; the only invariant relying on a single writer is the customer-stats decrement, which is safe because customer.totalOrders, totalSpent, averageOrder are all derived from a single read inside the same TX (`payments.service.ts:369-371`). Last-writer-wins for concurrent refunds on different payments of the same order, but the totals math compounds correctly because each refund subtracts a specific `payment.amount`.

**Race windows still open:**

- *Sketch:* request A calls `POST /orders/:id/payments/split` with `{ payments: [{amount: 25}, {amount: 25}] }`; network blip; client retries the entire request. Both go through. Result: 4 payment rows totaling 100 on a 50-currency-unit order.
  *Where:* `payments.service.ts:412-533`.
  *Severity:* High Cor — **M10** verified.
  *Fix:* require `idempotencyKey` on `SplitBillDto` and persist on each child payment with a partial unique index `(orderId, idempotencyKey)` — the same pattern that already exists for single payment.

- *Sketch:* two waiters simultaneously hit `PATCH /orders/:id/status` with one targeting `SERVED` and the other targeting `CANCELLED`. Both reads see `order.status = READY`. Both pass `validateTransition` (both transitions valid from READY). Both writes commit. The second write wins. The `stockDeductionService.reverseForOrder` (for the CANCELLED branch) and `deductForOrder` (for the SERVED branch) both run — they trip over each other depending on the StockDeductionService's own concurrency guard (out of scope here).
  *Where:* `orders.service.ts:642-716`.
  *Severity:* Medium Cor — flag F-O3.
  *Fix:* either escalate the TX to `Prisma.TransactionIsolationLevel.Serializable`, or do a conditional `updateMany` with `where: { id, status: previousStatus }` and reject on `count === 0`.

- *Sketch:* KDS emit ordering after status change. `updateStatus` returns the `updatedOrder` from inside the TX (`orders.service.ts:716`); the KDS emit at line 747 happens *after* the TX commits. **Good.** But: the *first* KDS emit on order create happens at `orders.service.ts:290`, **inside** the outer `withTransaction(...)` Sentry wrapper — which is NOT a DB transaction, it's a tracing helper. `prisma.order.create` (`orders.service.ts:245-287`) commits per-call when not inside a `$transaction`. So this emit is technically post-DB-commit. **Verified.** (See §9.)

- *Sketch:* `transferTableOrders` (`orders.service.ts:932-1069`) wraps the actual move in `$transaction` (line 1002), but the **pre-checks** that read source/target table status (`orders.service.ts:941-966`) are outside the TX. If the target table flips from AVAILABLE to OCCUPIED between the check and the TX start, the move proceeds anyway and downstream logic relies on `allowMerge=true`. The default `allowMerge=true` (`transfer-table.dto.ts:18`) makes this a soft race: result is still a merge, not a failure.
  *Severity:* Low Cor — note only.

**Idempotency keys:**
- **Present at:** `payments.service.ts:62-78, 253-280` — single-payment write, both the fast-path pre-check and the P2002 fallback. Constraint enforced by partial unique index (`schema.prisma:637-642`).
- **Missing where needed:**
  - **`POST /orders/:orderId/payments/split`** — `split-bill.dto.ts` has no `idempotencyKey`; `payments.service.ts:459-469` does not persist one. → **M10**.
  - **`POST /orders`** — `create-order.dto.ts` has no `idempotencyKey`. A client retry on an order creation request can create duplicate orders. Order numbers are unique (DB-level), so the duplicates have *different* order numbers — they're not collapsed. The `createWithOrderNumberRetry` only protects against the orderNumber collision on the *same* request, not against duplicate requests. Flag F-O7.
  - **`POST /orders/:id/approve`** — `approveOrder()` uses an explicit status equality check, not an idempotency key; second click of "approve" 400s rather than no-ops. See F-O1.

---

## 7. Findings

Severity: Critical → High → Medium → Low → Info.
Dimension: Sec / Cor / Arch / Perf.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| M1 | High | Cor | `payments.service.ts:166-167` | The PAID-flip gate compares `Number(totalPaid._sum.amount)` to `Number(order.finalAmount)`. On orders past ~9 quadrillion this loses precision in JS Number, but the realistic loss is at the cent boundary: `Decimal('0.1') + Decimal('0.2')` is exact (`0.3`), but `Number('0.1') + Number('0.2')` is `0.30000000000000004`. A correctly-summed completed-payments aggregate that *should* equal `finalAmount` to the cent may compare `>= ` as false. The Decimal-correct equivalent already exists at `payments.service.ts:117-120` — this is an inconsistency in the same method. | Replace lines 166-167 with `Decimal` comparison: `new Prisma.Decimal(totalPaid._sum.amount ?? 0).gte(new Prisma.Decimal(order.finalAmount))`. |
| M2 | High | Cor | `payments.service.ts:444-455` | Split-bill tolerance check uses `Math.abs(totalSplitAmount - remaining) > 0.01` on JS Number. Same precision concern as M1; the single-payment path at `:120` uses Decimal correctly — split bill is the outlier. | Compute `remaining` and `totalSplit` in `Prisma.Decimal`; gate on `splitTotal.sub(remaining).abs().gt('0.01')`. |
| M5 | High | Cor | `payments.service.ts:282-292` | Auto-invoice generation is `await`-ed *after* the payment transaction commits, with a `try/catch` that swallows failure into `logger.error`. If invoice creation fails (provider down, accounting credential expired), the order is PAID but no invoice exists; revenue silently un-booked. No retry, no alert beyond logs. Mirror exists in split-bill at lines 515-525 (uses `console.error` directly there — worse). | Wrap in a bounded retry (e.g., `p-retry` 3 attempts with backoff); on terminal failure, emit `REVENUE_SYNC_FAILED` to Sentry with tenantId, orderId, paymentId for ops follow-up. |
| M6 | Medium | Cor | `orders.service.ts:217-218, 575-576` | **Partially fixed.** The `totalAmount === 0` zero-guard *is* in place (`totalAmount > 0 ? discount / totalAmount : 0`), so `discountRatio = NaN` is no longer reachable. Residual concern: the rounding to 2dp is done in JS Number (`Math.round(x * 100) / 100`) rather than `Decimal.toDecimalPlaces(2, ROUND_HALF_UP)`. Tax write to DB is therefore subject to binary-float intermediate values. Downgraded High → Medium. See §9. | Compute `adjustedTaxAmount` in Decimal: `totalTaxDecimal.mul(Decimal(1).sub(discountRatioDecimal)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)`. |
| M10 | High | Cor | `payments.service.ts:412-533`; `split-bill.dto.ts:44-66` | Split-bill writes accept no client-supplied idempotency key (DTO has no field; the service writes Payment rows without `idempotencyKey` at lines 459-469). Network retry from a flaky client creates duplicate Payment rows and can mark the order PAID twice on the same split. The single-payment path has the equivalent solution (partial unique index + P2002 catch) — split bill bypasses it entirely. | Add `idempotencyKey: string` (8-64 chars) to `SplitBillDto`. On the service side, persist as part of every child Payment row inside the TX; catch P2002 and return the existing split set on collision. Same shape as `payments.service.ts:253-280`. |
| F-O1 | Medium | Cor | `orders.service.ts:858-860` | `approveOrder` uses an explicit `if (order.status !== OrderStatus.PENDING_APPROVAL) throw BadRequestException` instead of routing through `validateTransition`, which is the same-state-is-no-op pattern (`order-state-machine.ts:35-37`). A second approve click on an already-approved order 400s instead of returning the existing approved order. Inconsistent with the rest of the state machine. | Route the transition through `validateTransition(order.status, OrderStatus.PENDING)`. Return the existing order on same-state. |
| F-O2 | Medium | Cor | `payments.service.ts:191-199, 484-487` | The `SERVED → PAID` transition (writing `status: OrderStatus.PAID` inside the payment TX) bypasses `validateTransition`. Today it's correct because the payment can only run when the order is not already PAID/CANCELLED (guarded at `payments.service.ts:94, 99`), and the implicit predecessor in the state machine (`SERVED`) is valid for `PAID`. But: an order in `PENDING` or `PREPARING` can also have payments created (the guards only reject PAID, CANCELLED, and PENDING_APPROVAL), which would flip a not-yet-prepared order to PAID. That's `PENDING → PAID` — a transition **not** present in `VALID_TRANSITIONS` (line 10 only allows PREPARING and CANCELLED from PENDING). | Either route every status write through `validateTransition`, or make explicit that payment-driven `→ PAID` is allowed from any non-terminal status and update the state-machine table to match. |
| F-O3 | Medium | Cor | `orders.service.ts:642-716` | `updateStatus` runs in default isolation (Read Committed). Two concurrent writers can both pass `validateTransition` against the same snapshot and both commit. Last-write-wins. No advisory lock, no conditional `updateMany`, no `Serializable`. | Convert to conditional update: `tx.order.updateMany({ where: { id, status: order.status }, data: ... })` and reject on `count === 0`. Pattern used elsewhere in the codebase (see `customers/loyalty.service.ts` per CODE_REVIEW.md §4.16). |
| F-O4 | Medium | Cor | `orders.service.ts:189-218` (create), `547-589` (update) | `Order.totalAmount` is the JS-sum of in-memory `subtotal` values; `OrderItem.subtotal` is computed independently. They agree by construction at write time, but no DB-side check or runtime assertion holds them in sync. If a future code path mutates an OrderItem directly (e.g., via raw SQL or a one-off admin tool), `Σ items.subtotal ≠ order.totalAmount` and audits drift silently. | Add a tx-level assertion before commit: `if (sumItems.sub(order.totalAmount).abs().gt('0.01')) throw InternalServerError('Order total reconciliation failed')`. Cheap insurance. |
| F-O5 | Medium | Cor | `payments.service.ts:345-396` (refund) | Refund flow flips the order to CANCELLED when remaining completed payments no longer cover finalAmount, but **does not call** `StockDeductionService.reverseForOrder`. If ingredient deductions ran when the order moved to PREPARING / SERVED / PAID, they remain after the order is cancelled via refund. Compare to `orders.service.ts:719-728` which *does* reverse stock on `updateStatus → CANCELLED`. | Inject `StockDeductionService` into `PaymentsService` and call `reverseForOrder(orderId, tenantId)` after the refund TX commits. |
| F-O6 | High | Cor | `payments.service.ts:373-378` | Refund subtraction clamps `customer.totalSpent` to ≥ 0 via `Prisma.Decimal.max(0, ...)` without emitting any alert when the would-be value is negative — which signals corrupt accounting state (refund of more than the customer ever spent on this restaurant). Currently silent. From CODE_REVIEW.md §4.6 (preserved severity). | Compute the difference first; if `< 0`, capture to Sentry with `tenantId`, `customerId`, `paymentId` *before* clamping. Then clamp and continue (data preservation > 500). |
| F-O7 | Medium | Cor | `orders.service.ts:85-320`; `create-order.dto.ts` | `POST /orders` has no idempotency key. `createWithOrderNumberRetry` only protects against orderNumber collisions on the *same in-flight* request; it does nothing for duplicate client submissions, each of which gets its own freshly-generated orderNumber. Network retry on order create → two orders in the kitchen. The HTTP semantics of POST allow this, but for a POS UI that retries on transient failure, this is a real bug. | Add optional `idempotencyKey` (8-64 chars) to `CreateOrderDto`. Persist on `Order` with a partial unique index on `(tenantId, idempotencyKey) WHERE idempotencyKey IS NOT NULL`; pre-check + P2002 fallback. Same shape as the payment idempotency. |
| F-O8 | Medium | Cor | `payments.service.ts:112-124` | 1-cent overage tolerance is now documented at line 119 ("1-cent rounding tolerance for float-legacy callers") but has no sunset condition — there is no plan tracked anywhere for removing it once clients send Decimal-aware amounts. Severity preserved from CODE_REVIEW.md §4.6 (Medium). | Add a `TODO(money-precision): remove after frontend always sends rounded Decimal amounts — see ticket #...` and a metric counting requests where `amount` lands inside the tolerance window so the sunset is observable. |
| F-O9 | Medium | Arch | `orders.service.ts` (file size) | 1136 LOC service bundles: order lifecycle, KDS event emission, ingredient deduction trigger, table-transfer logic, table-status sync, approval flow, status-machine wiring. The single `OrdersService` is the largest service in the codebase. CODE_REVIEW.md §4.6 lists this; severity preserved (Medium Arch). | Extract `OrderApprovalService`, `OrderTableTransferService`, and route KDS emits through a small façade. Keep `OrdersService` to CRUD + state transitions. |
| F-O10 | Low | Perf | `payments.service.ts:535-594` (`getGroupBillSummary`) | Reads all tables in the group, all active orders on each, all `orderItems` and `payments` per order, then flat-maps everything in memory. No `take`, no pagination. Group bills are bounded in practice (a group is usually 2-6 tables), but worst-case a 20-table group with 50 historical-but-active orders apiece is 1000+ orderItems serialized in one response. Preserved from CODE_REVIEW.md §4.6 (Low Perf). | Add explicit `take` on the inner orders include (e.g., `take: 200`); paginate items if `allItems.length > 500` with a `truncated: true` flag. |
| F-O11 | Low | Cor | `orders.service.ts:777-789` (`remove`) | Hard delete on `prisma.order.delete`. No soft-delete, no audit row, no log. The `Order` model has no `deletedAt` (`schema.prisma:496-566`). Allowed only for PENDING or CANCELLED orders, but: deleting a CANCELLED order erases the cancellation record from the audit chain. CODE_REVIEW.md §3.4 calls out soft-delete inconsistency across the codebase; this is one instance. | Switch to soft-delete (`deletedAt DateTime?`) on Order; update findAll / findOne to filter `deletedAt: null`. Aligns with the soft-delete standardization tracked in CODE_REVIEW.md §7 P3. |
| F-O12 | Low | Sec | `orders.controller.ts:48, 134, 148, 163, 174` | Role gating on the controller is correct (`@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)`), and `JwtAuthGuard + TenantGuard + RolesGuard` populate `req.tenantId`. But several handlers use `@Param('id') id: string` *without* `ParseUUIDPipe`. Non-UUID input gets passed straight to `prisma.findFirst({ where: { id } })`, which returns `null` on type mismatch (Prisma string column accepts anything). Behavior is safe (404 not found), but a `ParseUUIDPipe` would 400 earlier and tighten the contract. `group-bill-summary/:groupId` (line 80) *does* use `ParseUUIDPipe` — inconsistent. | Add `ParseUUIDPipe` to all `:id` params for consistency. |
| F-O13 | Info | Cor | `orders.service.ts:290, 297, 311, 635, 727, 736, 747, 907-913, 1054` | KDS event emission is correct (post-DB-commit for `create`, `updateStatus`, `approveOrder`, `transferTableOrders`) but is **synchronous and unawaited** — if the gateway is slow or throws, the request response is delayed or fails after the DB write has committed. Acceptable for fire-and-forget UX events, but worth a brief comment on intent. | Wrap each emit in `try/catch` that logs and continues; or move to a dedicated `OrderEventBus` queue. No bug; observability improvement. |

---

## 8. What's solid (positive findings)

- **`orders.controller.ts:33, 42-43`** — every endpoint is gated by `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)` at the controller level *and* `@Roles(...)` per-handler. `@CheckLimit(LimitType.MONTHLY_ORDERS)` (`orders.controller.ts:43`) enforces the subscription plan ceiling on order creates. The role matrix (ADMIN+MANAGER+WAITER for creates/updates, ADMIN+MANAGER for delete and `sync-table-statuses`) is consistent and minimal. **Candidates to copy: any controller that doesn't yet have role-per-endpoint gating.**
- **`order-state-machine.ts:8-46`** — centralised, terminal-aware, throws Turkish-localized errors via `BadRequestException`, allows same-state as a no-op. The `getValidNextStates` helper enables frontend feature gating. **Candidates to copy: payments has its inline transition table at `payments.service.ts:310-315` — pull it into a shared `payment-state-machine.ts` for the same pattern.**
- **`orders.service.ts:60-83`** — `createWithOrderNumberRetry` is a clean P2002 retry pattern: catches the specific Prisma error code + target column, retries up to 3 times, bails cleanly. Better than an advisory lock for this case (no shared state, just a unique-constraint retry). **Reusable pattern for any `auto-generate + unique` flow.**
- **`payments.service.ts:62-78` + `253-280` + `schema.prisma:637-642`** — the partial-unique-index idempotency pattern is exemplary: fast-path pre-check, P2002 race fallback, both returning the existing row, with the schema comment explaining *why* a plain `@@unique` doesn't work (NULL handling in Postgres). **This is the template for fixing M10 (split bill) and F-O7 (order create).**
- **`payments.service.ts:165-187`** — Server-derived pricing: prices are looked up from `Product.price` and `Modifier.priceAdjustment` server-side; the DTO has no `unitPrice` field. Client-side price tampering is impossible. Comment at line 165 ("Build product price map from DB (never trust client-supplied prices)") makes the intent explicit. Same pattern in update at line 524.
- **`payments.service.ts:341-396`** — Refund flow rolls back order status *and* customer stats *and* `paidAt` inside a single `$transaction`. The leading comment (lines 341-344) documents what the previous (broken) behavior was. **Pattern worth keeping: comments that capture the bug you fixed.**
- **`orders.service.ts:60-83, 222-287`** — order create uses `withTransaction(...)` (Sentry tracing wrapper) for breadcrumbs; the actual DB write commits per-call. KDS emit happens after the DB commit. Tracing tags include `tenant.id`, `order.type`, `user.id` — good for incident triage.
- **`orders.service.ts:595-631`** — atomic replace of an order's item set on update wraps the `deleteMany` + nested create in a `$transaction`, with a comment documenting the prior bug (empty orders on partial failure). Good defensive shape.
- **`orders.service.ts:1076-1135`** — `syncTableStatuses` uses a single `groupBy` aggregation (line 1091) instead of per-table count queries. Explicit N+1 avoidance with a comment ("eliminates N+1"). Skips RESERVED tables explicitly.

---

## 9. Spot-checks performed

**Verified (opened cited line + read 30 lines of surrounding context):**

- **M1** confirmed at `payments.service.ts:166-167`. The `>=` gate at line 170 runs after the `Number(...)` conversion, while the validation-against-remaining gate at lines 113-124 (only 50 lines earlier in the same method) does the same arithmetic in `Prisma.Decimal`. Inconsistency is local.
- **M2** confirmed at `payments.service.ts:444-455`. Line 451 is the exact `Math.abs(totalSplitAmount - remaining) > 0.01` reported. Found at line 451, not 448-455 — the cited line range was slightly off in CODE_REVIEW.md but the finding is the same.
- **M5** confirmed at `payments.service.ts:282-292`. `await this.salesInvoiceService.createFromOrder(...)` inside a `try/catch` that logs and swallows. The split-bill mirror at lines 515-525 uses `console.error` directly (slightly worse — should also use `this.logger`).
- **M10** confirmed at `payments.service.ts:412-533` and `split-bill.dto.ts:44-66`. The DTO has no `idempotencyKey` field; the `tx.payment.create` at lines 459-469 does not set one; the partial unique index on `(orderId, idempotencyKey)` therefore can't help.
- **F-O6** (refund > totalSpent silently clamped) confirmed at `payments.service.ts:373-378`. `Prisma.Decimal.max(new Prisma.Decimal(0), ...)` clamps with no `if (delta.lt(0))` alert path.
- **F-O8** (1-cent tolerance documentation) — the comment exists (`payments.service.ts:119`) but there's no sunset/TODO marker. Tone of CODE_REVIEW.md §4.6 entry preserved.
- **F-O10** (`getGroupBillSummary`) confirmed at `payments.service.ts:535-594`; no `take`/`skip`, full flat-map.
- **I-13** (KDS emits post-commit) verified by tracing: `prisma.order.create` (line 245) is *not* inside a `$transaction` block — `withTransaction(...)` at line 86 is a Sentry tracing wrapper, not a DB transaction. Therefore the create commits before line 290's `kdsGateway.emitNewOrder`. Same pattern verified for `updateStatus` (commit at line 716 via `$transaction` return; emit at line 747).
- **State machine** verified by reading `order-state-machine.ts` end-to-end; transition table in §4 matches.
- **Schema** verified by reading `schema.prisma:496-649`. Order model has `@@unique([tenantId, orderNumber])` (line 552) and compound indexes `(tenantId, status)`, `(tenantId, createdAt)`, `(tenantId, tableId, status)` (lines 562-564) — order list queries are well-indexed. Payment has `(tenantId, status)` and `(tenantId, createdAt)` (lines 646-647).

**Dropped (initial CODE_REVIEW.md report was overstated):**
- **M6** ("tax post-discount NaN when totalAmount=0"): the zero-guard `totalAmount > 0 ? discount / totalAmount : 0` **is already in place** at `orders.service.ts:217` (create) and `:575` (update). The NaN path is not reachable. The residual concern is the JS-Number rounding policy, not the NaN risk. **Reclassified — see Downgraded below.** Note: CODE_REVIEW.md flagged it *(unverified)* — this is the kind of case it warned about.

**Downgraded:**
- **M6**: severity dropped from **High → Medium** because the NaN risk is closed; only the JS-float rounding of the discount-proportional tax remains. Captured as a Medium Cor in §7 with the narrower fix scope. CODE_REVIEW.md original line ref preserved.

**Promoted from CODE_REVIEW.md §4.6 (preserved severities):**
- F-O6 (refund > totalSpent) — was High Cor in §4.6, kept as High Cor.
- F-O8 (1-cent tolerance) — was Medium Cor in §4.6, kept as Medium Cor.
- F-O9 (file size) — was Medium Arch in §4.6, kept as Medium Arch.
- F-O10 (getGroupBillSummary N+1) — was Low Perf in §4.6, kept as Low Perf.

**Newly identified during this deep-review pass (not in CODE_REVIEW.md):**
- F-O1 (approveOrder bypasses validateTransition / non-idempotent)
- F-O2 (payment-driven `→ PAID` doesn't go through validateTransition)
- F-O3 (`updateStatus` race in default isolation)
- F-O4 (no Σ items.subtotal vs totalAmount assertion)
- F-O5 (refund doesn't reverse ingredient deductions)
- F-O7 (no idempotency on order create)
- F-O11 (hard delete on `remove()`, no audit chain)
- F-O12 (some `:id` params miss `ParseUUIDPipe`)
- F-O13 (KDS emits unawaited)

Counts: **5 seed findings preserved** (M1, M2, M5, M6 downgraded, M10), **4 §4.6 findings preserved** (F-O6, F-O8, F-O9, F-O10), **9 newly added** (F-O1 … F-O5, F-O7, F-O11 … F-O13). **Zero `*(unverified)*` tags remain** — every finding above has been opened at the cited `file:line` and confirmed.

---

## 10. Recommended tests

Skeletons only; not full implementations. Each one targets a specific §3 invariant or a §6 race.

```ts
// backend/src/modules/orders/__tests__/orders.integration.spec.ts
describe('orders — multi-tenant invariants (I-1, I-2, I-14)', () => {
  it('I-1: list/find/update endpoints never return cross-tenant rows', async () => {
    // arrange: tenant A creates order Oa; tenant B creates order Ob
    // act: as user(B), call GET /orders, GET /orders/:Oa, PATCH /orders/:Oa
    // assert: list omits Oa; find 404s; update 404s
  });

  it('I-14: transferTableOrders rejects cross-tenant table ids', async () => {
    // arrange: tableA in tenant A, tableB in tenant B, order on tableA
    // act: as user(A), POST /orders/transfer-table { source: tableA.id, target: tableB.id }
    // assert: 404 (target table not found in tenant A)
  });
});

describe('orders — money & precision invariants (I-3, I-4, I-7, I-8)', () => {
  it('I-3 + M1: Σ payments cannot exceed finalAmount by more than 0.01', async () => {
    // arrange: order finalAmount = 99.99
    // act: pay 50.00, then pay 50.00
    // assert: second pay rejected (would push total to 100.00, 0.01 over tolerance)
    // and Σ payments == 50.00 (only the first succeeded)
  });

  it('M1: PAID flip is Decimal-exact at the 0.1 + 0.2 boundary', async () => {
    // arrange: order finalAmount = Decimal('0.30')
    // act: pay Decimal('0.10'), pay Decimal('0.20')
    // assert: order.status === 'PAID' after second payment
    //   (currently fails if implementation does Number(0.1) + Number(0.2) >= 0.3)
  });

  it('I-7 + M6: discounted-tax math handles totalAmount = 0 without NaN', async () => {
    // arrange: order with all items priced 0 (e.g., comp/test order)
    // act: create order with discount = 0
    // assert: order.taxAmount === 0 (not NaN)
  });

  it('I-8: discount on update propagates to finalAmount', async () => {
    // arrange: order totalAmount = 100, discount = 0, finalAmount = 100
    // act: PATCH /orders/:id with { discount: 10 }
    // assert: order.finalAmount === 90, taxAmount adjusted proportionally
  });
});

describe('orders — state-machine invariants (I-5, I-9, I-12)', () => {
  it('I-5: PENDING → READY (skip-step) rejected', async () => {
    // arrange: order in PENDING
    // act: PATCH /orders/:id/status { status: READY }
    // assert: 400 BadRequest with 'Geçersiz durum geçişi'
  });

  it('I-5: CANCELLED is terminal — no further transitions', async () => {
    // arrange: order in CANCELLED
    // for each status in [PENDING, PREPARING, READY, SERVED, PAID, CANCELLED]:
    //   act: PATCH /orders/:id/status { status }
    //   assert: 400 (CANCELLED is terminal); same-state CANCELLED is no-op only
  });

  it('I-9: PREPARING transition stamps preparingAt', async () => {
    // arrange: order in PENDING
    // act: PATCH .../status { status: PREPARING }
    // assert: order.preparingAt is set (within 1s of now)
  });

  it('F-O2: payment cannot force PENDING → PAID without passing through PREPARING/SERVED', async () => {
    // arrange: order in PENDING, no items prepared
    // act: POST /orders/:id/payments { amount: finalAmount }
    // assert: either rejected (preferred) OR the order's status path is recorded for audit
  });
});

describe('orders — concurrency (M10, F-O3, F-O7)', () => {
  it('M10: same-idempotencyKey split-bill returns the same payment set', async () => {
    // arrange: order with finalAmount = 100, idempotencyKey = "k1"
    // act: Promise.all([splitBill(...,k1), splitBill(...,k1)])
    // assert: only one set of payments persisted; both responses identical
    //   (requires schema migration: partial unique on (orderId, idempotencyKey))
  });

  it('F-O3: concurrent status writes — last-write-wins is bounded by validateTransition', async () => {
    // arrange: order in READY
    // act: Promise.all([
    //   updateStatus(id, SERVED),
    //   updateStatus(id, CANCELLED),
    // ])
    // assert: final status is one of {SERVED, CANCELLED}; never an invalid intermediate;
    //   stock-deduction or stock-reversal ran exactly once for the winning transition
  });

  it('F-O7: same-idempotencyKey order create returns the same order', async () => {
    // arrange: idempotencyKey = "order-k1"
    // act: Promise.all([createOrder(..., k1), createOrder(..., k1)])
    // assert: count(orders WHERE tenantId = T AND idempotencyKey = 'order-k1') === 1
    //   (requires schema migration: optional idempotencyKey + partial unique)
  });
});

describe('orders — refund and stock invariants (I-10, I-11, F-O5, F-O6)', () => {
  it('I-11: refund of last covering payment moves order out of PAID', async () => {
    // arrange: order finalAmount = 50; single payment of 50 → PAID
    // act: PATCH /payments/:id/status { status: REFUNDED }
    // assert: order.status === 'CANCELLED'; order.paidAt === null;
    //   customer.totalSpent decremented by 50; customer.totalOrders -= 1
  });

  it('I-10 + F-O5: refund of a PAID order reverses ingredient deductions', async () => {
    // arrange: order with stockTracked product; complete flow → PAID with stockDeducted=true
    // act: refund the covering payment
    // assert: StockMovement of type IN (reversal) exists for each consumed item
  });

  it('F-O6: refund > customer.totalSpent emits a Sentry warning before clamping', async () => {
    // arrange: customer.totalSpent = 10 (manipulated to simulate audit drift), refund 20
    // act: PATCH /payments/:id/status { status: REFUNDED }
    // assert: customer.totalSpent === 0 (clamped); Sentry captures a 'refund_exceeds_total_spent' event
  });
});
```

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1` *(create two tenants → attempt cross-tenant access via every endpoint → assert zero leaks)*. The orders controller surface has 8 endpoints (`POST /orders`, `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id`, `PATCH /orders/:id/status`, `POST /orders/:id/approve`, `DELETE /orders/:id`, `POST /orders/transfer-table`, `POST /orders/sync-table-statuses`, `GET /orders/group-bill-summary/:groupId`) plus 3 payment endpoints (`POST /orders/:orderId/payments`, `GET /orders/:orderId/payments`, `POST /orders/:orderId/payments/split`) — every one of them needs a cross-tenant negative test.
