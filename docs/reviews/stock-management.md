## `stock-management` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/stock-management/services/*.ts`, `backend/src/modules/stock-management/schedulers/stock-alerts.scheduler.ts`, plus the `StockItem` / `StockBatch` / `IngredientMovement` / `StockMovement` models in `backend/prisma/schema.prisma`.
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §4.11 — three Medium seeds (alert fatigue, unbounded raw query, missing pagination).

---

## 1. Health & summary

🟡 yellow

The module owns recipe-driven ingredient deduction, FIFO batch drawdown, purchase-order receiving with weighted-average costing, waste / count adjustments, and hourly low-stock and expiry alerts. Hot paths (deduction, waste, PO receive, count finalize) are demonstrably race-free — every mutation goes through a `$transaction` with either `Serializable` isolation (`stock-deduction.service.ts:109`) or a conditional `updateMany` guard (`stock-deduction.service.ts:84-87`, `waste-logs.service.ts:44-51`, `stock-counts.service.ts:144-147`). The scheduler at `schedulers/stock-alerts.scheduler.ts:28-31` uses the same `pg_try_advisory_lock` pattern as the canonical subscriptions scheduler. Risk concentrates in **read paths and alert UX**: the dashboard, list endpoints, and alert cron all run unbounded `findMany` / raw queries, and the alert cron re-emits the entire low-stock set every hour regardless of whether anything changed — exactly the §4.11 seeds. Health is yellow rather than green because none of the three seeds have been addressed and there are no tests for any invariant in §3.

---

## 2. Scope of this review

**Read end-to-end:**
- `services/stock-alerts.service.ts` (84 LOC) — `checkLowStock` raw query + KDS socket emit; `checkExpiringBatches` Prisma findMany + emit.
- `services/stock-items.service.ts` (115 LOC) — CRUD + `findLowStockItems` raw query + `findExpiringSoon`.
- `services/stock-deduction.service.ts` (300 LOC) — recipe-driven deduction, FIFO batch drawdown, ORDER_REVERSAL.
- `services/purchase-orders.service.ts` (322 LOC) — PO lifecycle, weighted-average cost on receive, cancel-with-reversal.
- `services/stock-counts.service.ts` (185 LOC) — count creation guard, finalize against live stock.
- `services/waste-logs.service.ts` (131 LOC) — atomic decrement waste write.
- `services/ingredient-movements.service.ts` (75 LOC) — manual IN/OUT/ADJUSTMENT.
- `services/recipes.service.ts` (185 LOC) — recipe CRUD + stock-check helper.
- `services/stock-dashboard.service.ts` (98 LOC) — aggregated dashboard reads.
- `services/suppliers.service.ts`, `services/stock-item-categories.service.ts`, `services/stock-settings.service.ts` — thin CRUD.
- `schedulers/stock-alerts.scheduler.ts` (64 LOC) — hourly cron + advisory lock.
- `prisma/schema.prisma:2249` (`StockItem`), `2288` (`StockBatch`), `2448` (`IngredientMovement`), `655` (`StockMovement` — legacy `Product`-scoped).

**Skimmed only:**
- `controllers/stock-items.controller.ts:24-28` — confirms the `findAll` entry is a flat `@Get()` with no `take`/`skip` injected upstream.
- `dto/stock-item-query.dto.ts` — no `take`/`skip`/`limit` fields exist on the query DTO, confirming the absence in F-3.

**Skipped:**
- Other controllers — thin wrappers over the services above; behaviour is fully captured by the service-level reads.
- DTOs other than `create-ingredient-movement.dto.ts` and `stock-item-query.dto.ts` — schema validators with no business logic.

---

## 3. Business-logic invariants

