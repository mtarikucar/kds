# `z-reports` — Deep Review (2026-05-11)

**Tier:** 1
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/z-reports/` + `prisma/schema.prisma` (ZReport model)
**Related upstream:** [`../CODE_REVIEW.md §4.9`](../CODE_REVIEW.md) — seed findings

---

## 1. Health & summary

🟡 **yellow.** Z-reports own the end-of-day fiscal close: they snapshot sales, payment-method splits, tax, refunds, cash drawer reconciliation, and staff/category breakdowns into an immutable record that downstream audits compare against. The finalization gate is **exemplary** — `closeReport` writes via a conditional `updateMany` on `isFinalized=false` with a SHA-256 payload digest, so two concurrent close clicks cannot both win and post-finalization tampering is detectable on re-hash. That's the strongest correctness pattern in the codebase outside loyalty redemption. The risk concentrates in four places: (a) `reportNumber` is day-scoped without a sequence suffix, so any flow that closes two reports on the same calendar day races on the `(tenantId, reportNumber)` unique index instead of writing distinct rows; (b) net-sales is derived from order-side aggregates while refunds are subtracted from the payment side, so an order that's `PAID` but whose payment was later `REFUNDED` gets refund deducted once at the payment side and again implicitly via the `finalAmount` it still contributes — small double-count window; (c) `computePayloadHash` uses `Decimal.toString()` without a `toFixed(2)` normalization, so a re-serialization round-trip that promotes `"10"` to `"10.00"` (or vice-versa across Prisma versions) silently breaks the audit comparison; (d) every aggregation in `generateReport` runs through JS `Number(decimal)`, which is fine for restaurant-scale daily totals but is the wrong default for a fiscal-close path. None of this is exploitable — it's the kind of bug that surfaces in an audit, not in production traffic.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/z-reports/z-reports.service.ts` (724 LOC) — `generateReport`, `findAll`, `findOne`, `generatePdf`, `closeReport`, `computePayloadHash`, `sendReportEmail`, `generateAndSendReport`.
- `backend/src/modules/z-reports/services/z-report-scheduler.service.ts` (285 LOC) — 15-min cron that scans tenants at their tenant-local closing time and triggers `generateAndSendReport`. Pg advisory lock + tenant-local midnight matching against an already-sent report.
- `backend/src/modules/z-reports/z-reports.controller.ts` (92 LOC) — REST surface; `JwtAuthGuard + TenantGuard + RolesGuard` with `Roles(ADMIN, MANAGER)` on every handler.
- `backend/src/modules/z-reports/z-reports.module.ts` (14 LOC).
- `backend/src/modules/z-reports/dto/create-z-report.dto.ts`, `dto/query-z-report.dto.ts`.
- `backend/prisma/schema.prisma:1502-1606` — `ZReport` model.
- `backend/src/common/helpers/timezone.helper.ts` — `getTenantDayBounds`, `getTenantMidnight`.

**Skimmed only:**
- `backend/prisma/schema.prisma` `Order` (`:496-566`), `Payment`, `CashDrawerMovement` (`:1608+`) — only enough to verify the field types the service reads off.

**Skipped:**
- PDF rendering branches (lines 396-466) — formatting only, no fiscal logic.
- Email template (`z-report-summary`) — markup, not money.

---

## 3. Business-logic invariants

