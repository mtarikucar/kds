# `payments` — Deep Review (2026-05-11)

**Tier:** 1
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/orders/services/payments.service.ts` (595 LOC), `backend/src/modules/orders/controllers/payments.controller.ts`, `backend/src/modules/orders/dto/create-payment.dto.ts`, `backend/src/modules/orders/dto/split-bill.dto.ts`, payments-related entries in `backend/prisma/schema.prisma`, payments migrations.
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — see §2 Money-path correctness (M1, M2, M5, M10), §4.6 payments rows, §11.1 dropped "refund auth bypass".

---

## 1. Health & summary

🟡 **yellow.**

This file is the **money-precision heart of the codebase**: every dollar that enters the system passes through `PaymentsService.create` or `PaymentsService.splitBill`, and every refund passes through `PaymentsService.updateStatus`. Since the 2026-04-27 audit, the single-payment idempotency story has been **substantially hardened** — `idempotencyKey` is now persisted on `Payment` (schema `:626`), a partial unique index dedupes non-null keys (`payments_orderId_idempotencyKey_notnull_key`, migration `20260420180000`), and the `create()` path has both a fast-path lookup (`:62-78`) and a P2002 race-loser recovery (`:253-280`). The remaining risk concentrates in three places: **(a)** the `Number(...)` conversions still in use on the comparison path — `payments.service.ts:166-167, 233, 444-446, 479` — which is the **M1 finding still live**; **(b)** the split-bill tolerance check on JS numbers (`:451`, **M2 still live**); **(c)** split-bill writes **do not accept** an idempotency key at all (`:412-533`, **M10 only half-fixed**). Refund anomaly detection (>totalSpent) is still missing (`:373-378`). The "refund auth bypass" agent-flag from the previous round was verified false and is preserved in §9.

Health changed from "implicit yellow" to "explicit yellow" because the fixes in flight closed two of the four worst hazards (single-payment idempotency, refund-side order rollback) but the split-bill path remains exposed.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/orders/services/payments.service.ts` (595 LOC) — `create()`, `findByOrder()`, `updateStatus()` (including REFUNDED side effects), `splitBill()`, `getGroupBillSummary()`, `VALID_PAYMENT_TRANSITIONS` map.
- `backend/src/modules/orders/controllers/payments.controller.ts` (62 LOC) — route wiring, guard chain, role gates.
- `backend/src/modules/orders/dto/create-payment.dto.ts` (45 LOC) — validation, idempotencyKey length cap.
- `backend/src/modules/orders/dto/split-bill.dto.ts` (73 LOC) — SplitType enum, SplitPaymentEntry, SplitBillDto.
- `backend/prisma/schema.prisma:619-649` — Payment model, indexes, comment about partial-unique migration.
- `backend/prisma/migrations/20260420090000_payments_tenant_idempotency_orders_indexes/migration.sql` — initial idempotency + tenant column.
- `backend/prisma/migrations/20260420180000_tenant_fks_and_partial_uniques/migration.sql` — partial-unique index on `(orderId, idempotencyKey) WHERE idempotencyKey IS NOT NULL`.
- `backend/src/common/constants/order-status.enum.ts` — `PaymentMethod`, `PaymentStatus` enums (note: there is **no Prisma enum** — both are TypeScript-only and stored as raw strings).

**Skimmed only:**
- `backend/src/modules/orders/services/orders.service.ts:408-450` — `findOne()` used by `payments.service.ts:52, 301, 330` for tenant pre-check.
- `backend/src/modules/accounting/services/sales-invoice.service.ts:19` (`createFromOrder` signature) — called from the auto-invoice block at `payments.service.ts:287, 520`.

**Skipped:**
- Stock deduction path (`StockDeductionService`) — out-of-band trigger on order status change, comment at `payments.service.ts:201-202, 489-491` is explicit; reviewed in the orders deep-dive instead.
- KDS gateway emit calls — emitted from `orders.service.ts` (e.g., `:747` `emitOrderStatusChange`), NOT from `payments.service.ts`. Cross-referenced for §6.
- Refund / cancellation reporting (z-report `totalRefunds` aggregation) — accounting concern; reviewed in `z-reports.md`.

---

## 3. Business-logic invariants

The contract this feature is responsible for keeping. Each row is **testable** — a property an integration test could assert.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | Σ `Payment.amount` for an order where `status=COMPLETED` ≤ `order.finalAmount + 0.01` (1-cent tolerance) | `payments.service.ts:117-124` (Decimal path); `payments.service.ts:451` (split-bill, JS-number path) | ❌ none | overcharge customer; revenue inflation; audit drift |
| I-2 | A payment is **idempotent on `(orderId, idempotencyKey)`** when a non-null key is supplied | `payments.service.ts:62-78` (fast-path), `:253-280` (P2002 recovery); DB-side partial unique `payments_orderId_idempotencyKey_notnull_key` (migration `20260420180000:24-26`) | ❌ none | duplicate charge from client retry |
| I-3 | Refunding a `COMPLETED` payment that drops `Σ completed payments < order.finalAmount` flips order back from `PAID` to `CANCELLED` atomically | `payments.service.ts:345-396` (`$transaction` wrapping payment update + order update + customer stat rollback) | ❌ none | order stuck as `PAID` with no cash, customer lifetime spend inflated, z-report drifts |
| I-4 | Refund rollback decrements `customer.totalSpent` by exactly the refunded payment amount, clamped at zero, and recomputes `averageOrder` consistently | `payments.service.ts:368-391` | ❌ none | customer-stats drift; loyalty miscalculation |
| I-5 | A payment cannot be created for an order whose `status` is `PAID`, `CANCELLED`, or `PENDING_APPROVAL`-with-`requiresApproval` | `payments.service.ts:94-108` (inside tx), `:422-428` (split-bill pre-check) | ❌ none | post-cancellation charges; bypass of approval gate |
| I-6 | Tenant isolation: every payment read/write filters by `tenantId` and goes through `OrdersService.findOne(orderId, tenantId)` first | `payments.service.ts:52, 86, 301, 330, 414-416, 432-433` | ❌ none | cross-tenant data leak / cross-tenant payment write |
| I-7 | A `Payment.status` transition follows the static `VALID_PAYMENT_TRANSITIONS` map (`PENDING → {COMPLETED, FAILED}`; `COMPLETED → REFUNDED`; `FAILED → {}`; `REFUNDED → {}`) | `payments.service.ts:310-315, 333-339` | ❌ none | illegal status writes (e.g., un-refunding a payment) |
| I-8 | Σ split-bill amounts in one request ≤ `remaining` (`finalAmount − alreadyPaid`) + 0.01 tolerance | `payments.service.ts:444-455` | ❌ none | systematic overpayment across N parts |
| I-9 | When an order becomes fully paid, the associated table is freed **only if no other non-PAID/non-CANCELLED orders remain on it** | `payments.service.ts:205-223, 493-508` | ❌ none | table prematurely flipped to AVAILABLE while another order is still open |
| I-10 | `paidAt` is set on the `Payment` row when status becomes `COMPLETED` and cleared (null) when it becomes `REFUNDED` | `payments.service.ts:135, 349, 401-404` | ❌ none | reporting on paid-at can include refunded rows; cash drawer reconciliation drifts |
| I-11 | Decimal precision is preserved end-to-end on the **comparison** path (the path that decides whether to flip order → PAID) | **VIOLATED** at `payments.service.ts:166-170` and `:444-446, 479-480` (Number conversion) | ❌ none | sub-cent under/overpayment edge cases — see §5 |