| #   | Invariant                                                                                                                          | Enforced at (`file:line`)                                              | Test coverage | Risk if violated                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------- | --------------------------------------------------------- |
| I-1 | Every read / write filters by `tenantId` (multi-tenant isolation)                                                                  | `stock-items.service.ts:13,40`; `stock-deduction.service.ts:51-52,85,148-149`; `purchase-orders.service.ts:41,72-73,77-78`; `stock-counts.service.ts:42,59-60,132-133`; `waste-logs.service.ts:34-35,44-51`; `ingredient-movements.service.ts:19,38-39,69`; `recipes.service.ts:54,67`; `stock-alerts.service.ts:21,58` | none          | cross-tenant data leak                                    |
| I-2 | `stockItem.currentStock` never goes negative unless `StockSettings.allowNegativeStock=true`                                        | `stock-deduction.service.ts:189-196` (conditional `currentStock >= remaining` updateMany); `waste-logs.service.ts:44-51`; `ingredient-movements.service.ts:50-55` | none          | book stock < physical stock, cost calculations skew       |
| I-3 | Recipe deduction is idempotent — an order is deducted exactly once                                                                 | `stock-deduction.service.ts:71-74` (early exit) and `:84-88` (atomic claim of `stockDeducted=false`)                                                                | none          | double-deduction inflates COGS, drives stock negative     |
| I-4 | Order reversal is idempotent — a cancelled order's stock is restored exactly once                                                  | `stock-deduction.service.ts:246-255` (existing-reversal lookup keyed by `referenceId=orderId`)                                                                       | none          | repeated cancellations inflate stock                      |
| I-5 | PO `quantityReceived` never exceeds `quantityOrdered`                                                                              | `purchase-orders.service.ts:156-161`                                                                                                                                  | none          | over-receive falsifies inventory, breaks reconciliation   |
| I-6 | Weighted-average `costPerUnit` is recomputed on each PO receive instead of being overwritten with the latest unit price            | `purchase-orders.service.ts:179-196`                                                                                                                                  | none          | COGS swings with most recent price; valuation drift       |
| I-7 | Stock-count finalize compares counted vs **current** stock (not stale `expectedQty` snapshot), so concurrent deductions are netted | `stock-counts.service.ts:132-147`                                                                                                                                     | none          | finalize stomps over in-flight deductions                 |
| I-8 | Two concurrent IN_PROGRESS stock counts cannot overlap on the same items                                                           | `stock-counts.service.ts:56-70`                                                                                                                                       | none          | conflicting variances on finalize                         |
| I-9 | PO numbers are monotonic and collision-free per tenant                                                                             | `purchase-orders.service.ts:30-38` (`stockSettings.poSequence` increment inside the create transaction)                                                               | none          | duplicate PO numbers break audit / external reconciliation |
| I-10 | Stock-alert cron acquires a single instance-wide advisory lock before scanning tenants                                            | `schedulers/stock-alerts.scheduler.ts:28-31`                                                                                                                          | none          | stampede on horizontal scale-out, duplicate alerts        |
| I-11 | Stock-item list endpoint enforces a server-side page-size cap                                                                      | **NOT enforced** — `stock-items.service.ts:31-35` has no `take`/`skip`; DTO has no `limit` field                                                                       | none          | unbounded payload, RAM spike for large tenants            |
| I-12 | Stock-alert cron emits **only on state transition** (i.e., when the low-stock or expiring set changed since the last tick)         | **NOT enforced** — `stock-alerts.service.ts:27,66` fire whenever the set is non-empty                                                                                  | none          | alert fatigue → real alerts ignored                       |
| I-13 | Low-stock raw query is bounded                                                                                                     | **NOT enforced** — `stock-alerts.service.ts:17-25` and `stock-items.service.ts:90-98` have no `LIMIT`                                                                  | none          | RAM / socket-payload blow-up on tenants with many items   |
| I-14 | Soft-deleting / hard-deleting a `StockItem` cascades movements and batches                                                         | schema: `prisma/schema.prisma:2298, 2460, 2484` (`onDelete: Cascade` from `StockItem` to batches, movements, waste logs)                                              | none          | orphans if cascade is removed                             |

I-11, I-12, I-13 are the three §4.11 seeds, restated as invariants the module is **supposed** to keep but currently doesn't.

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**