The contract this feature owes. Each row is testable.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | A finalized Z-report is immutable — `isFinalized=true` precludes any further fiscal-totals write. | `z-reports.service.ts:489-502` (conditional `updateMany`) | ❌ none | tamper-evident audit broken; silent rewrite of yesterday's close. |
| I-2 | `payloadHash` is SHA-256 of the canonical sorted-key JSON of fiscal-critical fields at finalization time, and re-hashing the stored row reproduces the exact digest. | `z-reports.service.ts:512-536` | ❌ none | post-close tampering cannot be detected on audit (the entire point of the hash). **At risk** — see F-4. |
| I-3 | `reportNumber` is unique within `(tenantId, reportNumber)` and is deterministic per `(tenant, reportDate)`. | schema `:1601`; mint `:270` | ❌ none | a same-day double-close races on the unique index; P2002 translates to "already exists" but a second legitimate close of a different shift is impossible. **At risk** — see F-3. |
| I-4 | One Z-report per `(tenantId, reportDate)` — derived from I-3 plus the deterministic mint. | `:38-46` fast-path; `:325-332` P2002 fallback | ❌ none | duplicate fiscal records; ambiguous "which one is canonical." |
| I-5 | `expectedCash = openingCash + cashPayments + (cashInTotal − cashOutTotal)`. | `:212` | ❌ none | cash drawer reconciliation wrong; over/short detection breaks; the tenant's accountant trusts a number that doesn't match the formula. |
| I-6 | `cashDifference = countedCash − expectedCash` (signed; negative = short). | `:213` | ❌ none | over/short sign flips; UI says "over" when actually "short". |
| I-7 | `netSales = Σ finalAmount(orders where status='PAID' & paidAt ∈ day) − totalRefunds`. | `:89, 108-112` | ❌ none | net-sales drifts from payment-side truth. **At risk for double-count** — see F-2. |
| I-8 | `totalTax = Σ orderItem.taxAmount` for the day, and `taxBreakdown[rate].taxableAmount = subtotal − taxAmount` is non-negative per row. | `:171-180` | ❌ none | tax line on the fiscal report can go negative if a tax-exclusive line is stored as tax-inclusive; audit drift. |
| I-9 | Every Z-report query is tenant-scoped — `findFirst`/`findMany`/`updateMany` filter by `tenantId`. | `:38-43, 60-69, 128-140, 183-200, 231-238, 266-324, 358-366, 374-377, 489-499, 689-694` | ❌ none | cross-tenant fiscal leak. |
| I-10 | `closeReport` always sets `finalizedAt` and `payloadHash` atomically with `isFinalized=true` — no `isFinalized=true` row may exist with a null `payloadHash`. | `:491-498` (single `data:` block in one write) | ❌ none | audit can't verify; "is this row finalized?" answer ambiguous. |
| I-11 | Cancelled orders are counted by `createdAt` in-day, not `paidAt`, because a cancelled order never gets a `paidAt`. | `:128-140` | ❌ none | cancellation count silently zero for cancelled-same-day-they-were-placed orders if window logic shifts. |
| I-12 | The scheduler runs at most once per `(tenant, tenant-local day)` — guarded by `emailSent=true` lookup against `tenantTzMidnight`. | `scheduler:128-141` | ❌ none | duplicate fiscal email to accountants; alert fatigue. |
| I-13 | Only `ADMIN` or `MANAGER` may generate, list, view, finalize, or email a Z-report. | controller `:33, 40, 51, 58, 76, 83` (`@Roles`) | ❌ none | staff-tier user closes the day prematurely. |
| I-14 | `expectedCash` schema column tolerates negative values (cash drawer with more cash out than in/opening). | schema `:1546` `Decimal @db.Decimal(10, 2)` allows negative; service `:212` does not guard. | ❌ none | a heavy cash-out day stores a negative expectedCash that the schema accepts but `@Min(0)` on `cashDrawerOpening` (DTO `:13`) implies operators don't expect — confusion at audit time. **Edge** — see F-1. |

Invariants are the contract the code is *already* trying to keep. I-2, I-3, I-7, I-14 are the four at-risk rows that drive the §7 findings.

---

## 4. State machine

**Status enum:** there is **no `ZReportStatus` Prisma enum**. State is encoded across three boolean/timestamp pairs on the `ZReport` row:

- `isFinalized: Boolean` (default `false`), `finalizedAt: DateTime?`, `finalizedById: String?`, `payloadHash: String?` — schema `:1587-1590`.
- Legacy flags `pdfExported: Boolean`, `excelExported: Boolean`, `emailSent: Boolean` — schema `:1575-1582`. The first two are flipped *as a side-effect* of finalization (`:496-497`) which is a confusing coupling — finalization is not the same operation as export.
- No explicit `OPEN` / `VOID` state. A row exists ⇒ it is `OPEN`. A row with `isFinalized=true` ⇒ `FINALIZED`. There is no `VOID` / void/cancel-the-z-report path; once finalized the row is meant to live forever (deletion would have to go through `Tenant cascade`).

Treat the effective states as a pseudo-enum: `OPEN` (isFinalized=false) → `FINALIZED` (isFinalized=true). The author's comment at `:469-475` explicitly frames it this way ("After this succeeds, every writing path must assert isFinalized=false before mutating fiscal totals").

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `∅ → OPEN` | `POST /z-reports` or scheduler `generateAndSendReport` | `:38-46` fast-path dedupe by `(tenantId, reportDate)`; `:325-332` P2002 fallback on `(tenantId, reportNumber)` unique index | yes (P2002 ⇒ "already exists" BadRequest) | sales/payment/refund/tax aggregates frozen into the row at creation time. |
| `OPEN → FINALIZED` | `PATCH /z-reports/:id/close` | `:478-480` reject if `isFinalized=true` (read-then-check, **TOCTOU window**) **and** `:489-490` conditional `updateMany where isFinalized=false` (race-safe) | yes (second arrival sees `result.count===0` and throws `ConflictException`) | `finalizedAt`, `finalizedById`, `payloadHash` set; `pdfExported`, `excelExported` flipped true (semantic coupling — see §7 F-7). |
| `FINALIZED → OPEN` | — | none provided | n/a | **forbidden, correctly unimplemented.** |
| `FINALIZED → VOID` | — | none provided | n/a | **forbidden, correctly unimplemented.** Verify that a future "I closed the wrong day" support flow goes through a corrections module rather than reopening the row. |
| `OPEN → ∅` | — | none provided | n/a | no delete endpoint exists. Schema cascade-delete via Tenant deletion is the only path — would be a foot-gun if tenant deletion ever fires post-finalization. |