> Note: I-11 is the invariant the feature *should* keep but actively does not — it is enforced on the **single-payment-overage** check (`:117-124`, Decimal) but **broken** on the **fully-paid?** check (`:166-170`, Number) and on the entire **split-bill tolerance** comparison (`:444-455`, Number).

---

## 4. State machine

**Status enum:** `backend/src/common/constants/order-status.enum.ts:30-35` — values `PENDING`, `COMPLETED`, `FAILED`, `REFUNDED`. Stored as raw `String` in Postgres (`schema.prisma:623`), defaulting to `"PENDING"`. There is **no Prisma enum** — the type-safety is TypeScript-only.

**Transition map (source of truth):** `payments.service.ts:310-315`.

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `(new) → COMPLETED` | `POST /orders/:id/payments` body | `payments.service.ts:94-108, 113-124` | **yes, when `idempotencyKey` supplied** (`:62-78, 253-280` + partial unique index) | If Σ COMPLETED ≥ `order.finalAmount`: order → `PAID`, `paidAt` set, table → `AVAILABLE` (if no sibling orders), customer linked/created, customer stats incremented, **auto-invoice generation** (`:282-292`). Stock deduction handled out-of-band by `StockDeductionService`. |
| `(new) → COMPLETED` (split) | `POST /orders/:id/payments/split` | `payments.service.ts:422-455` | **no** — split-bill path accepts no idempotency key (**M10 still live on this branch**) | Same as above when fully paid; multiple `Payment` rows created in single tx (`:458-471`). Customer stats NOT updated by split path. Customer phone field on DTO is unused by `splitBill` (validation accepts it but service ignores it — see F-7 below). |
| `PENDING → COMPLETED` | `PATCH ...status` (status update endpoint not in this file's controller — search the codebase for `updateStatus` mounting before relying on this) | `payments.service.ts:317-405`, transition table `:311` | no — no idempotency guard on the `updateStatus` write | Sets `paidAt = new Date()` (`:403`). Does NOT recompute order/table/customer state — those side effects are only on the initial `create()` path. |
| `PENDING → FAILED` | `updateStatus` | `payments.service.ts:311, 333-339` | no | Sets `paidAt = null` (`:403-404`). No other rollback (order remains in pre-PAID state). |
| `COMPLETED → REFUNDED` | `updateStatus` | `payments.service.ts:312, 345-396` | **no idempotency key** (race-prone — see §6) | Inside `$transaction`: payment.status → REFUNDED, paidAt cleared; if Σ remaining COMPLETED < `order.finalAmount` AND order.status === PAID → order → `CANCELLED`, `paidAt = null`; customer.totalOrders−1 (clamped ≥ 0); customer.totalSpent −= refundedAmt (clamped ≥ 0); customer.averageOrder recomputed. Note: side effects fire only on **the first refund that drops the order below fully-paid**; subsequent refunds on the same order skip (order already CANCELLED). |
| `FAILED → *` | n/a | `:313` empty array | terminal | none |
| `REFUNDED → *` | n/a | `:314` empty array | terminal | none |

**Forbidden transitions** (must be guarded; flag any unguarded ones in §7):
- `COMPLETED → COMPLETED` — implicitly blocked by the transition map (`COMPLETED → {REFUNDED}` only).
- `REFUNDED → COMPLETED` — terminal; blocked.
- `COMPLETED → PENDING` / `COMPLETED → FAILED` — blocked.
- `(new) → COMPLETED` on an order already `PAID` — explicitly rejected at `:94-96` (single) and `:422-424` (split).
- `(new) → COMPLETED` on `CANCELLED` order — rejected at `:99-101` and `:426-428`.
- `(new) → COMPLETED` on `PENDING_APPROVAL` order requiring approval — rejected at `:104-108`. **Split-bill does NOT check this** (see F-5).

**Transitions that should be idempotent but aren't:**
- `COMPLETED → REFUNDED` via `updateStatus` (`:345-396`) has no idempotency key — a double-tap of the refund button could race two transactions, both observe `status=COMPLETED`, both write REFUNDED, both attempt the customer stat decrement. The Decimal clamp at `:375-378` saves `totalSpent` from going negative, but `totalOrders` is decremented twice (`:374`, `Math.max(0, cust.totalOrders - 1)` runs twice with the same observed `cust.totalOrders` only if read inside vs. outside the tx; here `findUnique` at `:369` happens inside the tx, so concurrent refunds could both read the same baseline and both decrement, resulting in `totalOrders` off by one). **Flagged as F-3.**
- `(new) → COMPLETED` on split-bill — flagged as F-2 (M10 carry-over).

---

## 5. Money & precision audit

This is the centerpiece of the file. **Reproduced via:**
```
grep -n 'Number(\|parseFloat(\|toNumber()\|\.toNumber()' backend/src/modules/orders/services/payments.service.ts
```

### Decimal entry points (where `Prisma.Decimal` first appears in this flow):
- `payments.service.ts:117` — `new Prisma.Decimal(existingPaid._sum.amount ?? 0)` — sum of completed payments for the order (single-payment overage check).
- `:118` — `new Prisma.Decimal(order.finalAmount)` — the order's final amount; `Decimal(10,2)` per `schema.prisma:504`.
- `:120` — `new Prisma.Decimal(createPaymentDto.amount)` — the *incoming* number is upgraded to Decimal **for the overage comparison** (good). But the **same** value is then written verbatim into `Payment.amount` at `:129` via Prisma's default-coercion path. Prisma will accept a `number` and round/format to `Decimal(10,2)` — for values up to ±9_999_999.99 this is safe; for values requiring more than 15 significant decimal digits (impossible here given `@db.Decimal(10,2)`) it would silently round. **No precision-loss risk in practice for two-decimal currency** but worth knowing.
- `:356-357` — `new Prisma.Decimal(completedSum._sum.amount ?? 0)`, `new Prisma.Decimal(payment.order.finalAmount)` — refund-side comparison.
- `:373` — `new Prisma.Decimal(payment.amount)` — refunded amount.
- `:375-377` — `Prisma.Decimal.max(new Prisma.Decimal(0), new Prisma.Decimal(cust.totalSpent).sub(refundedAmt))` — customer-stat clamp on the refund path.

### Decimal-to-Number conversions (every one is a precision-loss hazard)

| # | Site | Code | Used for | Compared to | Precision-loss risk |
|---|------|------|----------|-------------|---------------------|
| C-1 | `:166` | `const totalPaidAmount = Number(totalPaid._sum.amount \|\| 0);` | The "is the order fully paid?" decision | C-2 (also Number) | **Live M1.** Sum of payment amounts (a Decimal aggregate) is forced to JS `Number`. For two-decimal amounts up to 2^53/100 ≈ 9×10¹³ TRY this is exact, but **mixing this with float arithmetic** in customer stats (C-3) and in the comparison at `:170` produces a result whose equality semantics depend on IEEE-754. The mitigation is that the comparison is `>=`, not `==` — so the order is conservatively flipped to PAID one ULP early at worst. Still: stay in Decimal. |
| C-2 | `:167` | `const orderAmount = Number(order.finalAmount);` | Same `>=` decision | C-1 | Companion to C-1. `order.finalAmount` is `Decimal(10,2)` so values fit exactly in JS Number for any plausible bill, but the fix is mechanical: use `new Prisma.Decimal(...).gte(...)`. |
| C-3 | `:233` | `const newTotalSpent = Number(customer.totalSpent) + orderAmount;` | Customer.totalSpent **write** | (written directly to DB) | **Multi-hop precision loss.** Reads `customer.totalSpent` (Decimal) → forces to Number → adds another Number → writes back. Every payment that pushes a customer over the fully-paid threshold accumulates float drift in `customer.totalSpent`. Over many orders, the reported "lifetime spend" can diverge from Σ payment amounts by sub-cent amounts — invisible to users, but it makes loyalty thresholds non-reproducible. The refund path **correctly** stays in Decimal (`:373-378`); this asymmetry is the bug: forward path floats, reverse path Decimals — they don't round-trip exactly. **Flagged as F-4.** |
| C-4 | `:234` | `const newAverageOrder = newTotalSpent / newTotalOrders;` | Customer.averageOrder write | (written to DB) | Float division on already-float-degraded inputs; same drift family as C-3. |
| C-5 | `:444` | `const orderAmount = Number(order.finalAmount);` | Split-bill remaining-amount calculation | C-6 | **Live M1 sibling on the split path.** |
| C-6 | `:445` | `const alreadyPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);` | Same | C-5 | Reduces multiple Decimals into one Number via repeated float addition — order-of-summation can affect the last bit. With N≤dozen partial payments at two decimals this is invisible but technically non-associative. Use `Prisma.Decimal.sum` style accumulation. |
| C-7 | `:446` | `const remaining = orderAmount - alreadyPaid;` | Split-bill tolerance check (`:451`) | C-8 / 0.01 literal | Float subtract; produces values like `0.30000000000000004` for the canonical `0.3 - 0` pathological case. The `Math.abs(...) > 0.01` guard at `:451` swallows this — that's exactly **M2** still being live. |
| C-8 | `:448` | `const totalSplitAmount = dto.payments.reduce((sum, p) => sum + p.amount, 0);` | Split-bill tolerance check | C-7 / 0.01 | DTO `amount` is `IsNumber()` — already a JS number on the wire, so this is float-on-float; no Decimal involved. The **tolerance comparison** at `:451` is `if (totalSplitAmount > remaining && Math.abs(totalSplitAmount - remaining) > 0.01)` — **flagged as F-1 (M2 carry-over).** |
| C-9 | `:479` | `const totalPaidAmount = Number(totalPaid._sum.amount \|\| 0);` | Split-bill "is order fully paid?" check | C-5 (`orderAmount`) | Same pattern as C-1. |
| C-10 | `:480` | `const isFullyPaid = totalPaidAmount >= orderAmount;` | Order-status flip decision | — | The boolean that drives whether `tx.order.update({status: PAID})` fires. **All this depends on C-9 + C-5.** |
| C-11 | `:563` | `unitPrice: Number(item.unitPrice),` | Response DTO field (`getGroupBillSummary`) | — | Read path only, response shape. **Display-level Number conversion is acceptable** for JSON serialization — but document it: the *bill-summary endpoint is now only for display*, downstream consumers must not feed these numbers back into pricing math. |
| C-12 | `:564` | `subtotal: Number(item.subtotal),` | Response DTO | — | Same as C-11. |
| C-13 | `:567` | `price: Number(m.modifier?.priceAdjustment \|\| 0),` | Response DTO | — | Same as C-11. |
| C-14 | `:572` | `const totalAmount = allOrders.reduce((sum, o) => sum + Number(o.finalAmount), 0);` | Response field `summary.totalAmount` | C-15 (`remainingAmount = totalAmount - totalPaid`) | **Display-only, but exposed as a Σ that the frontend may compare.** Document this is float Σ; advise frontend to treat the response as opaque. |
| C-15 | `:573-575` | `const totalPaid = allOrders.reduce(... + Number(p.amount), 0); ... remainingAmount: totalAmount - totalPaid` | Same | — | Same as C-14. |
| C-16 | `:584` | `finalAmount: Number(o.finalAmount),` | Response | — | Display. |
| C-17 | `:585` | `paidAmount: o.payments.reduce((s, p) => s + Number(p.amount), 0),` | Response | — | Display. |

**17 conversion sites total.** Of these, **C-1, C-2, C-3, C-4, C-5, C-6, C-7, C-8, C-9, C-10 are on the comparison/write path** (10 sites). C-11 through C-17 are response-shape conversions and acceptable but worth documenting.

### Rounding policy + tolerance constants

- **0.01 tolerance (single-payment overage):** `:120` — `new Prisma.Decimal(createPaymentDto.amount).gt(remaining.add('0.01'))`. **Justified** because legacy clients (mobile cash-handling, older POS terminals) submit pre-rounded JS-Number totals that can drift by ±0.005 per rounding step. The single-cent guard absorbs that. Sunset condition: when all client paths confirm submitting Decimal-precision strings (the existing partial unique index + idempotency key makes safe retries cheap), drop the tolerance and require exact equality.
- **0.01 tolerance (split-bill overage):** `:451` — `Math.abs(totalSplitAmount - remaining) > 0.01` on JS Numbers. **Same justification** but **wrong types** — the comparison should be `Decimal.sub(...).abs().gt('0.01')`. **Flagged F-1.**
- **No tolerance** at the fully-paid check (`:170`, `:480`) — strict `>=`. With Number-typed inputs this means an order whose Σ payments is `9.999999...` instead of `10.00` (e.g., from a sum of `3.33 + 3.33 + 3.34`) would **not** be flagged fully-paid. In practice all current writers pass Decimal-derived numbers that round trip cleanly at two decimals, but the asymmetry is worth knowing: the **enter-PAID** boundary has no tolerance while the **enter-payment** boundary does.

### Sum-of-parts reconciliation

- **Σ Payment.amount where status=COMPLETED vs Order.finalAmount:** asserted at `:166-170` (single-payment path) and `:474-480` (split-bill path) **using Number**. Decimal version asserted at `:356-362` on the refund-rollback side.
- **Σ split-bill entries vs remaining:** asserted at `:451` using Number (F-1).
- **Σ OrderItem subtotals vs Order.totalAmount:** **NOT asserted in this service** — that invariant belongs to `orders.service.ts`. Cross-link: `orders.md` should own that one.
- **Σ Payment.amount across all of an order's REFUNDED + COMPLETED ≤ totalAmount:** **NOT asserted anywhere.** If a refund flow ever creates a *new* "refund payment row" (it doesn't today; today it flips an existing payment's status), this would be needed. Worth tracking as a future invariant.

---

## 6. Concurrency hazards

### Critical sections + lock strategy

- `payments.service.ts:83-252` — `this.prisma.$transaction(async (tx) => { ... })` for single-payment create. **No explicit isolation level specified** (Prisma defaults to the connection-pool default, typically `READ COMMITTED`). The transaction holds row locks on the `Order` row (via `findFirst` + later `update`), the `Customer` row (via `findFirst` / `create` / `update`), and the `Table` row (via the conditional `update`). The aggregate `tx.payment.aggregate({where: orderId, status: COMPLETED})` at `:113-116` and `:156-164` is **NOT under SELECT FOR UPDATE** — two concurrent payments could both observe the same `alreadyPaid` baseline.
- `payments.service.ts:431-513` — `$transaction` for split-bill. Same isolation defaults; same aggregate-without-lock pattern at `:445` (over `order.payments` array) and `:474-477` (aggregate inside tx).
- `payments.service.ts:346-396` — `$transaction` for refund-side rollback. Same defaults.

**Idempotency primary key (single-payment path):**
- **Present at:** `payments.service.ts:62-78` (fast-path findFirst), `:127-141` (write with `idempotencyKey`), `:253-280` (P2002 recovery). DB-side: `payments_orderId_idempotencyKey_notnull_key` (migration `20260420180000:24-26`).
- **Working as a tri-layer defense** — the fast-path catches the warm-cache case, the partial unique index catches the cold race, the P2002 handler converts the loser's error into the winner's response. **This is the gold-standard pattern in this codebase.**

### Race windows still open

1. **R-1 — Concurrent single-payment writes without idempotency key.**
   *Sketch:* Order has `finalAmount = 10.00`. Request A POSTs `amount=8` with no idempotencyKey, Request B POSTs `amount=8` with no idempotencyKey. Both pass the `:113-124` overage check independently (each observes `alreadyPaid=0`, `remaining=10`, `8 ≤ 10.01`), both insert `Payment` rows. Final: `Σ payments = 16` for a `10.00` bill — **3 USD of overpayment, no fail.** The fully-paid check at `:170` fires on whichever transaction commits second (or both — see R-2).
   *Where:* `payments.service.ts:113-124` (overage check without row lock on Order).
   *Severity:* High Cor.
   *Fix:* `SELECT ... FOR UPDATE` on the Order row inside the tx, or `Serializable` isolation, or require idempotencyKey for all non-cash methods.

2. **R-2 — Order-status flip race (both transactions observe ΣPayments ≥ finalAmount).**
   *Sketch:* Following R-1, when both A and B's inserts complete, each then re-aggregates at `:156-164`. Both see `totalPaid = 16 ≥ 10`. Both then run the `tx.order.update({status: PAID, paidAt: now})` at `:191-199` — two writes to the same row. PostgreSQL will serialize these (row-lock implicit on UPDATE), so the final paidAt is the later one. **No data corruption, but if A's customer phone differs from B's customer phone, whichever commits last wins** — the order is linked to one customer effectively at random.
   *Where:* `:191-199`.
   *Severity:* Medium Cor.
   *Fix:* same as R-1 — row-lock on Order at the top of the tx.

3. **R-3 — Split-bill idempotency missing entirely.**
   *Sketch:* Client POSTs `/split` with 4 split entries totalling 10.00. Network blip, client retries the same request. No idempotency key on the DTO (`split-bill.dto.ts:44-66` — no `idempotencyKey` field). Both requests pass the `:451` overage check (each observes `alreadyPaid=0`), both insert 4 payment rows. Final: 8 payment rows totalling 20.00 against a 10.00 bill.
   *Where:* `payments.service.ts:412-533`, `dto/split-bill.dto.ts:44-66`.
   *Severity:* High Cor.
   *Fix:* Add `idempotencyKey` to `SplitBillDto`, persist on each child `Payment`, rely on the existing partial unique index. **This is M10 still live for the split path.**

4. **R-4 — Refund double-tap.**
   *Sketch:* User clicks "Refund" twice in rapid succession. Both requests reach `updateStatus(paymentId, REFUNDED, ...)`. Both pass the `:333-339` transition check (each reads `status=COMPLETED`). Both enter the `$transaction` at `:346`. Inside the tx, the `tx.payment.update` at `:347-350` serializes via row-lock (Postgres-implicit). The **second** UPDATE finds `status=REFUNDED` (already changed) but **`prisma.update` does not filter by status** — it filters by `id` only — so the second update silently succeeds, **re-running all the side effects** (`:352-393`): customer.totalOrders decremented again, table-status check re-run, etc.
   *Where:* `:346-396`.
   *Severity:* High Cor.
   *Fix:* `tx.payment.updateMany({ where: { id, status: COMPLETED }, data: { status: REFUNDED, paidAt: null } })` and reject if `count === 0`. Mirror the atomic-consume pattern at `auth.service.ts:691-721`.

5. **R-5 — Auto-invoice failure after payment committed.**
   *Sketch:* Payment transaction commits at `:252`; `await this.salesInvoiceService.createFromOrder(orderId, tenantId)` at `:287` throws (DB lock contention, accounting-sync deadlock, etc.). The catch at `:289-291` logs and swallows. Order is now `PAID` (status committed); no `SalesInvoice` row exists; the next time the customer pays a different order, the invoice numbering will skip nothing — but the **revenue side of the books has no entry for this order**. Z-report runs at end-of-day; either net-sales drifts or the report fails reconciliation depending on how it sources data.
   *Where:* `:282-292` (single-payment), `:515-525` (split-bill — also logs only via `console.error`).
   *Severity:* High Cor — this is **M5 still live**.
   *Fix:* bounded retry (e.g., 3 attempts with exponential backoff) → Sentry `REVENUE_SYNC_FAILED` event with `{tenantId, orderId, paymentId}` → optionally a deferred job in an outbox table. Do NOT keep this swallowed.

6. **R-6 — KDS event vs commit ordering.**
   *Sketch:* `payments.service.ts` does **not** emit any KDS event directly; the relevant emits live in `orders.service.ts` (`emitOrderStatusChange` at `:747`, etc.). When `payments.service.ts:191-199` flips the order to PAID via `tx.order.update`, there is **no socket emit** from this file, and no hook that calls back into `orders.service.ts` to emit. **The KDS does not receive a payment-completed event** beyond whatever the frontend polls. Whether that's a defect depends on the product story (e.g., is the kitchen supposed to know an order was paid? Probably not — kitchen state is `READY/SERVED`). **Documented for awareness, not flagged as a finding.**
   *Where:* `payments.service.ts:191-199, 484-487` — order-status update inside payment tx.
   *Severity:* Info.

7. **R-7 — Late-payment write after order COMPLETED via cancellation.**
   *Sketch:* Order is CANCELLED (e.g., walkout). Refund flow at `:362-365` moves PAID → CANCELLED. A delayed payment write from a flaky network finally arrives — it now hits the tx, the `tx.order.findFirst` at `:85` returns the order in `status=CANCELLED`, the `:99-101` guard throws `BadRequestException`. **Correctly handled.** Symmetric case: a payment write that wins the race against a cancellation is also blocked because cancellation is enforced in `orders.service.ts` (which would need to be cross-checked separately).
   *Where:* `:99-101`.
   *Severity:* none — verified handled.

### Idempotency keys

- **Present at:** `payments.service.ts:127-141` (single-payment write — `idempotencyKey` field on Payment). Persisted to DB. Partial unique index on `(orderId, idempotencyKey) WHERE idempotencyKey IS NOT NULL`.
- **Missing where needed:**
  - **Split-bill writes** (`:412-533`) — `SplitBillDto` has no `idempotencyKey` field. **F-2.**
  - **Refund (`updateStatus → REFUNDED`)** — no idempotency key; reliance on transition map but the map doesn't catch a double-tap of the SAME transition (R-4). **F-3.**

---

## 7. Findings

Severity: Critical → High → Medium → Low → Info. Dimension: Sec / Cor / Arch / Perf. Verified findings unmarked; agent-reported findings carry their original *(unverified)* until spot-checked.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Cor | `payments.service.ts:444-455` | **M2 still live.** Split-bill tolerance comparison runs on JS Numbers: `Number(order.finalAmount)`, `+ Number(p.amount)`, then `Math.abs(totalSplitAmount - remaining) > 0.01`. Float subtraction introduces sub-cent drift; `Math.abs(...) > 0.01` is the wrong comparator (it allows EITHER side to overshoot by ≤ 1¢, not just rounding noise). Verified by reading `:444-455` — code is exactly as M2 described. | Replace with `new Prisma.Decimal(totalSplit).sub(remainingDec).abs().lte('0.01')`. Keep totals as `Prisma.Decimal` end-to-end. Add a Decimal sum helper to avoid scattering this pattern. |
| F-2 | High | Cor | `payments.service.ts:412-533`, `dto/split-bill.dto.ts:44-66` | **M10 still live for the split path.** `SplitBillDto` has no `idempotencyKey` field; `splitBill()` never passes one when creating its child payments. A retried POST creates duplicate payments. Single-payment endpoint had the same bug; it was fixed via `idempotencyKey` + partial unique index in migration `20260420180000`. **Split path was missed in that migration's adoption.** | Add `idempotencyKey?: string` to `SplitBillDto`. Either (a) require one key for the whole split and store it on every child `Payment` (then add `Σ children-with-same-key` semantics to the partial unique), or (b) require an array of per-entry keys. Option (a) is simpler — store the same key on all N child rows and key the partial unique on `(orderId, idempotencyKey, sequenceInSplit)` or accept that one retry returns N rows. |
| F-3 | High | Cor | `payments.service.ts:346-350` | **Refund double-tap race.** `updateStatus → REFUNDED` does `tx.payment.update({where:{id}, data:{status: REFUNDED}})` — filter is by `id` only, not by current status. Two concurrent refund requests both pass the in-memory transition check at `:333-339` (each reads `status=COMPLETED` from the pre-tx find at `:318`), both enter the tx, both `update` succeeds, customer stats decremented twice. | Switch to `tx.payment.updateMany({where:{id, status: COMPLETED}, data:{...}})` and bail if `count === 0`. Mirror `auth.service.ts:691-721` atomic-consume pattern. |
| F-4 | High | Cor | `payments.service.ts:233-241` | **Asymmetric customer-stat math.** Forward path uses JS Numbers: `Number(customer.totalSpent) + orderAmount` (where `orderAmount` is itself a `Number(order.finalAmount)`). Refund path uses Decimal: `new Prisma.Decimal(cust.totalSpent).sub(refundedAmt)` (`:373-378`). The two paths don't round-trip exactly — a customer who pays then refunds then re-pays ends with `totalSpent` drifted by sub-cent amounts. Over hundreds of cycles, loyalty thresholds become non-reproducible. **This is the same family as M1 but applied to customer state, not order state.** | Replace `:233-234` with `Prisma.Decimal` arithmetic. Use `new Prisma.Decimal(cust.totalSpent).add(orderAmtDec)` for `newTotalSpent`, and `newTotalSpent.div(newTotalOrders)` for `newAverage`. |
| F-5 | High | Cor | `payments.service.ts:412-428` | **Split-bill does not check `requiresApproval`.** `create()` at `:104-108` rejects a payment for an order in `PENDING_APPROVAL` with `requiresApproval=true`. `splitBill()` only checks `PAID` and `CANCELLED` (`:422-428`). A delivery-platform order that requires approval can be split-paid before approval, bypassing the approval gate. | Add `if (order.requiresApproval && order.status === OrderStatus.PENDING_APPROVAL) throw new BadRequestException(...)` to the split-bill pre-check and the in-tx re-fetch. |
| F-6 | High | Cor | `payments.service.ts:373-378` | **M (CODE_REVIEW.md §4.6 row 1) still live: refund amount > totalSpent anomaly is clamped, not alerted.** `Prisma.Decimal.max(new Prisma.Decimal(0), new Prisma.Decimal(cust.totalSpent).sub(refundedAmt))` — if `refundedAmt > cust.totalSpent`, the result clamps to zero **silently**. This indicates corrupt state (the refund amount exceeds what the customer was ever charged). Should emit a Sentry-level error with full context before clamping. | Add `if (refundedAmt.gt(new Prisma.Decimal(cust.totalSpent))) this.logger.error('REFUND_EXCEEDS_TOTALSPENT', {customerId, refundedAmt, totalSpent: cust.totalSpent, paymentId, orderId})` + Sentry capture before the clamp. Keep the clamp (it's the right runtime behavior); just don't swallow the anomaly. |
| F-7 | High | Cor | `payments.service.ts:282-292, 515-525` | **M5 still live — auto-invoice generation swallows exceptions.** The `await this.salesInvoiceService.createFromOrder(orderId, tenantId)` is now correctly awaited (the original M5 fear of "fire-and-forget" is overstated — it's actually awaited), but the surrounding try/catch logs to `this.logger.error` / `console.error` and returns the payment as successful. Order is PAID, no invoice exists, accounts drift. Split-bill path additionally uses `console.error` instead of the Logger. | Bounded retry (3 attempts, exponential backoff); on terminal failure, write to a `REVENUE_SYNC_FAILED` outbox table AND emit a Sentry capture with `level: error`. The HTTP response can still be 201 (payment succeeded) but the side-effect failure must be visible. |
| F-8 | Medium | Cor | `payments.service.ts:113-124` | **Single-payment overage check has no row-lock on Order.** Two concurrent payments without idempotency keys can both pass the `:120` Decimal overage check, both insert. Idempotency keys mitigate this for clients that use them, but the DTO leaves the key optional — so the race remains for any client that doesn't. | Either `SELECT ... FOR UPDATE` on the order row at the top of the tx (`:85-87`), or `Serializable` isolation, or — minimally invasive — require `idempotencyKey` for all non-CASH methods at the DTO level. |
| F-9 | Medium | Cor | `payments.service.ts:451` | **Tolerance comparator is too permissive on split-bill overpayment.** `if (totalSplitAmount > remaining && Math.abs(totalSplitAmount - remaining) > 0.01)` reads as "fail only if overpayment AND magnitude > 1¢" — but written this way, **any** overpayment ≤ 1¢ passes, even a systematic 1¢ overshoot. The comment at `:450` says "Allow small rounding tolerance (1 cent) but prevent systematic overpayment" — but the code doesn't actually distinguish rounding from systematic. | Re-read the intent: rounding tolerance should apply *only* when the entries sum to within 1¢ of `remaining`, not when the entries sum to `remaining + 0.99`. The Decimal fix from F-1 will tighten this naturally. |
| F-10 | Medium | Cor | `payments.service.ts:112-124` | **§4.6 row 2 (CODE_REVIEW.md): 1-cent overage tolerance is undocumented as a sunset condition.** The comment at `:119` says "1-cent rounding tolerance for float-legacy callers" — fine, but there's no migration plan or feature flag. Once all clients confirm Decimal-precision submission, drop the tolerance. | Add a `// TODO(sunset): remove tolerance once all client SDKs use Decimal serialization. Track ticket #XXX.` Track which client paths still use floats. |
| F-11 | Medium | Cor | `payments.service.ts:317-330` | **Pre-tx find for refund is not race-safe.** The `findUnique` at `:318` reads the payment outside any tx. By the time the REFUND tx at `:346` runs, the payment could have been refunded by a parallel request (see F-3). The pre-tx find is purely a tenant-check shortcut. | Move the tenant verification + status read inside the `$transaction` and use the atomic-consume pattern from F-3's fix. |
| F-12 | Medium | Arch | `payments.service.ts:283-292, 516-525` | **Logger inconsistency.** Single-payment path uses `this.logger.error(...)` (NestJS Logger). Split-bill path uses `console.error(...)` (raw console). Same module, same error case, different observability. | Use `this.logger.error` in both. |
| F-13 | Medium | Cor | `payments.service.ts:412-533` (split-bill `customerPhone`) | **SplitBillDto.customerPhone is accepted but never used.** `split-bill.dto.ts:62-65` declares `customerPhone?: string` (with API description "Customer phone for linking"). `splitBill()` does not link a customer, update customer stats, or persist the phone anywhere. Single-payment path does. | Either implement customer linking on the split path (mirror `:171-189, 226-246`), or remove the field from the DTO. Silent-ignore of a documented field is a contract bug. |
| F-14 | Medium | Cor | `payments.service.ts:171-189` | **Customer find/create inside payment tx can race.** Two concurrent payments for different orders, same `customerPhone`, both observe no customer (`tx.customer.findFirst` at `:175-177` returns null inside their respective transactions), both `tx.customer.create` at `:180-186`. Without a unique constraint on `(tenantId, phone)`, two Customer rows are created. The schema currently shows `Customer.phone` without a tenant-scoped unique (verify in `schema.prisma:1163-1216`). | Add `@@unique([tenantId, phone])` on Customer, then catch P2002 and re-fetch. |
| F-15 | Low | Perf | `payments.service.ts:535-594` (`getGroupBillSummary`) | **§4.6 row 4 (CODE_REVIEW.md): N+1 flatMap, no pagination.** `tables.flatMap(t => t.orders).flatMap(o => o.orderItems...)` returns the full Cartesian product of items × orders × tables for the group. No `take` / `skip`. For a large group (10 tables × 20 orders × 10 items each = 2000 rows), this can be a hot path. | Paginate items; cap to e.g. 1000; surface a `truncated: bool` flag. |
| F-16 | Low | Arch | `payments.service.ts:310-315` | **Transition map is `Record<PaymentStatus, PaymentStatus[]>` but PaymentStatus is a TypeScript enum, not a Prisma enum.** A DB-side write with a status string outside the enum (corrupt data, manual SQL, future migration) wouldn't be caught by the type check at `:333-339` because the lookup is `validTransitions = ... || []`, which falls through to "no transitions allowed". Behavior is correct (fails closed) but the error message at `:336-338` would say "Invalid payment status transition: <weird-string> -> X" which is unhelpful for debugging. | Either promote to a Prisma enum (migration), or add an explicit check at the top of `updateStatus` that asserts `payment.status` is in the known set. |
| F-17 | Low | Cor | `payments.service.ts:325-330` | **`updateStatus` checks tenant via `ordersService.findOne(payment.orderId, tenantId)` AFTER fetching the payment by id only.** This is correct (the find throws if cross-tenant), but it does a fresh DB roundtrip for an order we don't need beyond the tenant check. **Spot-checked and confirmed correct** — see §9. | Replace with `if (payment.tenantId !== tenantId) throw NotFoundException` — cheaper, equivalent. Note: the original "refund auth bypass" agent report (preserved in §9) was wrong about the *correctness*; the optimization is the only point. |
| F-18 | Info | Sec | `payments.service.ts:283-287` | **Auto-invoice generation runs after the payment tx commits but inside the same request lifecycle.** A slow accounting-sync can stretch the HTTP response. Combined with F-7, the request could 200 with a logged but invisible failure. Not a defect; document in §8. | n/a (informational) |

---

## 8. What's solid (positive findings)

- `payments.service.ts:62-78, 127-141, 253-280` — **Tri-layer idempotency on single-payment create**: in-memory fast-path lookup, DB-side partial unique index, P2002 race-loser recovery. This is the **gold-standard idempotency pattern** in this codebase — `subscriptions/services/subscription-scheduler.service.ts` (M9) should adopt the same shape, and the split-bill path (F-2) should as well.
- `payments.service.ts:117-124` — **Decimal-typed overage check (single-payment)**: `new Prisma.Decimal(...)` end-to-end, with `.gt(remaining.add('0.01'))`. This is exactly what the **rest of the file should look like** (and what M1 is asking the comparison-path conversions to become).
- `payments.service.ts:345-396` — **Atomic refund rollback in `$transaction`**: payment status, order status, customer stats all updated together; clamp at `:374, 375-378` keeps `totalOrders` and `totalSpent` non-negative even under corrupt state. The Decimal arithmetic on the refund side (`:373-378`) is the model for what F-4 asks the forward path to look like.
- `payments.service.ts:52, 86, 301, 330, 414-416, 432-433` — **Tenant isolation funnels through `OrdersService.findOne`** as a pre-check, plus tenantId filters on every `tx` query. No raw findUnique on payment id without tenant check.
- `payments.service.ts:204-223, 493-508` — **Table-release guard** (only flip table to AVAILABLE if `count of sibling non-PAID/non-CANCELLED orders == 0`) — handles group-bill / multi-order-per-table cases correctly.
- `payments.service.ts:310-315` — **Explicit transition map** with terminal states (FAILED, REFUNDED) and disallowed reverse transitions. Reads like a state machine spec — easy to audit.
- `payments.service.ts:36-49, 250` — **Sentry tracing** via `withTransaction` and `addBreadcrumb`; per-payment breadcrumbs (`Starting payment creation`, `Payment validation passed`, `Payment completed successfully`) thread tenant + order + amount into spans. Other money-path services should adopt the same pattern.
- `dto/create-payment.dto.ts:36-37` — **`@Length(8, 64)` on `idempotencyKey`** prevents one-byte / multi-megabyte key abuse.
- `schema.prisma:637-647` + migration `20260420180000:21-30` — **Schema-level comment explaining why** the Prisma-native `@@unique` is insufficient and the partial unique is needed. This kind of "future-reader" comment is exactly what protects the invariant from being undone in a later refactor.

---

## 9. Spot-checks performed

**Verified (finding stands):**
- **F-1** confirmed at `payments.service.ts:444-455` — `Number(order.finalAmount)`, `+ Number(p.amount)`, `Math.abs(totalSplitAmount - remaining) > 0.01` exactly matches M2's description.
- **F-2** confirmed at `payments.service.ts:412-533` and `dto/split-bill.dto.ts:44-66` — `SplitBillDto` has no `idempotencyKey` field; the loop at `:458-471` never passes one. M10 verified live for the split path.
- **F-3** confirmed at `payments.service.ts:346-350` — `tx.payment.update({where:{id}, data:{...}})` filters by id only, not by `status: COMPLETED`. A concurrent double-call enters the tx twice.
- **F-4** confirmed at `payments.service.ts:233-234` — forward path uses Number; refund path at `:373-378` uses Decimal. Asymmetry is real.
- **F-5** confirmed at `payments.service.ts:412-428` — split-bill pre-check checks PAID and CANCELLED only; no `requiresApproval` guard.
- **F-6** confirmed at `payments.service.ts:375-378` — the `Prisma.Decimal.max(0, ...)` clamp silently absorbs the anomaly.
- **F-7** confirmed at `payments.service.ts:282-292` (Logger) and `:515-525` (console.error) — try/catch swallows.
- **F-13** confirmed at `dto/split-bill.dto.ts:62-65` and `payments.service.ts:412-533` — `customerPhone` declared but no read path in `splitBill`.
- **M1 (CODE_REVIEW.md §2 row M1)** confirmed at `payments.service.ts:166-167` — exactly as described, `Number(totalPaid._sum.amount || 0)` and `Number(order.finalAmount)`. Folded into the §5 table as **C-1, C-2** and into F-8.

**Dropped (initial report was wrong — preserved as historical record):**

1. **"Refund auth bypass" — `payments.service.ts:325-330` (CODE_REVIEW.md §4.6 spot-check note).**
   Original agent claim: the tenant check happens after the payment is fetched by id, so a request could reference any tenant's payment id.
   Verified at `payments.service.ts:317-330` (current line numbers): `findUnique({where:{id}})` at `:318` returns payment-or-null; `if (!payment) throw new NotFoundException(...)` at `:325-327` fires *before* the tenant check; the tenant check at `:330` (`ordersService.findOne(payment.orderId, tenantId)`) only runs once `payment` is non-null and itself throws on cross-tenant access. **The control flow is correct: a request with a valid payment id but wrong tenant gets `NotFoundException` from the `ordersService.findOne` call (because that service filters by tenantId).** **Drop.** The only optimization opportunity is F-17 — `payment.tenantId !== tenantId` would be cheaper than the round-trip to `ordersService.findOne` — but the *correctness* is intact.

   This dropped finding is preserved here per CODE_REVIEW.md §11.1 — the same agent class of error (pattern-matching on "auth check after lookup") is likely to resurface in future automated audits of this file. Future reviewers: read the full control flow, not just the line numbers.

**Downgraded:**
- **M1 (§2 row 1) — not downgraded.** Still High Cor. Verified live in `:166-167`.
- **M5 (§2 row 5)** — phrasing slightly off in the original: the auto-invoice generation is **awaited**, not strictly fire-and-forget. The defect is the **swallowed catch**, not the absence of await. Severity stays High Cor; finding text updated in F-7.

---

## 10. Recommended tests

The 5+ integration tests that would catch the §3 invariants and §6 race risks. Skeletons only.

```ts
// backend/src/modules/orders/__tests__/payments.integration.spec.ts
describe('payments — money & idempotency invariants', () => {
  // I-1 + R-1
  it('I-1: rejects overage past 1¢ tolerance on single-payment create', async () => {
    // arrange: order finalAmount = 10.00, no prior payments
    // act: POST /payments amount=10.02
    // assert: 400 BadRequestException("Payment amount exceeds remaining (10.00)")
    // act: POST /payments amount=10.01 → 201 (within tolerance)
  });

  // I-2 + tri-layer idempotency
  it('I-2: concurrent same-key retries land exactly one payment', async () => {
    // arrange: order finalAmount=10, idempotencyKey='retry-abc'
    // act: Promise.all([create({amount:10, key:'retry-abc'}), create({amount:10, key:'retry-abc'})])
    // assert: both responses return the same payment.id
    // assert: SELECT count(*) FROM payments WHERE orderId=? AND idempotencyKey='retry-abc' === 1
    // assert: SELECT count(*) FROM payments WHERE orderId=? === 1
  });

  // F-2 / R-3: this MUST FAIL on current code, demonstrating the gap
  it.failing('F-2: split-bill retries do NOT duplicate (currently broken)', async () => {
    // arrange: order finalAmount=10, splitBillDto with 4 entries of 2.50 + idempotencyKey
    // act: Promise.all([splitBill(...), splitBill(...)])
    // assert: SELECT count(*) FROM payments WHERE orderId=? === 4  (currently 8)
  });

  // I-8 + F-1: split-bill tolerance
  it('I-8: split-bill rejects systematic overpayment past 1¢ tolerance', async () => {
    // arrange: order finalAmount=10.00
    // act: splitBill({payments: [{amount: 5.00}, {amount: 5.99}]})  // overage = 0.99
    // assert: 400 BadRequestException
    // After F-1 fix: this passes. Currently with M2/F-1 live, the comparator is wrong.
  });

  // I-3 + R-4: refund + order flip
  it('I-3: refund flips order PAID→CANCELLED when remaining payments < total', async () => {
    // arrange: order finalAmount=10, one payment of 10 COMPLETED, order PAID
    // act: updateStatus(paymentId, REFUNDED)
    // assert: payment.status=REFUNDED, payment.paidAt=null
    // assert: order.status=CANCELLED, order.paidAt=null
    // assert: customer.totalOrders decremented by 1, totalSpent decremented by 10
  });

  // R-4: refund double-tap (MUST FAIL pre-fix)
  it.failing('F-3: refund double-tap should not double-decrement customer stats', async () => {
    // arrange: order PAID, payment COMPLETED, customer.totalOrders=5, totalSpent=50
    // act: Promise.all([updateStatus(REFUNDED), updateStatus(REFUNDED)])
    // assert: exactly one of the calls throws InvalidTransition
    // assert: customer.totalOrders === 4 (decremented exactly once)
    // assert: customer.totalSpent === 50 - paymentAmount (decremented exactly once)
  });

  // F-4: customer-stat round-trip
  it('F-4: pay → refund → repay restores customer.totalSpent to original within 1¢', async () => {
    // arrange: customer totalSpent=0
    // act: pay $10, refund $10, pay $10 again
    // assert: customer.totalSpent === 10.00 EXACTLY (Decimal, no float drift)
  });

  // F-5: split-bill PENDING_APPROVAL gate
  it('F-5: split-bill rejects payment for order requiring approval', async () => {
    // arrange: order with requiresApproval=true, status=PENDING_APPROVAL
    // act: splitBill(...)
    // assert: 400 BadRequestException
  });

  // F-6: refund anomaly logging
  it('F-6: refund > customer.totalSpent emits Sentry-level error then clamps', async () => {
    // arrange: customer.totalSpent=5, refund a payment of 10 (corrupt state)
    // act: updateStatus(REFUNDED)
    // assert: Sentry captureMessage called with REFUND_EXCEEDS_TOTALSPENT
    // assert: customer.totalSpent === 0 (clamped, not negative)
  });

  // I-6 + cross-tenant
  it('I-6: cross-tenant payment access returns NotFound (not the data)', async () => {
    // arrange: create tenantA with order+payment; create tenantB
    // act: as tenantB, GET /orders/:idA/payments
    // assert: 404 NotFoundException (NOT 200 with leaked data)
    // act: as tenantB, POST /orders/:idA/payments
    // assert: 404
    // act: as tenantB, PATCH /payments/:idA/status (REFUNDED)
    // assert: 404
  });

  // R-5 / F-7: auto-invoice failure path
  it('F-7: auto-invoice generation failure surfaces to Sentry, not silent log', async () => {
    // arrange: mock SalesInvoiceService.createFromOrder to throw
    // arrange: order with autoGenerateInvoice=true
    // act: pay full amount
    // assert: payment created, order PAID (HTTP 201)
    // assert: Sentry.captureException called once with tag REVENUE_SYNC_FAILED
    // assert: pending-revenue-sync outbox row exists (after F-7 fix)
  });
});
```

Cross-tenant invariant tests should follow the style from `../CODE_REVIEW.md §3.1` — create two tenants, attempt cross-tenant access via every payments endpoint (`POST /orders/:id/payments`, `GET /orders/:id/payments`, `POST /orders/:id/payments/split`, `PATCH /payments/:id/status`, `GET /orders/group-bill-summary/:groupId`), and assert zero leaks. The `getGroupBillSummary` path is particularly worth checking — it joins through `Table.groupId` and may not enforce the same tenant funnel as `findOne`.