- `stock-deduction.service.ts:79-110` — `$transaction({ isolationLevel: Serializable })` plus the atomic `updateMany({ where: { stockDeducted: false } })` claim at `:84-87`. This is the strongest pattern in the module: even if two replicas trigger deduction for the same order in the same millisecond, only one observes `stockDeducted=false` and proceeds; the other returns `count: 0` and exits.
- `stock-deduction.service.ts:168-172` — FIFO batch drawdown uses `updateMany` with a `quantity: { gte: fromBatch }` guard. If a parallel deduction beat us to a batch, `count === 0` and we silently skip that batch (`continue`) — correct: we still have `remaining` to consume from the next batch or the bare stockItem row.
- `stock-deduction.service.ts:189-196` — bare `stockItem.currentStock` decrement also goes through `updateMany` with a `currentStock: { gte: remaining }` guard (when `allowNegativeStock=false`). Race-free.
- `waste-logs.service.ts:44-51` — same atomic-decrement-with-guard pattern. No TOCTOU between the "do we have enough?" check and the decrement.
- `stock-counts.service.ts:125-147` — finalize transaction recomputes adjustment against `stockItem.currentStock` read inside the tx (`:132-134`), then writes via `updateMany` with `tenantId` predicate (`:144-147`). Stale `expectedQty` is intentionally **not** used.
- `purchase-orders.service.ts:30-38, 84-109` — PO-number allocation via `stockSettings.poSequence` `upsert` with `increment: 1` inside the create transaction. Race-free per-tenant.
- `schedulers/stock-alerts.scheduler.ts:28-31` — `pg_try_advisory_lock(djb2(name))` acquired before the tenant scan; unlocked in `finally` at `:48-50`. In-process re-entrancy guard at `:25-26` and `:53` (`isRunning` flag) backstops the case where two ticks land while one is still running.

**Race windows still open:**

- *Sketch:* between two **manual** `IngredientMovementsService.create` calls of type `OUT`, both read `stockItem.currentStock = 5` at `:38-40`, both compute `newStock = 5 - 3 = 2` at `:50`, both call `update({ where: { id } })` at `:57-60` → final stock is `2` instead of `-1` (or a thrown error). No `updateMany`-with-guard, no `Serializable`.
  *Where:* `ingredient-movements.service.ts:36-73`.
  *Severity:* High Cor. The other deduction paths (recipe, waste, PO) are all guarded; this one is the manual back-door used for inventory corrections and it's the **only** mutation that reads-then-writes without a conditional update.
  *Fix:* swap the `update` for `updateMany({ where: { id, currentStock: { gte: Math.abs(quantityChange) } } })` for `OUT` / negative `ADJUSTMENT` paths; throw `ConflictException` when `count === 0`.

- *Sketch:* `PurchaseOrdersService.receive` reads `poItem.quantityReceived` from the in-memory `po` object loaded at `:134` (via `findOne`), not from within the transaction at `:144`. Two simultaneous receives of the same PO line each compute `newReceived = alreadyReceived + receivedQty` from the same pre-state, both pass the `> ordered` check, both write. `purchaseOrderItem.update` at `:163-166` is not guarded.
  *Where:* `purchase-orders.service.ts:144-166`.
  *Severity:* Medium Cor. Two concurrent receives on the same line are an operational unlikelihood (the line is normally received by one warehouse user) but the invariant I-5 is not enforced — it's checked but the check has a TOCTOU window.
  *Fix:* re-`findUnique` the `purchaseOrderItem` inside the tx with `SELECT … FOR UPDATE` (raw SQL), or use `updateMany({ where: { id: poItem.id, quantityReceived: { lte: ordered.sub(receivedQty) } }, data: { quantityReceived: newReceived } })` and assert `count === 1`.

**Idempotency keys:**

- Present at: `stock-deduction.service.ts:85` (`stockDeducted=false` as the implicit key); `stock-deduction.service.ts:251-255` (`(type=ORDER_REVERSAL, referenceId=orderId, stockItemId)` set membership).
- Missing where needed: `stock-alerts.service.ts:27, 66` — every cron tick re-emits the full set; there's no "last seen" hash or `lastAlertedAt` per item to suppress duplicates. This is I-12 / F-1.

---

## 7. Findings