**Forbidden transitions** (must be guarded; flag any unguarded ones in §7):
- `FINALIZED → OPEN` — no endpoint, no service method. Guarded by absence.
- `FINALIZED → FINALIZED` (double-finalize) — guarded twice: read-check at `:478-480` and the `where: { isFinalized: false }` precondition at `:490`. The second guard is the load-bearing one.
- `email-send on a FINALIZED row` — *not* forbidden; `sendReportEmail` (`:541-679`) writes to `emailSent` / `emailSentAt` / `emailRecipients` / `emailError` columns post-finalization. **Those columns are not in the `payloadHash` payload (`:512-528`), so this is intentional and safe** — confirmed by reading the payload field list. Note this contract explicitly in a comment near `:512`.

**Transitions that should be idempotent but aren't:**
- `email-send` (`:541-679`) is not idempotent — calling it N times writes N rows of `emailSent=true, emailSentAt=now()`. Not a finalization concern (those columns are outside the hash) but a UX/audit-trail concern: who actually received it the first time? — see §7 F-8.

---

## 5. Money & precision audit

This is a Tier-1 money path: the row stores 14 `Decimal(10,2)` columns and a serialized hash over them.

**Decimal entry points** (where `Prisma.Decimal` first appears in this flow):
- `:61-83` `order.totalAmount`, `order.discount`, `order.finalAmount`, `payment.amount`, `orderItem.taxAmount`, `orderItem.subtotal`, `cashDrawerMovement.amount` — Prisma deserializes the `@db.Decimal(10,2)` columns as `Prisma.Decimal` instances.
- DTO inputs `cashDrawerOpening`, `cashDrawerClosing` (DTO `:13-20`) enter as JS `number` — `@IsNumber()` + `@Min(0)` — and stay as JS number through `:212-213`.

**Decimal-to-Number conversions** (every one is a precision-loss hazard, but at restaurant scale per-day this is realistically safe — flag if the totals ever cross ~2^53):

- `:87` `Number(order.totalAmount)` — sum into `grossSales` JS number — precision loss above 2^53 (≈9e15).
- `:88` `Number(order.discount)` — sum into `discounts`.
- `:89` `Number(order.finalAmount)` — sum into `rawNetSales`.
- `:95, 99, 103, 108, 116, 119, 122, 125, 143, 157, 173, 178, 205, 207, 222, 240, 249` — every reducer in the file does `sum + Number(decimal)`. **Single source of precision drift.**
- `:212` `expectedCash = cashDrawerOpening + cashPayments + cashInOut` — all JS numbers, then written to the `Decimal @db.Decimal(10,2)` column. JS floating-point summation of currency: `0.1 + 0.2 → 0.30000000000000004`, then Prisma's `Decimal` coerces by `toString()`/`toFixed`-style normalization at insert.
- `:213` `cashDifference = cashDrawerClosing - expectedCash` — same.
- `:445, 578` `Number(report.cashDifference)` — sign comparison only; safe.

Reproduce with: `grep -n 'Number(' backend/src/modules/z-reports/`.

**Rounding policy + tolerance constants:**
- **No tolerance constants.** No `Math.abs(...) > 0.01` style checks. The service doesn't compare aggregated totals against the payment side or against the sum of items, so there's nothing to be tolerant of — but that absence is itself a finding: the report cannot detect drift between order-side totals and payment-side totals (see I-7, F-2).
- No documented rounding policy. The Decimal column quietly applies the database's default (Postgres `numeric(10,2)` truncates, doesn't round, on excess precision — verify against a TC test case).

**Sum-of-parts reconciliation:**
- Σ `orderItem.subtotal` vs `order.totalAmount` — **NOT asserted.** Same drift risk flagged in `orders/` review.
- Σ `payment.amount` (COMPLETED) vs `order.finalAmount` — **NOT asserted at this layer.** Payment service may already check this in its own flow; the Z-report just sums and trusts.
- `cashPayments` (`:95`) vs `cashMovements` of type `CASH_IN` from order payments — **NOT cross-checked.** The `CashDrawerMovement` table is queried at `:183-200` and used only for non-sales `CASH_IN`/`CASH_OUT`, but there's no assert that order-tied cash payments are also reflected as movements. If your POS writes both a `Payment(CASH)` row and a `CashDrawerMovement(CASH_IN)` row for the same till transaction, `expectedCash` double-counts; if it writes only the `Payment` and not the movement, `expectedCash` is right but the movement audit trail is incomplete. Pick one model and document it.

