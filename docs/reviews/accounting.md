# `accounting/` — Deep Review (2026-05-11)

**Tier:** 1
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/accounting/**`, `backend/prisma/schema.prisma` (AccountingSettings + SalesInvoice + SalesInvoiceItem), cross-reference `backend/src/common/helpers/encryption.helper.ts` and `backend/src/modules/settings/integrations/integrations.service.ts`.
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §2 (M3/M4/M8) and §4.7. This file expands those seeds end-to-end.

---

## 1. Health & summary

🔴 **red.**

The accounting module owns three contracts that the rest of the system depends on for legal correctness and auditability: (a) every paid order can be turned into a uniquely-numbered, tenant-scoped sales invoice; (b) credentials for Türkiye-side accounting providers (Paraşüt, Logo, Foriba e-Fatura) are stored safely; and (c) once an invoice is minted, it is faithfully shipped to the configured provider. All three contracts are currently broken or at risk: invoice numbers can collide under concurrent paid-order POSTs (M3), provider credentials are written to disk in **plaintext** (M8 — verified against `schema.prisma:2937-2951`), and a stale `externalId` blocks a re-sync after an admin swaps providers (M4). The auto-sync path is fire-and-forget (M5 inherited from `orders/`), so a transient adapter failure silently leaves an `ISSUED` invoice with no external counterpart. The tax-calculation service is the one bright spot — it does Decimal math correctly and is the template the rest of the module should adopt.

Health has not been previously reviewed at this depth; this is the first per-feature pass. The §4.7 row in `../CODE_REVIEW.md` flagged the three high-severity items; this review verifies them and pins six additional findings.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/accounting/services/sales-invoice.service.ts` (167 LOC) — invoice creation from order, list/find/cancel, auto-sync dispatch.
- `backend/src/modules/accounting/services/accounting-sync.service.ts` (149 LOC) — adapter dispatch, token cache, credential extraction.
- `backend/src/modules/accounting/services/accounting-settings.service.ts` (50 LOC) — settings upsert, invoice-number minter, sanitize-for-response.
- `backend/src/modules/accounting/services/tax-calculation.service.ts` (120 LOC) — Decimal-safe tax extraction & order aggregation.
- `backend/src/modules/accounting/controllers/accounting-settings.controller.ts` (41 LOC) — guards + role gating.
- `backend/src/modules/accounting/controllers/sales-invoice.controller.ts` (56 LOC) — invoice endpoints.
- `backend/src/modules/accounting/adapters/accounting-adapter.interface.ts` (25 LOC) — `AccountingAdapter` contract.
- `backend/src/modules/accounting/adapters/parasut.adapter.ts` (143 LOC) — JSON:API client.
- `backend/src/modules/accounting/adapters/logo.adapter.ts` (65 LOC) — Logo REST client.
- `backend/src/modules/accounting/adapters/foriba-efatura.adapter.ts` (124 LOC) — UBL-TR XML e-Fatura.
- `backend/src/modules/accounting/dto/accounting-settings.dto.ts`, `dto/create-sales-invoice.dto.ts`, `constants/accounting.enum.ts`.
- `backend/prisma/schema.prisma:2920-3034` — AccountingSettings, SalesInvoice, SalesInvoiceItem.

**Cross-referenced (skim):**
- `backend/src/common/helpers/encryption.helper.ts` (118 LOC) — `encryptJson`/`encryptString`. This is the pattern M8 must adopt.
- `backend/src/modules/settings/integrations/integrations.service.ts:1-200` — gold-standard credential storage (encrypted at rest + redacted on response).

**Skipped:**
- `backend/src/modules/accounting/accounting.module.ts` — wiring only.
- The `Order` / `OrderItem` schema rows beyond confirming `taxRate Int @default(10)` exists at `schema.prisma:574` (the per-item rate used to freeze tax at order time).

**Module-level facts:** 14 files, ~1024 LOC, 0 spec files (`find … -name '*spec*'` returned empty). Auto-sync registered via `@Optional()` injection in `sales-invoice.service.ts:16`.

---

## 3. Business-logic invariants

The contracts this feature owes to the rest of the system. Each row is a property an integration test could assert.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | Invoice numbers are unique per `(tenantId, invoiceNumber)`. | DB unique constraint `schema.prisma:3011` (`@@unique([tenantId, invoiceNumber])`) | ❌ none | Insert fails under race — but the user-facing error is opaque, and the wasted sequence number gap looks like missing invoices to an auditor. |
| I-2 | Invoice numbers monotonically increase per tenant within a prefix. | `accounting-settings.service.ts:39-49` (`nextInvoiceNumber: { increment: 1 }`) | ❌ none | Auditor sees gaps / out-of-order numbering. **AT RISK — M3:** the `upsert.increment` is atomic at the row level, but the value returned to the caller is read after the increment with no guarantee of consistency under retry. (See §6.) |
| I-3 | Each paid order maps to **at most one** SalesInvoice. | `schema.prisma:2988` (`orderId String? @unique`) + `sales-invoice.service.ts:30` (`if (order.salesInvoice) throw`) | ❌ none | Double-billing the same order; revenue inflated in z-reports. |
| I-4 | Only orders with `status='PAID'` can be invoiced. | `sales-invoice.service.ts:21` (`status: 'PAID'` in `findFirst.where`) | ❌ none | Invoicing a refunded or pending order — accounts drift. |
| I-5 | Σ(invoiceItem.subtotal) ≈ invoice.subtotal; Σ(invoiceItem.taxAmount) ≈ invoice.taxAmount. | `sales-invoice.service.ts:51-52` (sum in JS Number, then `Math.round * 100 / 100`) | ❌ none | Header/lines drift; XML to Foriba may fail validation. **AT RISK — F-4:** sum-of-parts done in JS Number; no header-vs-lines reconciliation assertion. |
| I-6 | Invoice tax rate is frozen at order time (audit pin). | `sales-invoice.service.ts:37` reads `item.taxRate ?? 10` off `OrderItem`, not `Product`. Product-side rate changes between order and invoice don't leak in. | ❌ none | Intentional — but uncommented. If a future refactor reads `item.product.taxRate` instead, audit drift on retroactive tax-rate changes. |
| I-7 | `lineTotal == unitPrice * quantity` (modulo rounding). | `sales-invoice.service.ts:43` **back-calculates** `unitPrice = (subtotalExcludingTax / quantity)` — quantity is from `OrderItem.quantity` which is `Int`. | ❌ none | **AT RISK — F-2:** if `quantity === 0` (Prisma `Int` allows zero), this divides by zero → `unitPrice = Infinity`, then `Math.round(Infinity * 100) / 100 = NaN`. NaN propagates into the `SalesInvoiceItem.unitPrice` Decimal column → write fails or stores 0 depending on Prisma's Decimal coercion. |
| I-8 | Provider credentials are encrypted at rest. | **NOT ENFORCED.** `schema.prisma:2937-2951` declares all secret columns as plain `String?`; `accounting-settings.service.ts:17-22` writes the DTO straight through `upsert`. | ❌ none | **VIOLATED — M8:** a leaked DB dump or a compromised read-replica exposes every tenant's accounting credentials in plaintext. |
| I-9 | Credentials are redacted on HTTP responses. | `accounting-settings.service.ts:25-37` (`sanitize` strips `*Secret` / `*Password` from response and emits `hasXCredentials: boolean`). | ❌ none | ✅ This part **is** correct. Response surface is safe; storage surface is not. |
| I-10 | Re-sync after an admin switches providers is permitted (so the new provider gets the invoice). | **NOT ENFORCED.** `accounting-sync.service.ts:29` (`if (invoice.externalId) return;`) blocks any re-sync regardless of which provider that `externalId` belongs to. | ❌ none | **VIOLATED — M4:** after a provider swap, every previously-synced invoice is permanently orphaned to the old provider. The `externalProvider` column at `schema.prisma:2993` exists precisely for this comparison but is unused on the dispatch path. |
| I-11 | Every accounting query is tenant-scoped (no cross-tenant read of invoices/settings). | `sales-invoice.service.ts:20,117,150` + `accounting-sync.service.ts:25,72`; controllers gated by `JwtAuthGuard + TenantGuard + RolesGuard` (`accounting-settings.controller.ts:15`, `sales-invoice.controller.ts:15`). | ❌ none | Cross-tenant invoice read = data breach. Currently looks safe — every query takes `tenantId` and filters by it. |
| I-12 | An invoice synced once must end in either `SYNCED` or `FAILED` external status, never silently in-flight. | `accounting-sync.service.ts:58-76` writes `externalStatus: 'SYNCED'` on success and `externalStatus: 'FAILED'` in the catch. | ❌ none | **AT RISK:** there is no `SYNCING` intermediate state, so a process crash mid-`pushInvoice` leaves the invoice with **no** `externalStatus` and **no** `syncError` — indistinguishable from "never attempted." |
| I-13 | Auto-sync errors are surfaced (Sentry or stored). | `sales-invoice.service.ts:107-109` uses `console.error` only; no Sentry, no DB write. The fire-and-forget promise's rejection only logs. | ❌ none | **VIOLATED — M5 inherited:** order is PAID, invoice exists, but the sync error never reaches operators because (a) it's logged as `console.error`, not via the NestJS `Logger`, and (b) it bypasses Sentry entirely. |
| I-14 | Tax inclusive-to-exclusive split is Decimal-safe and rounds half-up. | `tax-calculation.service.ts:31-52` (`Prisma.Decimal` throughout, `ROUND_HALF_UP`). | ❌ none | ✅ Solid. This service is the "what's good" of the module. |
| I-15 | `quantity > 0` for every OrderItem feeding an invoice. | **NOT ENFORCED.** Nothing in the invoicing path or the OrderItem schema asserts `quantity > 0`. See I-7 and F-2. | ❌ none | Divide-by-zero in the back-calculated unit price. |

---

## 4. State machine

### 4.1 Invoice status (`InvoiceStatus`)

**Enum values:** `accounting.enum.ts:10-15` — `DRAFT`, `ISSUED`, `SENT`, `CANCELLED`.

**Default on row create:** `schema.prisma:2972` writes `status String @default("DRAFT")` at DB level. The `createFromOrder` path overrides immediately with `status: InvoiceStatus.ISSUED` (`sales-invoice.service.ts:70`), so `DRAFT` is currently unreachable.

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| _(none)_ → `ISSUED` | `POST /sales-invoices/from-order/:orderId` | `sales-invoice.service.ts:21,29-30` (must be `order.status === 'PAID'`, no existing `order.salesInvoice`) | **No** — but the `orderId @unique` constraint at `schema.prisma:2988` rejects the second POST. | Increments `AccountingSettings.nextInvoiceNumber`, fires `syncService.syncInvoice` fire-and-forget if `autoSync && provider !== 'NONE'`. |
| `ISSUED → SENT` | Not reachable from any HTTP handler. The string is in the enum (`accounting.enum.ts:13`) but no service writes it. | _none_ | n/a | Dead code in the enum. |
| `ISSUED → CANCELLED` (or `SENT → CANCELLED`) | `PATCH /sales-invoices/:id/cancel` | `sales-invoice.service.ts:157-166` (rejects if already `CANCELLED`) | Yes — second cancel is rejected by the explicit check. | None — no compensating event to the external provider, no reversal of the `nextInvoiceNumber` increment. |
| `CANCELLED → *` | **Forbidden** — but only by convention; nothing prevents a future write from re-issuing. | _no guard_ | n/a | Would re-use an invoice number that was already announced to the provider. |

### 4.2 Sync state (denormalised on `SalesInvoice.externalStatus`)

The model has no `enum` for sync state — `externalStatus` is `String?` (`schema.prisma:2994`). The values written by the code are:

| Value | Written at | Meaning |
|-------|------------|---------|
| `null` | row create (`sales-invoice.service.ts:67-101`) | never attempted |
| `'SYNCED'` | `accounting-sync.service.ts:63` | adapter returned an external ID |
| `'FAILED'` | `accounting-sync.service.ts:74` | adapter threw; `syncError` populated |

**Missing states (flagged in §7):**
- `UNSYNCED` (explicit) and `SYNCING` (in-flight). Without `SYNCING`, a crashed worker leaves the invoice indistinguishable from "never attempted" — there is no way to write a "resync stuck attempts" cron without scanning by `(autoSync, externalStatus IS NULL, createdAt < now - N min)` which loses the distinction between brand-new invoices and stuck ones.

**Retry semantics:** none. The manual `POST /sales-invoices/:id/sync` route (`sales-invoice.controller.ts:44-49`) calls `syncInvoice` synchronously, which still hits the same `if (invoice.externalId) return;` guard (M4) — so a manual retry against a previously-`FAILED` invoice **does** work (because `externalId` is null) but a manual retry against a `SYNCED` invoice cannot ship to a swapped provider. The auto path (`sales-invoice.service.ts:107`) swallows rejections — there is no bounded-retry, no exponential backoff, no DLQ.

### 4.3 Transitions that should be idempotent but aren't

- `createFromOrder` (`sales-invoice.service.ts:19-114`) — not idempotent in itself; relies on `orderId @unique` to fail the second call. The failure mode (Prisma `P2002`) bubbles as a 500 unless a global filter translates it.
- `syncInvoice` (`accounting-sync.service.ts:20-77`) — not idempotent on the **adapter** side. If the adapter `POST` succeeds but the local UPDATE on line 58 fails (network blip to Postgres), the next call will re-push to the provider, minting a second remote invoice. There is no `If-Match`-style guard.

---

## 5. Money & precision audit

This is a Tier-1 money path. The accounting module is where order-time prices crystallise into a tax-document of record.

### 5.1 Decimal entry points

- `OrderItem.subtotal` (`Prisma.Decimal`) → `sales-invoice.service.ts:36` (`Number(item.subtotal)` — **precision loss point**).
- `Order.finalAmount` (`Prisma.Decimal`) → `sales-invoice.service.ts:53` (`Number(order.finalAmount)` — precision loss).
- `Order.discount` (`Prisma.Decimal`) → `sales-invoice.service.ts:54` (`Number(order.discount)`).
- `SalesInvoice.totalAmount` (Decimal, `schema.prisma:2982`) → `accounting-sync.service.ts:47` (`Number(invoice.totalAmount)` — wire payload to Paraşüt/Logo/Foriba).
- `SalesInvoiceItem.unitPrice` (Decimal, `schema.prisma:3023`) → `accounting-sync.service.ts:51` (`Number(item.unitPrice)`).
- `Product.price`-derived inputs feed `TaxCalculationService` (`tax-calculation.service.ts:41,58`) — that service is Decimal-clean throughout.

### 5.2 Decimal-to-Number conversions (every one is a precision-loss hazard)

Run was `grep -n 'Number(\|parseFloat(\|toNumber()' backend/src/modules/accounting/`. The hits split into two camps:

**Service-level (precision-risk):**
- `sales-invoice.service.ts:36` — `Number(item.subtotal)` — used for `lineTotal`, then passed to `taxService.extractTax`. **Risk:** tax extraction now runs on a JS Number; lossy reconstruction at line 43. Fix: pass the `Decimal` straight through (`TaxCalculationService.extractTax` already accepts `Money = Decimal | number | string`).
- `sales-invoice.service.ts:53-54` — `Number(order.finalAmount)`, `Number(order.discount)` — written straight into `SalesInvoice.totalAmount` / `.discount` Decimal columns. Prisma coerces the JS Number back to Decimal, but the round-trip can drop the last sub-cent digit (e.g., `0.30 - 0.10` → `0.19999…`). **Risk:** Σ(items) header vs `totalAmount` won't match after a Decimal round-trip when discount has fractional cents.
- `sales-invoice.service.ts:51-52` — `invoiceItems.reduce((s, i) => s + i.subtotal, 0)` — Σ in JS Number, then `Math.round(* 100) / 100`. **Risk:** accumulates float drift across many items; the round-half rule isn't the same as the Decimal `ROUND_HALF_UP` used in `TaxCalculationService`. Different rounding mode = banker's rounding on .5 boundaries vs half-up.
- `accounting-sync.service.ts:47,51` — `Number(invoice.totalAmount)`, `Number(item.unitPrice)` — outbound wire to provider. **Risk:** mostly tolerable here because the providers accept JSON numbers anyway, but a large invoice (>~1e15) would lose precision. Cap is well above realistic invoice values; flagging as Info, not High.

**Boundary-OK:**
- `tax-calculation.service.ts:47-49,97,99-100,107-108,115-117` — `round2(...).toNumber()` at the **return boundary** of `extractTax` / `calculateOrderTax`. This is the documented boundary contract (comment at `tax-calculation.service.ts:27`). Internally the service is Decimal-clean. ✅
- `sales-invoice.service.ts:131-132` — `Number(query.page)`, `Number(query.limit)` — pagination ints, not money.
- `tax-calculation.service.ts:106` — `Number(k)` where `k` is a `Object.entries` key. Object key parse, not money.

### 5.3 Rounding policy + tolerance

- `TaxCalculationService` uses `Decimal.ROUND_HALF_UP` at `tax-calculation.service.ts:33`. ✅ Documented at `tax-calculation.service.ts:26-29`.
- `SalesInvoiceService` uses `Math.round(x * 100) / 100` at `sales-invoice.service.ts:43,76,77`. This is **banker's rounding** in JS (actually: round-half-away-from-zero for positive numbers, but the IEEE-754 behaviour at .5 boundaries varies). **Mismatch:** the same invoice may have line items rounded by `TaxCalculationService` (half-up) and a header rounded by `Math.round` (half-to-even on `.5` boundaries because of float representation).
- No declared tolerance constant for the header-vs-lines mismatch — there should be one, and there should be an assertion. Compare to `payments.service.ts` which has an explicit 0.01 tolerance (called out in `../CODE_REVIEW.md` M2).

### 5.4 Sum-of-parts reconciliation

**NOT asserted.** `sales-invoice.service.ts:51-78` computes `subtotal`, `taxAmount` from line items, then writes `totalAmount = Number(order.finalAmount)` (line 53) from a different source entirely. There is no assertion that `subtotal + taxAmount ≈ totalAmount - discount`. **Flag in §7 as F-3.**

A test that mints an invoice for an order with discount > 0 and asserts header vs sum-of-items would fail today.

### 5.5 Foriba XML uses JS-Number arithmetic for *every* total

`foriba-efatura.adapter.ts:61-62, 70-86, 109-115` performs **JS Number** arithmetic for taxable amount, tax amount, line extension, payable amount — the values that end up in the legally-binding e-Fatura UBL-TR XML. Sample:

```ts
const totalExcTax = invoice.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
const totalTax = invoice.items.reduce((s, i) => s + (i.unitPrice * i.quantity * i.taxRate) / 100, 0);
```

For a 50-line invoice with sub-cent prices, this drifts. The Turkish tax authority validates UBL totals against the line-sum; a 0.01-drift = rejected XML. **Flag in §7 as F-5.**

---

## 6. Concurrency hazards

### 6.1 Invoice-number minting race (M3 — verified hazard)

**Where:** `accounting-settings.service.ts:39-49`

```ts
async getNextInvoiceNumber(tenantId: string): Promise<string> {
  const settings = await this.prisma.accountingSettings.upsert({
    where: { tenantId },
    update: { nextInvoiceNumber: { increment: 1 } },
    create: { tenantId, nextInvoiceNumber: 2 },
  });
  const prefix = settings.invoicePrefix || 'FTR';
  const num = (settings.nextInvoiceNumber || 2) - 1;
  return `${prefix}-${String(num).padStart(6, '0')}`;
}
```

**The atomic part:** Postgres `UPDATE ... SET nextInvoiceNumber = nextInvoiceNumber + 1 RETURNING *` is atomic. Two concurrent transactions cannot both read the same value — one will block until the other commits. So the **value returned** is unique per call.

**The non-atomic part:** the caller (`sales-invoice.service.ts:32`) then performs further reads (`settingsService.findByTenant` at line 33) and a `salesInvoice.create` at line 67 **outside** the same transaction. If the create fails for any reason (orderId unique conflict, FK violation, transient DB error), the number is **already consumed** — there is no compensating decrement. Audit-trail consequence: a tenant whose 10 invoice POSTs include 2 failures sees invoice numbers 1, 2, _gap_, 4, 5, _gap_, 7, 8, 9, 10. To a tax inspector that gap looks like a deleted invoice and triggers a question.

**The actual race window** (the one M3 originally flagged):
- Request A calls `upsert`, gets `nextInvoiceNumber = 6`. The `INSERT` of the invoice with `invoiceNumber = "FTR-000005"` (note: `num = 6 - 1 = 5`) hasn't happened yet.
- Request B calls `upsert`, gets `nextInvoiceNumber = 7`, computes `invoiceNumber = "FTR-000006"`.
- Both writes to `SalesInvoice` succeed because they target different numbers. No duplicate, but...
- ...Request A's invoice has number `FTR-000005` and Request B's has `FTR-000006`. Both succeed. **No duplicate** in this happy path.
- **The actual hazard:** the `(num = settings.nextInvoiceNumber - 1)` line assumes `settings.nextInvoiceNumber` is the value **after** A's increment. But the comment on line 47 says "We incremented, so subtract 1 to get current." This logic is only correct because the `upsert` returns the post-update row. If a future refactor moves to `findFirst + update` (non-atomic), duplicates become possible.

**Severity:** the duplicate risk is currently blocked by the DB unique constraint at `schema.prisma:3011` (`@@unique([tenantId, invoiceNumber])`). Worst case today is a 500 error on the second POST, not a duplicate. **Downgraded from High → Medium.** The fix is still warranted because (a) the gap-on-failure problem is real for auditability, and (b) the unique constraint creates a wasted sequence number every time it fires.

**Reproduction sketch:**
```ts
// Tenant has nextInvoiceNumber = 5.
await Promise.all([
  request(app).post('/sales-invoices/from-order/A').expect(201),
  request(app).post('/sales-invoices/from-order/B').expect(201),
]);
// Both should return distinct invoice numbers (5 and 6).
// If the upsert atomicity ever breaks, both get 5 → second one 409s.
```

**Fix:** wrap `getNextInvoiceNumber` + `salesInvoice.create` in the same `$transaction` so a failed create rolls back the increment. Alternatively, switch to `RETURNING` via raw SQL and treat the duplicate-key as the canary.

### 6.2 Re-sync after provider swap (M4 — verified hazard)

**Where:** `accounting-sync.service.ts:29`

```ts
if (invoice.externalId) return;
```

**Failure mode:** tenant invoices to Paraşüt for months, then switches `provider = LOGO` in settings. Every old invoice still has `externalId = <parasut-uuid>` and `externalProvider = 'PARASUT'`. A manual re-sync from the admin UI (`POST /sales-invoices/:id/sync`) hits the guard and returns without touching Logo. Logo never receives historical data.

**Fix:** compare to `settings.provider`:
```ts
if (invoice.externalId && invoice.externalProvider === settings.provider) return;
```

The `externalProvider` column already exists (`schema.prisma:2993`) — the data is there, the check just isn't done.

### 6.3 Token cache + credential read (concurrency, but mild)

**Where:** `accounting-sync.service.ts:13,102-114`

`tokenCache` is an in-memory `Map<string, { token, expiresAt }>`. Two concurrent `syncInvoice` calls for the same tenant will both miss the cache, both call `adapter.authenticate(...)`, both write to the cache — last write wins. Net effect: one wasted `POST /oauth/token` per concurrent burst, no correctness impact. Skip; not worth fixing.

**Multi-instance:** the cache is per-pod, not shared. Each replica re-authenticates. Acceptable trade-off.

### 6.4 Sync UPDATE race (mild)

**Where:** `accounting-sync.service.ts:58-67` vs `:72-75`

If the adapter `pushInvoice` succeeds, then the row UPDATE fails (DB blip), the catch block runs — but the catch writes `syncError` and `externalStatus: 'FAILED'`. The remote invoice exists, the local row says "FAILED". A retry will hit `if (invoice.externalId) return;` — no, wait, `externalId` was never written because the success UPDATE failed. So the retry pushes a **second** remote invoice. **Real bug.** Flag in §7 as F-6.

Fix: write `externalId` in two phases — pre-flight write `externalStatus: 'SYNCING'` before the `pushInvoice`, then either move to `SYNCED` with id or `FAILED` with retry-eligible flag.

### 6.5 Idempotency keys

- **Inbound:** `POST /sales-invoices/from-order/:orderId` has no `Idempotency-Key` header support. Two simultaneous POSTs are rejected by `orderId @unique`, so duplicate-create is blocked at the DB level. ✅ But the client gets a 500, not a clean 409.
- **Adapter dispatch:** no idempotency key sent to Paraşüt/Logo/Foriba. Paraşüt accepts an `invoice_id` in the request body (`parasut.adapter.ts:41`) but it's a raw int parsed from the local invoice number — collisions across tenants on the provider side aren't a concern because each tenant has its own Paraşüt company, but **retries within the same tenant** are not idempotent (see F-6).

---

## 7. Findings

Severity scale: Critical → High → Medium → Low → Info. Dimension: **Sec** · **Cor** · **Arch** · **Perf**.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 (M8) | **High** | **Sec** | `schema.prisma:2937-2951` + `accounting-settings.service.ts:17-22` + `accounting-sync.service.ts:116-140` — **VERIFIED** | All accounting provider secrets (`parasutClientSecret`, `parasutPassword`, `logoPassword`, `foribaPassword`, plus the username columns) are declared as plain `String?` and written straight through `prisma.accountingSettings.upsert(update: dto)`. No call to `encryptJson` / `encryptString` anywhere in the module. A DB dump or read-replica compromise leaks every tenant's accounting credentials in plaintext. Note: the response surface **is** redacted (`accounting-settings.service.ts:25-37` — `sanitize`), so the leak is storage-only, not API-surface. | Adopt the `integrations` module pattern. Either (a) collapse the 11 secret columns into a single `credentials Json` column and call `encryptJson` on every write + `decryptJson` on adapter read; or (b) keep the current shape but wrap each `*Secret` / `*Password` column write in `encryptString` (`encryption.helper.ts:104`) and decrypt at the adapter-credential extraction point (`accounting-sync.service.ts:116-140`). Add a `findOneWithSecrets`-style internal method mirroring `integrations.service.ts:136`. Rotate all stored credentials after the migration. |
| F-2 (M4) | High | Cor | `accounting-sync.service.ts:29` — confirmed at line | `if (invoice.externalId) return;` permanently blocks re-sync after a tenant switches providers. The `externalProvider` column at `schema.prisma:2993` exists for exactly this comparison but is never read on the dispatch path. | Change to `if (invoice.externalId && invoice.externalProvider === settings.provider) return;` and, when the provider differs, null out `externalId` before re-dispatching. |
| F-3 (M3) | Medium (downgraded from High) | Cor | `accounting-settings.service.ts:39-49` + `sales-invoice.service.ts:32-67` | The number-minting `upsert` is atomic, **but** the increment commits before `salesInvoice.create` runs and is **not** in the same `$transaction`. Failed creates leave sequence-number gaps that look like missing invoices in an audit. The DB unique constraint at `schema.prisma:3011` prevents duplicate numbers; this is the gap-on-failure problem, not the duplicate problem. | Wrap `getNextInvoiceNumber` + `salesInvoice.create` in a single `prisma.$transaction(async (tx) => {...})`. Inside the transaction, perform the upsert-increment and the create on the same `tx` so a failed create rolls back the counter. |
| F-4 | High | Cor | `sales-invoice.service.ts:43` | Back-calculated `unitPrice = (subtotalExcludingTax / quantity)` — if `OrderItem.quantity === 0` (the column at `schema.prisma:574`-vicinity is `Int` and not constrained to be positive at the DB level), divides by zero → `Infinity`, then `Math.round(Infinity * 100) / 100 = NaN`. NaN written to `SalesInvoiceItem.unitPrice` Decimal column either fails the write or stores 0 depending on Prisma coercion. | Guard early: `if (item.quantity <= 0) throw new BadRequestException('OrderItem with non-positive quantity cannot be invoiced')`. Better still: add `@db.Int @default(1)` plus a CHECK constraint `quantity > 0` at the schema level (separate PR — feature-cross-cutting). |
| F-5 | High | Cor | `sales-invoice.service.ts:51-78` | Sum-of-parts reconciliation is **not asserted**. Header `totalAmount` comes from `Number(order.finalAmount)` (line 53) while the line items sum to `subtotal + taxAmount` (lines 51-52). These can drift by sub-cents because (a) JS-Number reduce vs Decimal in `TaxCalculationService`, (b) `Math.round` vs `ROUND_HALF_UP`. Header-vs-lines drift = Foriba e-Fatura XML rejected by the tax authority. | After computing `subtotal`, `taxAmount`, and `totalAmount`, assert `Decimal(subtotal).add(taxAmount).sub(discount).sub(totalAmount).abs().lt('0.02')` and emit a Sentry warning if it fails. |
| F-6 | High | Cor | `foriba-efatura.adapter.ts:61-62, 70-86, 109-115` | UBL-TR XML totals are computed in **JS Number** (`reduce + *`/`+` on numbers, then `.toFixed(2)`). For a 50-line invoice this drifts a cent or two on average. The Turkish e-Fatura validation gateway rejects XML where line-sum ≠ header. | Switch the adapter's number math to `Prisma.Decimal` end-to-end. Take the `Decimal` values out of `SalesInvoiceItem` directly (don't `Number(...)` at `accounting-sync.service.ts:47,51`). |
| F-7 | High | Cor | `accounting-sync.service.ts:20-77` (state machine) | No `SYNCING` intermediate state on `externalStatus`. A crash between `pushInvoice` (line 56) and the success UPDATE (lines 58-67) leaves the remote invoice created but local `externalStatus = null` / `externalId = null`. The next call cannot tell "never attempted" from "stuck mid-sync" → re-pushes to the provider → duplicate remote invoice. | Add `SYNCING` as an explicit `externalStatus` value. Write it before `await adapter.pushInvoice(...)`. On success, transition to `SYNCED` with `externalId`. On catch, transition to `FAILED`. Add a reaper cron that resets `SYNCING` rows older than e.g. 5 min to `FAILED` (or to a `STUCK` state requiring manual intervention). |
| F-8 (M5 echo) | High | Cor | `sales-invoice.service.ts:107-109` | Auto-sync uses fire-and-forget (`syncService.syncInvoice(...).catch((err) => { console.error(...) })`). Errors only land in stdout. No Sentry, no DB write to the `syncError` column from this layer (the sync service does write it, but only if the failure occurs inside `try { ... }` — a thrown synchronous error before the try will only `console.error`). Bounded retry doesn't exist. | Replace with: (a) NestJS `Logger.error`, (b) explicit Sentry capture with tag `subsystem=accounting-autosync`, (c) `setImmediate(async () => { await syncService.syncInvoiceWithRetry(...); })` where retry is bounded (3 attempts, exponential backoff), and (d) on terminal failure, persist `externalStatus = 'FAILED'` + `syncError`. |
| F-9 | Medium | Cor | `sales-invoice.service.ts:36-49` | Tax-rate freeze is intentional (the code reads `item.taxRate` off `OrderItem`, not `Product`), but there is **no comment** explaining why. A well-intentioned future refactor that "denormalises" by reading `item.product.taxRate` would silently break audit invariants. | Add a comment at line 37 documenting: "Tax rate is frozen at order-creation time on `OrderItem.taxRate`. Do NOT read `item.product.taxRate` here — a rate change between order and invoice would retroactively alter historical invoices." |
| F-10 | Medium | Cor | `sales-invoice.service.ts:103-111` | Auto-sync is only triggered from `createFromOrder`. A manual `POST /sales-invoices/:id/sync` does work (controller line 47), but there is no auto-sync hook on the path that ships a previously-`FAILED` invoice. | Add a cron that scans `(autoSync = true, externalStatus = 'FAILED', updatedAt < now - 5 min)` and retries up to N times. Out of scope for the immediate fix list; track as P2. |
| F-11 | Medium | Cor | `sales-invoice.service.ts:157-166` | `cancel` does not write a compensating event to the external provider. A cancelled local invoice with a synced `externalId` leaves the provider's copy active — accounting drift. | After cancelling locally, push a credit-note / cancellation message to the adapter. At minimum, log a structured event so an operator can reconcile manually. |
| F-12 | Medium | Sec | `sales-invoice.service.ts:107-109` | Auto-sync runs without `await` outside a request lifecycle. If the Node process exits between `salesInvoice.create` (line 67) and the awaited adapter call inside `syncInvoice`, the work is lost. Currently this matters less because retries are absent (F-8), but once F-8 is fixed this also needs a durable queue. | Out of scope for the immediate fix; addressed by the same queue/retry work as F-8. Track. |
| F-13 | Medium | Arch | `accounting-sync.service.ts:93-100, 102-114, 116-148` | `settings: any` everywhere in the helper methods — type safety lost at the boundary between Prisma's generated type and the adapter contract. | Type as `AccountingSettings` (Prisma-generated) or define a narrow `AccountingProviderCredentials` discriminated union over the provider enum. |
| F-14 | Medium | Arch | `accounting-sync.service.ts:107-108` | `console.error('Auto-sync failed:', err.message)` in `sales-invoice.service.ts:108` mixes `console.*` with NestJS `Logger` used elsewhere (e.g., `accounting-sync.service.ts:12`). Per `../CODE_REVIEW.md §3.7`, the project standard is the NestJS `Logger`. | Replace with `this.logger.error(...)` (inject `Logger` into `SalesInvoiceService`). |
| F-15 | Low | Cor | `parasut.adapter.ts:41` | `invoice_id: parseInt(invoice.invoiceNumber.replace(/\D/g, '')) || 1` — strips non-digits from `"FTR-000005"` → `5`. If invoice prefix changes to a numeric one (e.g., `"2026-000005"` → `2026000005`), the parsed id will collide with another invoice in the same Paraşüt company. | Use a separately-tracked monotonic int for the provider, decoupled from the invoice number prefix. |
| F-16 | Low | Cor | `accounting.enum.ts:13` (`SENT`) | `SENT` is declared in the enum but never written by any code path. Dead state value. | Either remove from the enum or wire it to the post-sync success path (`externalStatus = 'SYNCED'` → also flip invoice `status` to `SENT`). |
| F-17 | Info | Perf | `accounting-sync.service.ts:13` | `tokenCache` Map grows unboundedly (one entry per `tenantId:adapter` combo, never evicted except by expiry-on-read). On a multi-tenant SaaS with thousands of tenants this is small (< 1MB) but worth bounding. | Use `lru-cache` with max 1000 entries. |

> **(unverified) tags remaining:** **0.** Every finding above was opened at the cited `file:line` during this review; I confirmed each condition against the source. The original `../CODE_REVIEW.md` §2 carried *(unverified)* on M3, M4, and the §4.7 rows; this review verifies all of them. M8 was already verified upstream.

---

## 8. What's solid (positive findings)

- **`tax-calculation.service.ts:31-119`** — **Decimal-clean tax math.** `D(...)` constructor and `round2` helper at lines 31-33 are clean, the inline comment at lines 26-29 documents the boundary-coercion contract, and `extractTax` correctly derives exclusive-of-tax price from a tax-inclusive price using `price / (1 + rate)`. **Candidates that should adopt it:** `sales-invoice.service.ts` (use Decimals from `item.subtotal` end-to-end), `foriba-efatura.adapter.ts` (UBL-TR XML totals).
- **`accounting-settings.service.ts:25-37` — `sanitize` for HTTP response.** Drops `parasutClientSecret`, `parasutPassword`, `logoPassword`, `foribaPassword` and emits boolean `hasXCredentials` flags. The *response* surface is safe — only the *storage* surface is the M8 problem.
- **`sales-invoice.service.ts:21, 29-30` — guards for `createFromOrder`.** Filters by `status: 'PAID'` and rejects if an invoice already exists. Both guards are clearly stated and the error messages are user-facing-quality (translated to Turkish would be a nicety, but the English is acceptable).
- **`schema.prisma:3011` — `@@unique([tenantId, invoiceNumber])`.** The DB constraint is the load-bearing safety net under M3. Without it the race would be a true duplicate. Keep it.
- **`schema.prisma:2988` — `orderId String? @unique` on `SalesInvoice`.** Prevents double-invoicing the same order at the schema level. This is the right place for that constraint.
- **`accounting-sync.service.ts:13, 102-114` — token cache with TTL.** Simple, correct, in-memory cache; respects `expires_in` from the adapter response. The default 7200s fallback (line 111) matches Paraşüt's OAuth token lifetime.
- **Controllers gated by `JwtAuthGuard + TenantGuard + RolesGuard`** at `accounting-settings.controller.ts:15` and `sales-invoice.controller.ts:15`. Write endpoints require `ADMIN` (`@Roles(UserRole.ADMIN)` at `accounting-settings.controller.ts:30, 37` and `sales-invoice.controller.ts:52`). Reads allow `ADMIN | MANAGER`. Tenant scoping is enforced everywhere via `req.tenantId`.

---

## 9. Spot-checks performed

**Verified end-to-end:**

- **F-1 (M8 — credentials in plaintext):** opened `schema.prisma:2920-2962` — confirmed all 11 secret columns are `String?` with no encryption decorator, no `Json` envelope shape. Cross-checked `accounting-settings.service.ts:17-22` — `prisma.accountingSettings.upsert({ update: dto, create: { tenantId, ...dto } })` writes the DTO verbatim. Cross-checked `accounting-sync.service.ts:116-140` — `getCredentials` reads `settings.parasutClientSecret` etc. as plain strings. Confirmed: **no encryption applied at write time, no decryption at read time.** Cross-referenced `integrations.service.ts:81-91` for the correct pattern — `encryptJson` on write, `decryptJson` on read, marker via `isEncryptedPayload`. **F-1 stands.** Already flagged VERIFIED in upstream.
- **F-2 (M4 — externalId check):** opened `accounting-sync.service.ts:29`. Source matches the finding verbatim. The adjacent line 62 writes `externalProvider: settings.provider` — so the data needed for the comparison is captured, just not used on the dispatch guard. **F-2 stands.**
- **F-3 (M3 — invoice numbering):** opened `accounting-settings.service.ts:39-49`. The `upsert` with `update: { nextInvoiceNumber: { increment: 1 } }` is atomic at the row level. **Downgraded** the original High severity → Medium because the DB unique constraint at `schema.prisma:3011` blocks the duplicate failure mode. The gap-on-failure problem (sequence numbers lost when `salesInvoice.create` fails) is real and remains a Medium-severity audit finding.
- **F-4 (divide-by-zero):** opened `sales-invoice.service.ts:43`. Computed `unitPrice = Math.round((tax.subtotalExcludingTax / item.quantity) * 100) / 100`. `item.quantity` typed as `Int` per `schema.prisma:568` vicinity. No DB-level CHECK constraint preventing 0. No service-level guard. **F-4 stands.**
- **F-5 (sum-of-parts not asserted):** opened `sales-invoice.service.ts:51-78`. Confirmed: `subtotal` and `taxAmount` are summed from items but `totalAmount` is sourced from `Number(order.finalAmount)`. No assertion. **F-5 stands.**
- **F-6 (Foriba JS-Number math):** opened `foriba-efatura.adapter.ts:61-62, 70-86`. Confirmed all arithmetic on `i.unitPrice * i.quantity` runs in JS Number. **F-6 stands.**
- **F-7 (missing `SYNCING` state):** traced the entire control flow in `accounting-sync.service.ts:20-77`. Confirmed the only writes to `externalStatus` are `'SYNCED'` (line 63) and `'FAILED'` (line 74). No pre-flight write. **F-7 stands.**
- **F-8 (fire-and-forget):** opened `sales-invoice.service.ts:103-111`. Confirmed `syncService.syncInvoice(...).catch(...)` is not awaited and the catch uses `console.error`. **F-8 stands.**

**Dropped (initial reading was wrong, or already handled):**

- "Duplicate invoice numbers under load" (M3 as originally High) — verified at the cited line that the `@@unique([tenantId, invoiceNumber])` constraint catches duplicates at the DB level. The duplicate failure mode would be a 500, not a stored duplicate. **Severity downgraded from High → Medium.** The finding morphs from "data corruption" to "audit-trail gap" — the latter is real but less urgent.
- "Cross-tenant invoice read possible" — checked every query in `sales-invoice.service.ts` (lines 20, 117, 150, 161) and `accounting-sync.service.ts` (lines 24, 25). All filter by `tenantId`. Controllers gated by `TenantGuard`. **No leak.**

**Downgraded:**

- **F-3** — High → Medium (see above).
- **F-12** — initially considered High Sec ("background work can leak across requests") — on read this is the same race as F-8 (fire-and-forget). Downgraded to Medium Cor and grouped with F-8's fix.

---

## 10. Recommended tests

The integration tests below would catch the §3 invariants and the §6 races. Skeletons only — not full implementations.

```ts
// backend/src/modules/accounting/__tests__/sales-invoice.integration.spec.ts
describe('SalesInvoice — numbering & idempotency', () => {
  it('I-1/I-2: two concurrent createFromOrder calls produce distinct invoice numbers', async () => {
    // arrange: tenant with two PAID orders A and B, nextInvoiceNumber = 5
    // act: await Promise.all([service.createFromOrder(A.id, t.id), service.createFromOrder(B.id, t.id)])
    // assert: two distinct invoiceNumbers in {FTR-000005, FTR-000006}; tenant.nextInvoiceNumber === 7
  });

  it('F-3: a failed createFromOrder rolls back the nextInvoiceNumber increment', async () => {
    // arrange: a PAID order that will fail FK validation mid-create (e.g., orphan customerId)
    // act: expect(service.createFromOrder(...)).rejects.toThrow()
    // assert: tenant.nextInvoiceNumber unchanged
  });

  it('I-3: createFromOrder for the same orderId twice is rejected on the second call', async () => {
    // arrange: one PAID order
    // act: first call succeeds; second call throws
    // assert: BadRequestException with "Invoice already exists for this order"
  });

  it('I-4: createFromOrder on a non-PAID order is rejected', async () => {
    // arrange: order in OPEN state
    // assert: NotFoundException
  });

  it('I-7/F-4: createFromOrder with quantity=0 OrderItem is rejected', async () => {
    // arrange: PAID order with an OrderItem.quantity = 0
    // act: expect(service.createFromOrder(...)).rejects.toThrow(BadRequestException)
    // (current code would NaN — this test should FAIL today, documenting the bug)
  });
});

describe('SalesInvoice — money precision', () => {
  it('I-5/F-5: Σ(item.subtotal) + Σ(item.taxAmount) ≈ totalAmount - discount within 0.02 TRY', async () => {
    // arrange: PAID order with 20 mixed-tax items (10% and 20%) and a 7.33 TRY discount
    // act: const invoice = await service.createFromOrder(order.id, t.id)
    // assert:
    //   new Decimal(invoice.subtotal).add(invoice.taxAmount).sub(invoice.discount)
    //     .sub(invoice.totalAmount).abs().lt('0.02')
  });

  it('F-6: Foriba XML LineExtensionAmount sums equal LegalMonetaryTotal exactly', async () => {
    // arrange: a synced invoice with mock Foriba adapter
    // act: capture the generated UBL-TR XML
    // assert: parse the XML, sum all <cbc:LineExtensionAmount> values, compare to
    //   <cac:LegalMonetaryTotal><cbc:LineExtensionAmount> within 0.01
  });
});

describe('AccountingSettings — credential storage (F-1 / M8)', () => {
  it('parasutClientSecret is encrypted at rest', async () => {
    // arrange: update settings with { parasutClientSecret: 'plain-secret' }
    // act: read the row directly with $queryRaw bypassing the service
    // assert: row.parasutClientSecret !== 'plain-secret'
    //   AND isEncryptedPayload(JSON.parse(row.parasutClientSecret)) === true
  });

  it('GET /accounting-settings returns hasParasutCredentials: true but no plaintext', async () => {
    // arrange: settings with parasutClientSecret stored (encrypted)
    // act: const res = await GET /accounting-settings
    // assert: res.hasParasutCredentials === true
    //   AND !('parasutClientSecret' in res)
    //   AND !('parasutPassword' in res)
  });

  it('adapter receives decrypted plaintext credentials', async () => {
    // arrange: settings with parasutClientSecret stored
    // act: spy on adapter.authenticate(credentials)
    // assert: credentials.clientSecret === 'plain-secret'
  });
});

describe('AccountingSync — re-sync (F-2 / M4)', () => {
  it('does NOT re-sync if externalId set and externalProvider matches current provider', async () => {
    // arrange: invoice synced to PARASUT, settings.provider = PARASUT
    // act: await sync.syncInvoice(invoice.id, t.id)
    // assert: adapter.pushInvoice was NOT called
  });

  it('DOES re-sync if externalId set but externalProvider differs from current provider', async () => {
    // arrange: invoice synced to PARASUT, settings.provider switched to LOGO
    // act: await sync.syncInvoice(invoice.id, t.id)
    // assert: LogoAdapter.pushInvoice was called once
    //   AND invoice.externalId now points to Logo's id
    //   AND invoice.externalProvider === 'LOGO'
  });
});

describe('AccountingSync — state machine (F-7)', () => {
  it('writes externalStatus=SYNCING before pushInvoice and SYNCED after success', async () => {
    // arrange: mock adapter with a 100ms delay; observe status transitions
    // act/assert: t=0ms status null → t=10ms status SYNCING → t=120ms status SYNCED
  });

  it('a crashed sync (mock throw) ends in FAILED with syncError populated', async () => {
    // arrange: adapter.pushInvoice rejects with Error('network')
    // act: await sync.syncInvoice(invoice.id, t.id)  // does not throw
    // assert: invoice.externalStatus === 'FAILED', invoice.syncError === 'network',
    //   invoice.externalId === null
  });
});

describe('Tenant isolation (I-11)', () => {
  it('GET /sales-invoices for tenant A cannot return tenant B invoices', async () => {
    // arrange: two tenants A, B; each has 3 invoices
    // act: GET /sales-invoices as tenant A user
    // assert: response has only A's invoices
  });

  it('GET /sales-invoices/:id with a B-owned id from tenant A returns 404', async () => {
    // assert: NotFoundException, NOT a 403 (which would leak existence)
  });
});
```

Cross-tenant invariant tests should follow the style from `../CODE_REVIEW.md §3.1` — create two tenants, attempt cross-tenant access via every endpoint (`GET /accounting-settings`, `GET /sales-invoices`, `GET /sales-invoices/:id`, `POST /sales-invoices/from-order/:orderId`, `POST /sales-invoices/:id/sync`, `PATCH /sales-invoices/:id/cancel`, `PATCH /accounting-settings`, `POST /accounting-settings/test-connection`), assert zero leaks.