| ID   | Sev    | Dim  | Location                                                              | Finding                                                                                                                                                                                                                                                                                                                                  | Fix                                                                                                                                                                                                       |
| ---- | ------ | ---- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1  | Medium | Cor  | `services/stock-alerts.service.ts:27-42, 66-80`                       | (§4.11 seed) Both `checkLowStock` and `checkExpiringBatches` emit a socket message on every cron tick whenever the matching set is non-empty. No comparison to the previous tick. On a tenant with one persistent low-stock item, this fires hourly forever → alert fatigue. Same code is also called inline by `getDashboard`, doubling the spam any time a user opens the dashboard. | Track a hash of `(itemId, currentStock<minStock)` tuples in a per-tenant cache (Redis or DB row on `StockSettings`); only emit when the hash differs from the prior tick. Treat dashboard reads as read-only — emission belongs to the scheduler.                  |
| F-2  | Medium | Perf | `services/stock-alerts.service.ts:17-25`; `services/stock-items.service.ts:90-98` | (§4.11 seed) Both raw queries scan `stock_items` with no `LIMIT`. The cron path emits every row over the socket, so a tenant with thousands of SKUs ends up serialising the entire low-stock set into a single Socket.IO payload. | Add `LIMIT 100` to the raw query; if more items match, send a "low-stock: N items (truncated)" event instead. Same change in `findLowStockItems` (paginate via OFFSET).                                                                                          |
| F-3  | Medium | Perf | `services/stock-items.service.ts:31-35`; `dto/stock-item-query.dto.ts` | (§4.11 seed) `findAll` has no `take`/`skip`; the DTO has no `limit` field. Controller at `controllers/stock-items.controller.ts:24-28` passes the DTO through. A tenant with many SKUs gets the entire list back. | Add `take`/`skip` to the DTO; default `take=100`, clamp to `[1, 500]`; include `category` only on the first page or behind an explicit `?include=category`.                                                                                                       |
| F-4  | High   | Cor  | `services/ingredient-movements.service.ts:36-73`                      | **(new)** Manual movement read-then-writes `currentStock` without an atomic guard: `findFirst` at `:38-40`, compute `newStock` at `:50`, `update({ where: { id } })` at `:57-60`. Two concurrent `OUT` movements lose one decrement (last-write-wins) and can also drive stock negative even when `allowNegativeStock=false` (the check at `:51-55` is on the stale read). | Replace the `findFirst` + JS arithmetic + `update` with `updateMany({ where: { id, tenantId, currentStock: { gte: Math.abs(quantityChange) } if OUT/negative }, data: { currentStock: { increment / decrement } } })`. Throw `ConflictException` when `count === 0`. |
| F-5  | Medium | Cor  | `services/purchase-orders.service.ts:144-166`                         | **(new)** I-5 ("never receive more than ordered") is checked at `:157-161` against `poItem.quantityReceived` from the pre-transaction load at `:134`. Two concurrent receives on the same PO line both pass the check; `purchaseOrderItem.update` at `:163-166` is unguarded. | Inside the tx, use `updateMany({ where: { id: poItem.id, quantityReceived: { lte: ordered.sub(receivedQty) } } })` and throw if `count === 0`. Alternative: hold a row-level lock with a raw `SELECT … FOR UPDATE`.                                                |
| F-6  | Low    | Cor  | `services/ingredient-movements.service.ts:50`                         | **(new)** `Number(stockItem.currentStock) + quantityChange` converts a `Decimal(10,3)` to a JS `Number` before adding. For typical kitchen quantities the precision loss is irrelevant, but the conversion drops the safety the schema offers; the result is then written back into a `Decimal` column. | Stay in `Prisma.Decimal`: `new Prisma.Decimal(stockItem.currentStock).add(quantityChange)`. Pair with F-4 since the rewrite would compute the new value at the database anyway.                                                                                  |
| F-7  | Low    | Perf | `services/stock-dashboard.service.ts:24-25`                           | **(new)** Dashboard calls `stockAlerts.checkLowStock` / `checkExpiringBatches` synchronously on every dashboard load. These functions both **emit** to the KDS / POS rooms (`stock-alerts.service.ts:27, 66`) as a side effect of reading. So every dashboard open broadcasts an alert. | Split the alert services into pure-read and emit halves; dashboard calls the pure-read variant; only the scheduler calls the emit variant.                                                                                                                       |
| F-8  | Low    | Perf | `services/stock-dashboard.service.ts:61-79`                           | **(new)** `getValuation` does `Number(currentStock) * Number(costPerUnit)` and sums in JS. Acceptable for display but loses precision on tenants with many SKUs. Also: no pagination; entire active-items list is returned. | Use `Prisma.Decimal` accumulator; cap items to top-N by value; paginate the full list behind a query param.                                                                                                                                                       |
| F-9  | Low    | Perf | `services/ingredient-movements.service.ts:29-33`; `services/waste-logs.service.ts:25-29`; `services/purchase-orders.service.ts:40-53` | **(new)** Three more `findMany` endpoints with no `take`/`skip`. Movements in particular grow without bound. | Add the same pagination treatment as F-3; consider a default 90-day window on movements and waste logs.                                                                                                                                                            |
| F-10 | Low    | Arch | `services/stock-alerts.service.ts:17-25` vs `services/stock-items.service.ts:90-98` | **(new)** Two near-identical raw queries for "low stock". Risk: they drift. The latter joins on `stock_item_categories`, the former does the same join — but if minStock semantics ever change (e.g., per-category override) one will be updated and the other won't. | Extract a single private helper.                                                                                                                                                                                                                                  |
| F-11 | Info   | Sec  | `prisma/schema.prisma:2448-2473`                                      | The §1 / T2 seed in `CODE_REVIEW.md` claims `IngredientMovement` has no direct `tenantId` column. **This is stale** — the model carries `tenantId String` at `:2462` and `@@index([tenantId])` at `:2467`, and the FK cascades from `Tenant`. The original concern (orphaning on `StockItem` hard-delete) is also moot: the FK from `IngredientMovement.stockItemId` to `StockItem` is `onDelete: Cascade` at `:2460`. | Drop the T2 row from `CODE_REVIEW.md` §3.1 or restate it for a model that actually lacks the column.                                                                                                                                                              |
| F-12 | Info   | Arch | `prisma/schema.prisma:655-677`                                        | The legacy `StockMovement` model (product-scoped, `Int` quantity) is unused by the `stock-management` module — only `IngredientMovement` (recipe-grade, `Decimal(10,3)`) is written. Two coexisting movement tables is a footgun for analytics consumers. | Either delete `StockMovement` after confirming no consumer reads it, or rename it to make the legacy status obvious.                                                                                                                                              |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- `schedulers/stock-alerts.scheduler.ts:28-31, 48-50` — **advisory-lock pattern** matches the canonical implementation at `backend/src/modules/subscriptions/services/subscription-scheduler.service.ts:29-43` exactly: DJB2-hashed job name → `pg_try_advisory_lock` → `try/finally` unlock. The local re-entrancy guard at `:25-26` is a sensible belt-and-braces addition to handle slow ticks within a single process. Other schedulers that don't yet use the advisory lock should adopt this pattern verbatim.
- `services/stock-deduction.service.ts:79-110` — **atomic idempotency claim** via `updateMany({ where: { stockDeducted: false } })` inside a `Serializable` transaction. This is the cleanest example in the codebase of guarding a "do-once" side-effect against concurrent triggers; it should be the template for subscription-renewal idempotency (`CODE_REVIEW.md` M3).
- `services/stock-deduction.service.ts:168-172, 189-196` — **conditional-decrement-with-count-check** at the database for FIFO batch drawdown and bare-stock decrement. No TOCTOU. The same shape appears at `services/waste-logs.service.ts:44-51` and `services/stock-counts.service.ts:144-147` — three places, one pattern, all correct.
- `services/purchase-orders.service.ts:179-196` — **weighted-average costing** preserves book value across receives; deliberately avoids the simpler "overwrite costPerUnit with latest unit price" trap. The inline comment at `:168-172` documents the rationale.
- `services/stock-counts.service.ts:56-70` — **overlap guard** on count creation refuses a second IN_PROGRESS count touching any of the same `stockItem`s. The check is racy in principle (could be bypassed by two simultaneous creates) but the consequence is mild (two counts overlap) and the next finalize uses live stock anyway.
- `services/recipes.service.ts:147-154` — **loud warn** on recipe delete documenting that ingredient deduction silently stops for the bound product. Good defensive log. Could be promoted to an event emitted to ops.
- `services/purchase-orders.service.ts:267-321` — **PO cancel reverses received stock with a compensating `PO_CANCEL_REVERSAL` movement** instead of leaving inventory inflated and logging a warning. Replaces a prior bug noted in the file's docstring.