**Hash serialization** (`:512-536`) — this is the load-bearing precision call:

```ts
totalSales: report.totalSales?.toString?.() ?? String(report.totalSales),
```

`Prisma.Decimal.toString()` returns the minimal canonical form: `new Decimal('10.00').toString() === '10'`, `new Decimal('10.50').toString() === '10.5'`. The trailing-zero stripping is fine until a re-serialization path produces `'10.00'` instead (e.g., a JS `Number(x).toFixed(2)` rehydration or a different Decimal version's `toString`). Then the canonical JSON differs, the hash differs, and the audit reports "tampered" on a row that wasn't touched. **Normalize via `Decimal(x).toFixed(2)` (or a dedicated `formatMoney(d)` helper that always emits exactly two decimals) before hashing.** This is the §4.9 seed and it's the most important fix in this file.

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**

- `:489-502` `closeReport` — `updateMany where { id, tenantId, isFinalized: false }` plus `if (result.count !== 1) throw ConflictException`. **Race-free.** Two concurrent close requests: exactly one increments the count, the other lands `0` and is rejected. This is the gold standard pattern; cross-link to `customers/loyalty.service.ts:50-80` (the other Serializable + conditional-updateMany site) as the two exemplars for the codebase.
- `:266-324` `generateReport` create — protected only by the `(tenantId, reportNumber)` **unique index** plus the read-then-create dedupe at `:38-46`. The unique index is the load-bearing guard; the fast-path read is just a UX optimization to avoid the P2002 exception. **Race-safe but coarse**, because the unique key is `(tenantId, reportNumber)` and the report number is derived solely from `reportDate` — the unique constraint doubles as a per-day uniqueness, but if a tenant ever wants two reports per day (per-shift), the schema needs to change.
- Scheduler (`scheduler:29-49`) — Pg advisory lock via `pg_try_advisory_lock(djb2('z-report-scheduler'))` — multi-instance safe, matches the rest of the codebase. **Race-free.** The local `this.isRunning` flag (`scheduler:9, 26-27, 55-57`) duplicates this protection unnecessarily — same anti-pattern flagged on `delivery-platforms/schedulers/order-polling.scheduler.ts:36-60` in `../CODE_REVIEW.md §4.8`. If the lock holder crashes mid-tick, the advisory lock is released by Postgres on session close; the `isRunning` flag persists on the replica until next restart. Drop the flag — see F-6.

**Race windows still open** (each with a reproduction sketch):

- *Sketch:* operator clicks "Close Z-Report" twice in a 50ms window.
  *Where:* the read at `:477-480` then the `updateMany` at `:489-499` is **TOCTOU**, but the `updateMany`'s `where: { isFinalized: false }` precondition closes the window. *Severity:* **Info — already handled.** This is the right pattern; just adding it to the inventory for future readers.

- *Sketch:* two different operators trigger end-of-day for the same tenant within the 15-min scheduler window. Operator A's `generateAndSendReport` races scheduler tick B's `generateAndSendReport`.
  *Where:* `:684-723` `generateAndSendReport`. The read at `:689-694` is TOCTOU vs the `create` at `:266-324`; the unique index on `(tenantId, reportNumber)` catches it (P2002 → `BadRequestException('Z-Report already exists for this date')`). *Severity:* **Low** — the surfaced error is fine, but the message lies if the same-day double-close was actually a legitimate two-shift close. *Fix:* if multi-shift is a future requirement, switch `reportNumber` to `Z-YYYYMMDD-NNN` with a per-day counter sequence (mirror the `InvoiceCounter` model at schema `:885`).

- *Sketch:* `closeReport` reads the row (`:477` → `findOne`), then computes the hash on that snapshot (`:487`), then writes (`:489-499`). If a refund or cash-movement adjustment is being written to the row's underlying source data between read and write, the hash is computed over a snapshot but the row in DB reflects a different reality. **However, fiscal totals on the ZReport row itself are only written at create-time (`:266-324`); refunds/movements don't update existing ZReport rows.** So this is a non-issue *for the ZReport row*; the order-row refunds happening concurrently are a different module's problem. *Severity:* **Info.**

- *Sketch:* `reportNumber` is minted as `Z-${YYYYMMDD}` (`:270`). Two tenants in different timezones whose `reportDate` rounds to the same UTC `YYYYMMDD`? The unique constraint is `(tenantId, reportNumber)`, so cross-tenant uniqueness is intentionally not required. **Safe.**

**Idempotency keys:**
- Present at: report creation — via the `(tenantId, reportNumber)` unique index (`:1601`). The "key" is the deterministic `Z-YYYYMMDD` mint.
- Missing where needed:
  - `sendReportEmail` (`:541-679`) — no idempotency. A retry mid-send writes a second `emailSent=true` row. **Low** because the cron only attempts once per tenant-day (it filters `emailSent: true`), but a manual `POST /z-reports/:id/send-email` is unguarded. See F-8.
  - Scheduler `getTenantsAtClosingTime` has a 15-min window `minutesSinceClosing >= 0 && < 15` (`scheduler:115`); if the cron tick is slow, a tenant could in theory fall into two windows. The `emailSent` filter (`scheduler:128-141`) catches it. Safe.

---

## 7. Findings

Same format as `docs/CODE_REVIEW.md`. Verified findings unmarked; ones I flagged but didn't open and re-trace end-to-end carry `*(unverified)*`. Every §4.9 seed is reproduced and verified here.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Cor | `z-reports.service.ts:212-213` | `expectedCash = cashDrawerOpening + cashPayments + cashInOut` — produced from JS numbers and stored to a `Decimal(10,2)` column. The DTO `@Min(0)` on `cashDrawerOpening` (DTO `:13`) implies non-negative inputs, but `cashInOut` can dominate to a net-negative `expectedCash` on a heavy-payout day. The schema allows it; the operator UI may not. No explicit branch or warning. | Either (a) clamp to `Math.max(0, …)` and log a Sentry warning when it would have gone negative, or (b) accept negatives explicitly and document. Don't leave the contract ambiguous. |
| F-2 | High | Cor | `z-reports.service.ts:86-112` | `rawNetSales` sums `order.finalAmount` over `status=PAID, paidAt in day` (`:89`). `totalRefunds` then sums refunded *payments* (`:107-108`). If a refund is partial and the order remains `PAID`, the order's `finalAmount` already reflects the original sale; subtracting `totalRefunds` is correct. **But** if the order was flipped to a non-`PAID` status post-refund, it's excluded from `rawNetSales` *and* the refund is still subtracted at `:112` — net-sales drifts double-low. Single source of truth needed. | Pick one side: sum `Payment(status=COMPLETED).amount` for the day and skip `order.finalAmount` entirely; or assert via a runtime check that no `Payment(status=REFUNDED)` belongs to a non-`PAID` order before subtracting. |
| F-3 | Medium | Cor | `z-reports.service.ts:270` | `reportNumber: Z-${YYYYMMDD}` is day-scoped without a sequence suffix. The `(tenantId, reportNumber)` unique index (schema `:1601`) doubles as a one-report-per-day enforcement. A legitimate per-shift second close on the same calendar day races on the unique constraint and surfaces as "Z-Report already exists for this date" (`:329-330`). | Switch to `Z-YYYYMMDD-NNN` minted from a per-day sequence (mirror `InvoiceCounter` at schema `:885`). Even if multi-shift isn't a current requirement, the renumbering is the right shape — and removes the implicit assumption that "report number" and "report date" are the same key. |
| F-4 | High | Cor | `z-reports.service.ts:486-536` | `computePayloadHash` uses `Decimal.toString()` for every fiscal value. `new Prisma.Decimal('10.00').toString() === '10'`, not `'10.00'`. Any future re-hash path that goes through `Number(x).toFixed(2)` (the PDF/email branches already do this at `:421-431`, `:593-620`) would canonicalize to `'10.00'` and produce a different SHA-256. The hash's whole purpose is to detect tampering — instead it'll false-positive on a format drift. | Normalize before hashing. Replace each `.toString?.()` with `new Prisma.Decimal(x).toFixed(2)` (or a `formatMoney(d)` helper). Add a unit test that round-trips a row → re-hashes → asserts equality. |
| F-5 | Medium | Arch | `z-reports.service.ts:478-480` + `:489-490` | The pre-check at `:478-480` reads the row and throws "already finalized" if `isFinalized=true`. The `updateMany` at `:489-490` is the load-bearing race-safe write. The pre-check is *redundant* but not harmful — except that it returns a `BadRequestException` while the race path returns a `ConflictException` (`:501`). Two close attempts get different error codes depending on which one arrived second by milliseconds. | Either drop the pre-check and let everything fall through the `updateMany` (then translate `count===0` consistently), or keep the pre-check but harmonize the error type. |
| F-6 | Medium | Arch | `services/z-report-scheduler.service.ts:9, 26-27, 55-57` | Local `isRunning` flag duplicates the Pg advisory lock. If the replica holding the lock crashes mid-tick, Postgres releases the advisory lock on session close, but `isRunning` stays `true` on that replica's memory until process restart — that replica then refuses to participate in future ticks even though it could. Same anti-pattern flagged on `delivery-platforms/schedulers/order-polling.scheduler.ts` in `../CODE_REVIEW.md §4.8`. | Drop the flag; the advisory lock alone is sufficient (and is the cross-replica truth anyway). |
| F-7 | Medium | Arch | `z-reports.service.ts:496-497` | `closeReport` flips `pdfExported=true` and `excelExported=true` as a side-effect of finalization. Neither is true at that moment — the PDF endpoint is `GET /z-reports/:id/pdf` (`controller:60`) and may never be called. These flags now lie for any audit query that filters on them. The author left a half-comment about the legacy meaning at `:481-485` but didn't follow through. | Stop writing the export flags inside finalization. Export tracking is its own concern; route the actual PDF download path to update `pdfExported=true` if you want that telemetry. |
| F-8 | Low | Cor | `z-reports.service.ts:541-679` | `sendReportEmail` is not idempotent — N calls write N "last sent" rows over each other and lose the recipient history. Cron path is safe because the scheduler filters on `emailSent=true` (scheduler `:128-141`), but the manual `POST /z-reports/:id/send-email` (controller `:83-91`) has no guard. | Append (not overwrite) to a `ZReportEmailLog` child table, or accept the current "last-write-wins" behavior and update the swagger docs to say so. |
| F-9 | Low | Perf | `z-reports.service.ts:61-83` | `findMany` on orders with deep `include` (payments, user, orderItems → product → category). For a busy tenant this returns potentially thousands of rows with nested objects; the reducers then walk them in-process. No paging, no `take`. | Materialize the aggregates with `groupBy` / `aggregate` queries; the only thing that truly needs row-level read is the top-products + staff-performance breakdown, and those can be separate `groupBy`s on `OrderItem` / `Order`. Same anti-pattern noted in `analytics.gateway.ts` heatmap upserts. |
| F-10 | Low | Cor | `z-reports.service.ts:38-46` and `:689-694` | The fast-path "already exists for this date" check uses `findFirst` with `reportDate: new Date(reportDate)`. `new Date(reportDate)` parses an ISO string into UTC; `reportDate` is stored as whatever the previous create wrote (also a UTC-parsed `new Date(reportDate)`). If two callers pass `reportDate` strings that represent the same calendar day in the tenant's tz but differ in UTC representation (`2026-05-11T00:00:00Z` vs `2026-05-10T21:00:00Z`), the fast-path misses and only the unique-index P2002 fallback catches it. | Either canonicalize `reportDate` to tenant-local midnight before storage (scheduler at `:131` already does this — make `generateReport` symmetric), or use `getTenantDayBounds` for the dedupe check too. |
| F-11 | Info | Arch | `prisma/schema.prisma:1502-1606` | There is no `ZReportStatus` enum. State is encoded across `isFinalized + finalizedAt + payloadHash + pdfExported + emailSent` booleans. Querying "open Z-reports" today means `where: { isFinalized: false }`; if `VOID`/`CORRECTED` ever appears, this becomes a non-trivial migration. | If multi-shift / corrections is on the roadmap, add a `status` column (`OPEN | FINALIZED | CORRECTED`) and treat the booleans as denormalized projections. Otherwise no action needed. |
| F-12 | Info | Sec | `z-reports.controller.ts:27-91` | All handlers gated by `JwtAuthGuard + TenantGuard + RolesGuard` with `Roles(ADMIN, MANAGER)`. Tenant-scoping is via `req.user.tenantId` (`:36, 47, 54, 65, 79, 90`) which is set by the guards. **Verified safe.** Single defense-in-depth note: a future refactor that breaks guard ordering would silently make `req.user.tenantId` undefined; consider an `if (!req.user?.tenantId) throw Forbidden` at the top of each handler. | Optional. Cross-references the same defense-in-depth note as `tenants.controller.ts` (T4 in `../CODE_REVIEW.md`). |
| F-13 | Info | Cor | `z-reports.service.ts:172` | `const rate = item.taxRate ?? 10;` — a missing `taxRate` on an order item silently defaults to 10%. If the tenant doesn't actually charge 10%, the tax-breakdown report misreports the rate bucket. | Either reject items missing `taxRate` at creation time (tighten the order schema) or read the tenant's default rate from `tenant.defaultTaxRate` instead of a hardcoded `10`. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- **`closeReport` finalization (`:489-502`).** Conditional `updateMany` filtered by both `tenantId` and `isFinalized=false`, with `count !== 1 ⇒ ConflictException`. This is the exemplar pattern for "decrement/set-if-allowed" flows. **Other features that should adopt the same shape:** subscription renewal write (`subscriptions/services/subscription-scheduler.service.ts:90-97` — M9 in upstream), split-bill writes (`orders/services/payments.service.ts:412-533` — M10), invoice number minting (`accounting/services/sales-invoice.service.ts:32-33` — M3). The cross-link from M9/M10/M3 back to `z-reports.service.ts:489-502` is the right way for those PRs to copy the pattern.
- **`payloadHash` design intent (`:506-511, 587-590`).** Sorted-key JSON over a fixed allowlist of fiscal-critical columns. The selection is *just* the totals (not `notes`, not `emailSent`, not `pdfExported`), so post-finalization metadata writes are explicitly tolerated. The intent is correct; only the serialization is wobbly (F-4).
- **Tenant-local day bounds (`:53-59` + `timezone.helper.ts:13-69`).** The `getTenantDayBounds` helper anchors at noon to dodge DST shifts at night and produces a half-open `[start, end)` interval. Both `generateReport` and the scheduler use it, so an Istanbul tenant doesn't lose 23:00-00:00 because the API pod runs in UTC. This is the right shape for any other "per-tenant-day" aggregation (analytics heatmaps, daily stock counts, day-scoped reservations).
- **Pg advisory lock + tenant-local midnight dedupe in the scheduler (`scheduler:29-49, 116-141`).** Multi-instance safe and tenant-tz-aware. The comment at `scheduler:116-127` explicitly explains the bug that "use server-local midnight" would have caused. Copy this pattern verbatim for any cron that emits one-per-tenant-day events.
- **P2002 → BadRequest translation (`:325-332`).** Catches the race on the `(tenantId, reportNumber)` unique index and surfaces it as a clean business error rather than a 500. Pair this with F-3's reportNumber redesign so the message is also accurate, not just well-shaped.
- **Roles + tenant guard chain (controller `:27, 33, 40, 51, 58, 76, 83`).** `JwtAuthGuard + TenantGuard + RolesGuard` applied at class level, `@Roles(ADMIN, MANAGER)` at every handler. No `@Public()` escape hatch on this controller. Verified clean.

---

## 9. Spot-checks performed

What was opened and end-to-end verified vs what stayed at "agent-reported."

**Verified:**

- F-1 (`expectedCash` negative-day) — opened `:212-213` and DTO `:13-20`. Schema column `Decimal(10,2)` allows negatives; DTO `@Min(0)` on opening only; service does no clamp. Confirmed.
- F-2 (net-sales double-count window) — opened `:86-112` and traced `rawNetSales` source (`:89`, order-side `finalAmount`) vs `totalRefunds` source (`:107-108`, payment-side amount). Hypothesis is "if order status flipped non-PAID post-refund, refund subtracts but order already excluded." Confirmed by re-reading order status enum in `prisma/schema.prisma:500` — the relevant non-`PAID` flip is `CANCELLED`, and a `CANCELLED` order with refunded payments is rare but possible. Risk is real; "medium-likelihood" rather than acute, hence High Cor not Critical.
- F-3 (reportNumber day-scope) — opened `:270` and `prisma/schema.prisma:1601`. The mint at `:270` is `Z-${date.toISOString().slice(0,10).replace(/-/g,'')}` — purely date-derived, no sequence suffix. The unique constraint is `(tenantId, reportNumber)`. Confirmed.
- F-4 (Decimal toString format drift) — opened `:512-536`. Read each of `:517-527` — every one uses `.toString?.() ?? String(...)`. No `toFixed` anywhere in the hash path. Confirmed; this is exactly the §4.9 seed.
- F-5 (inconsistent close-race error type) — opened `:478-480` (`BadRequestException`) and `:501` (`ConflictException`). Different HTTP status codes for the same root cause depending on race ordering. Confirmed.
- F-6 (scheduler `isRunning` flag) — opened `scheduler:9, 26-27, 55-57`. The flag is set/cleared in a `try/finally`, so the in-replica leak is bounded to "crash between lines 27 and 55". Real but small. Confirmed.
- F-7 (export flags lying) — opened `:496-497` inside the `closeReport` data block. Both flags get flipped unconditionally on finalize, regardless of whether the PDF was ever generated or the Excel ever exported. Confirmed.
- F-12 (controller authz) — opened `controller:27-91`. `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)` at class level (`:27`), `@Roles(ADMIN, MANAGER)` on every handler. Verified clean.

**Dropped (initial agent report was wrong):**

- "Finalization can be reverted by `sendReportEmail` updating `emailSent` on the row." — opened `:541-679` and cross-checked the `payloadHash` payload at `:512-528`. The hash is computed over an allowlist of *fiscal* fields only; `emailSent` and its siblings are not in the payload. Writing to `emailSent` after finalization is therefore safe by design. **Drop.**

**Downgraded:**

- F-3 (reportNumber collision) — initial classification was High based on §4.9 seed; downgraded to **Medium** after verifying that the unique-constraint + P2002 translation already serializes the "wrong" outcome to a clean error. The fix (per-day sequence) is still the right answer if multi-shift becomes a requirement, but today the failure mode is "second close gets a misleading error message," not "data loss / duplicate row."
- F-7 (export flags) — initial reading was "this corrupts the audit trail." Downgraded to **Medium Arch** after recognizing the flags are not in the `payloadHash` payload and therefore can't break I-2. The flags are misleading, not catastrophic.

---

## 10. Recommended tests

These would catch the §3 invariants and §6 race windows. Skeletons only.

```ts
// backend/src/modules/z-reports/__tests__/z-reports.integration.spec.ts
describe('z-reports invariants', () => {
  it('I-1 / I-10: finalized row is immutable + payloadHash is set atomically', async () => {
    // arrange: create OPEN report; capture totals
    // act: closeReport(); attempt updateMany on isFinalized=false (should match 0 rows)
    // assert: row.isFinalized=true && payloadHash != null && finalizedAt != null
    // assert: second closeReport() throws ConflictException
  });

  it('I-2 / F-4: payloadHash is stable across re-serialization', async () => {
    // arrange: create + finalize a report with totalSales = 10, 10.5, 10.55, 10.555
    // act: re-read the row from prisma, recompute via the same canonical algorithm
    // assert: stored payloadHash === recomputed payloadHash for ALL values
    // failing case (with toString): '10.00' -> '10' breaks the hash; the test fails
    //   today and passes after switching to toFixed(2).
  });

  it('I-3 / F-3: reportNumber uniqueness under same-day double-close', async () => {
    // arrange: tenant T, reportDate D
    // act: Promise.all([generateReport(T, D, op1), generateReport(T, D, op2)])
    // assert: one succeeds, the other throws BadRequestException
    // assert: exactly one ZReport row exists for (T, D)
  });

  it('I-1 / §6: concurrent finalize ⇒ exactly one winner', async () => {
    // arrange: create OPEN report R
    // act: Promise.all([closeReport(R), closeReport(R), closeReport(R)])
    // assert: 1 success, 2 ConflictException
    // assert: row.finalizedById === the winner's userId (race-deterministic via DB)
  });

  it('I-5 / F-1: expectedCash handles negative-day edge', async () => {
    // arrange: opening=0, cashPayments=10, cashInOut=-100 (heavy payout)
    // act: generateReport
    // assert: expectedCash=-90, cashDifference=countedCash-(-90)
    // (or, if we choose to clamp: assert expectedCash=0 and a Sentry warning fired)
  });

  it('I-7 / F-2: net-sales source-of-truth under partial refund', async () => {
    // arrange: order O paid 100, status=PAID; later refund payment of 30
    // (case A) order remains PAID, finalAmount=100, refund=30
    //   expected: netSales = 100 - 30 = 70
    // (case B) order flipped to CANCELLED post-refund, refund=30
    //   today: netSales = 0 - 30 = -30  ← bug
    //   expected (single-source-of-truth fix): netSales = 0 (excluded) AND refund excluded
    // assert per-case
  });

  it('I-9: tenant isolation — cross-tenant queries leak zero rows', async () => {
    // arrange: create T1 and T2, each with one Z-report
    // act: as T1 user, call findAll(), findOne(T2.report.id), generatePdf(T2.report.id),
    //   closeReport(T2.report.id), sendReportEmail(T2.report.id)
    // assert: every call returns 0 rows / 404 / 403; never T2 data
  });

  it('I-12: scheduler emits at most once per tenant-day', async () => {
    // arrange: tenant T with closingTime '22:00' in 'Europe/Istanbul', emailEnabled
    // act: invoke scheduler tick at 22:00, 22:05, 22:10, 22:14 (all within window)
    //   then at 22:15 (out of window)
    // assert: exactly one ZReport created; exactly one email sent
    // assert: subsequent ticks observe emailSent=true and skip
  });

  it('F-10: same-day double-create via different ISO offsets', async () => {
    // arrange: tenant T tz='Europe/Istanbul'
    // act: generateReport with '2026-05-11T00:00:00Z' THEN '2026-05-10T21:00:00Z'
    //   (both resolve to the same tenant-local calendar day)
    // assert: second call fails (today: P2002→BadRequest; after fix: fast-path catches)
  });

  it('F-13: missing taxRate does not silently default to 10%', async () => {
    // arrange: order item with taxRate=null
    // act: generateReport
    // assert: either rejection at creation OR breakdown uses tenant.defaultTaxRate
    //   (not the literal 10).
  });
});
```

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1` — *create two tenants → attempt cross-tenant access via every endpoint → assert zero leaks.* The I-9 test above is the local incarnation of that suite for `z-reports`.