---

## 9. Spot-checks performed

**Verified:**
- F-1 confirmed at `services/stock-alerts.service.ts:27-42, 66-80`: both methods unconditionally emit when the result set is non-empty; no state-transition check; no last-emitted cache. Dashboard call site at `services/stock-dashboard.service.ts:24-25` further amplifies the issue.
- F-2 confirmed at `services/stock-alerts.service.ts:17-25` and `services/stock-items.service.ts:90-98`: raw `$queryRaw` template strings with no `LIMIT` clause.
- F-3 confirmed at `services/stock-items.service.ts:31-35` (no `take`/`skip` in the call); `dto/stock-item-query.dto.ts` confirmed to have no `limit` / `skip` fields.
- F-4 confirmed at `services/ingredient-movements.service.ts:36-73`: read-then-write with no atomic guard; the only mutation in the module that does so.
- F-5 confirmed at `services/purchase-orders.service.ts:144-166`: pre-tx load + JS arithmetic + unguarded `update`. The transaction is real but the predicate that would prevent over-receive isn't on the write.
- I-10 advisory-lock pattern confirmed by comparing `schedulers/stock-alerts.scheduler.ts:28-31, 48-50, 57-63` against `subscriptions/services/subscription-scheduler.service.ts:29-54` — same DJB2 hash, same `pg_try_advisory_lock` / `pg_advisory_unlock` shape.

**Dropped (initial report was wrong):**
- "IngredientMovement has no direct tenantId column" (`CODE_REVIEW.md` T2, ~line 2264) — drop. Verified at `prisma/schema.prisma:2462` (`tenantId String`), `:2467` (`@@index([tenantId])`), `:2463` (`Tenant` FK with `onDelete: Cascade`). Also dropped the orphan concern: `:2460` cascades on `StockItem` delete. Logged as F-11.

**Downgraded:**
- None this round.

---

## 10. Recommended tests

```ts
// backend/src/modules/stock-management/__tests__/stock-management.integration.spec.ts
describe('stock-management invariants', () => {
  it('I-1 cross-tenant: tenant A cannot read or mutate tenant B stock', async () => {
    // arrange: tenants A, B; stock item X owned by B
    // act: as A, call findOne(X), update(X), remove(X), checkLowStock,
    //      create movement against X, finalize a count of X
    // assert: every call rejects with 404/forbidden; no row in tenant B mutated
  });

  it('I-3 idempotent deduction: two concurrent triggers for the same order deduct exactly once', async () => {
    // arrange: order O with recipe ingredient X (current 10, recipe needs 3)
    // act: Promise.all([deductForOrder(O), deductForOrder(O)])
    // assert: stockItem.currentStock === 7 (one deduction)
    //         ingredientMovement count where (referenceId=O, type=ORDER_DEDUCTION) === 1
  });

  it('I-2 + F-4: two concurrent manual OUT movements cannot drive stock negative', async () => {
    // arrange: stockItem X currentStock=5, allowNegativeStock=false
    // act: Promise.all([create({ stockItemId:X, type:'OUT', quantity:3 }),
    //                   create({ stockItemId:X, type:'OUT', quantity:3 })])
    // assert: one resolves, one rejects with ConflictException; stock === 2
    //         (this test FAILS today — see F-4)
  });

  it('I-5 + F-5: two concurrent receives cannot over-receive a PO line', async () => {
    // arrange: PO line ordered=10, alreadyReceived=0
    // act: Promise.all([receive(po, [{ line, qty: 7 }]),
    //                   receive(po, [{ line, qty: 7 }])])
    // assert: one resolves with quantityReceived=7, one rejects;
    //         final quantityReceived <= 10
    //         (this test FAILS today — see F-5)
  });

  it('I-12 alert state-transition: cron does not re-emit if low-stock set is unchanged', async () => {
    // arrange: one stock item below minStock; KdsGateway spy
    // act: run scheduler tick twice in a row with no DB change between
    // assert: emit called exactly once (this test FAILS today — see F-1)
  });

  it('I-11 + I-13: list endpoint and raw low-stock query are bounded', async () => {
    // arrange: 600 active stock items for tenant T
    // act: GET /stock-items, GET /stock-items/low-stock
    // assert: response length <= 500 (clamped); raw query LIMIT 100 hit
    //         (this test FAILS today — see F-2, F-3)
  });

  it('I-8 overlap guard: two simultaneous count creates targeting the same items conflict', async () => {
    // arrange: stock items [A, B]
    // act: Promise.all([create({ stockItemIds:[A,B] }),
    //                   create({ stockItemIds:[B] })])
    // assert: one resolves, one rejects with ConflictException
  });

  it('I-10 advisory lock: two concurrent scheduler ticks only run one batch', async () => {
    // arrange: spy on checkLowStock
    // act: Promise.all([scheduler.runHourlyChecks(),
    //                   scheduler.runHourlyChecks()])
    // assert: checkLowStock called exactly once per tenant
  });
});
```

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1`: create two tenants, attempt cross-tenant access via every endpoint the module exposes (16 controllers × ~4 verbs ≈ 60 routes), assert zero leaks.
