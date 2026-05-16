# `prisma/schema.prisma` — Deep Review (2026-05-11)

**Tier:** Schema audit (uses §1, §2, §3, §6, §7, §8, §9, §10 — no §4 state machine, no §5 money audit)
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/prisma/schema.prisma` (87 models, 3034 lines), `backend/prisma/migrations/`
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §3.4, §4.20, T1–T3, T5

---

## 1. Health & summary

🟡 yellow

The schema is the **structural contract for tenant isolation, money precision, and referential integrity** for the entire backend. Health is yellow not because of a single bad row but because of three diffuse, well-known patterns: (a) several hot list queries lack the `(tenantId, createdAt)` compound index they need (T1, plus several siblings discovered in this round — `StockMovement`, `WasteLog`, `IngredientMovement`, `DeliveryPlatformLog`); (b) one mis-tuned cascade rule (`Tenant.currentPlan = SetNull`, schema:87) crashes the subdomain-change flow on a deleted plan (T5); (c) soft-delete is inconsistent — `Tenant.status='DELETED'` (schema:22), `User.status='INACTIVE'` (schema:186), `DeliveryPlatformConfig.deletedAt` (schema:2141), every other tenant-scoped model is hard-deleted via `Cascade`. The 2026-04-20 hardening migration (`20260420180000_tenant_fks_and_partial_uniques`) closed the most dangerous gaps (orphan-able rows, dual-NULL idempotency, multi-active subscriptions); what remains is mostly index and consistency hygiene. **T2 (IngredientMovement no direct tenantId) is dropped — verified at schema:2462 the column exists**, the `*(unverified)*` flag in `CODE_REVIEW.md:78` was correct caution.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/prisma/schema.prisma` (3034 lines, 87 models) — full pass; every `model`, `@@index`, `@@unique`, `onDelete`, and `@db.Decimal` cataloged.
- `backend/prisma/migrations/20260420180000_tenant_fks_and_partial_uniques/migration.sql` (123 lines) — partial unique indexes for `Payment.idempotencyKey`, `Subscription.status`, plus the 7-table tenant-FK backfill (`restaurant_layouts`, `payments`, `customer_sessions`, `phone_verifications`, `waiter_requests`, `bill_requests`, `cash_drawer_movements`, `user_activities`, `loyalty_transactions`).
- `backend/prisma/migrations/20260420090000_payments_tenant_idempotency_orders_indexes/migration.sql` — initial Payment.tenantId backfill + Order compound indexes.
- `backend/prisma/migrations/20260420170000_user_token_version_apikey_hash/migration.sql` — User.tokenVersion + ApiKey.keyHash rename.
- `backend/prisma/migrations/20260420150000_z_report_finalization/migration.sql` — ZReport isFinalized columns.
- `backend/prisma/migrations/20260311_add_delivery_stock_personnel/migration.sql` — origin of IngredientMovement / WasteLog / StockCount tables.

**Skimmed only:**
- Migrations 20251019…–20260419 — confirmed structural shape matches the current schema; not re-verified line by line.

**Skipped:**
- `migration_lock.toml` — provider declaration only.
- Migrations older than `20251019101646_init` — none exist; init is the floor.
- Application code that *consumes* the schema (services, controllers) — covered in the per-feature reviews.

**Model census (87 total):**
- **Tenant-scoped (with direct `tenantId` FK to `tenants`):** 76 models — every `model X { ... tenantId String ... tenant Tenant @relation(...) }` shape in §3 row S-1.
- **Platform-global (no `tenantId`):** 11 models — `RefreshToken` (scoped by `userId`), `ReservedSubdomain`, `SuperAdmin`, `MarketingUser`, `Lead`, `LeadActivity`, `MarketingTask`, `LeadOffer`, `MarketingNotification`, `AuditLog`, `ContactMessage`, `PageView`, `PublicReview`, `PublicStatsCache`, `DesktopRelease`, `InvoiceCounter`, `SubscriptionPlan`. (The marketing sub-domain is intentionally cross-tenant — sales reps work across leads, see `subscriptions.md` and the `Commission.tenantId` `SetNull` choice at schema:2876.)
- **Child rows scoped by a parent that has `tenantId`:** `OrderItem`, `OrderItemModifier`, `ProductToImage`, `ProductModifierGroup`, `RecipeIngredient`, `PurchaseOrderItem`, `StockCountItem`, `SupplierStockItem`, `UserNotificationRead`, `CustomerReferral`, `SubscriptionPayment`, `Invoice`, `SalesInvoiceItem`. These rely on cascade-from-parent for isolation — verified safe because every parent has a direct `tenantId`.

---

## 3. Business-logic invariants

The schema-level contract — invariants the *database* is responsible for keeping. Each is a property an integration test could assert against `information_schema`.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| S-1 | **Every tenant-scoped model has a direct `tenantId` column with an FK to `tenants`.** (Verified 76 of 76 tenant-scoped models; only platform tables like `RefreshToken`, `ReservedSubdomain`, `SuperAdmin`, `MarketingUser`, `Lead`, `LeadActivity`, `MarketingTask`, `LeadOffer`, `MarketingNotification`, `Commission` (nullable tenantId), `AuditLog`, `ContactMessage`, `PageView`, `PublicReview`, `PublicStatsCache`, `DesktopRelease`, `InvoiceCounter`, `SubscriptionPlan`, `SubscriptionPayment`, `Invoice`, `OrderItem`, `OrderItemModifier`, `ProductToImage`, `ProductModifierGroup`, `RecipeIngredient`, `PurchaseOrderItem`, `StockCountItem`, `SupplierStockItem`, `UserNotificationRead`, `CustomerReferral` are platform-global or scoped by a parent that has tenantId.) | All 76 tenant rows have `tenantId String` and `tenant Tenant @relation(...)`. Example anchors: `Order` schema:538–539, `Payment` schema:629–630, `WaiterRequest` schema:1415–1416, `BillRequest` schema:1441–1442, `IngredientMovement` schema:2462–2463, `LoyaltyTransaction` schema:1262–1263. | ❌ none — no `information_schema` test in CI | Cross-tenant data leak via service-layer bug; orphan rows after tenant cascade |
| S-2 | **Tenant-scoped child rows cascade-delete on tenant deletion** (`onDelete: Cascade` on the `tenant` relation). | Verified on all 76 tenant FKs. Counterexamples that are intentional: `Commission.tenant` uses `SetNull` (schema:2876) because commission audit must survive tenant churn. | ❌ none | Tenant "deletion" leaves orphaned rows queryable |
| S-3 | **Hot list queries are backed by `(tenantId, X)` compound indices** where X is the dominant filter column. | Coverage map below. **Present** on Order (`tenantId,status` :562; `tenantId,createdAt` :563; `tenantId,tableId,status` :564), Payment (`tenantId,status` :646; `tenantId,createdAt` :647), Reservation (`tenantId,date` :1056; `tenantId,status` :1057), CashDrawerMovement (`tenantId,createdAt` :1632), UserActivity (`tenantId,createdAt` :1818), LoyaltyTransaction (`tenantId,createdAt` :1291), AnalyticsInsight (`tenantId,createdAt` :2015; `tenantId,status` :2013; `tenantId,type` :2014), TableAnalytics (`tenantId,date` :1966), Attendance (`tenantId,date` :2599), ShiftAssignment (`tenantId,date` :2652), Table (`tenantId,groupId` :470), WaiterRequest (`tenantId,status` :1433), BillRequest (`tenantId,status` :1459), TrafficFlowRecord (`tenantId,hourBucket` :1923), AnalyticsHeatmapCache (`tenantId,metric` :2048), OccupancyRecord (`tenantId,timestamp` :1894). **Missing** on StockMovement (T1, finding F-1), WasteLog (F-2), IngredientMovement (F-3), DeliveryPlatformLog (F-4), Notification (F-5) — see §7. | ❌ none | Per-tenant date-range scans degrade with row count |
| S-4 | **Soft-delete is consistent** — either `deletedAt DateTime?` OR `status='DELETED'`, never both, and tenant-scoped models pick one. | **Violated.** Three styles in use: (a) `Tenant.status='DELETED'` (schema:22), `User.status='INACTIVE'` (schema:186); (b) `DeliveryPlatformConfig.deletedAt` (schema:2141); (c) all other tenant-scoped models hard-delete via `onDelete: Cascade`. See finding F-7. | ❌ none | Application-level "active" filters drift; deleted rows leak into reports |
| S-5 | **`onDelete` semantics don't leave dangling references that downstream code dereferences.** | **Violated** on `Tenant.currentPlan` (schema:87, `SetNull`) — caller `tenants.service.ts:91-149` dereferences `currentPlan.customBranding` and NPEs. See finding F-6 (T5). Also `Order.user` (schema:533, `Restrict`) blocks user retirement; should be `SetNull` (F-8). All other `SetNull` choices verified safe (parent-optional fields like `Order.table`, `Order.customer`, `Order.approvedBy`, `Subscription.scheduledDowngradePlan`). | ❌ none | NPE/500 on subdomain change; cannot retire staff that ever took an order |
| S-6 | **Money columns are `Decimal @db.Decimal(N, 2)` with consistent precision for currency-amounts; `Decimal(N, 3)` or `(N, 4)` only for sub-cent quantities/cost-per-unit.** | **Verified consistent.** All currency totals use `(10, 2)`. The only deviations are intentional: `StockItem.costPerUnit` `(10, 4)` (schema:2258), `StockBatch.costPerUnit` `(10, 4)` (:2292), `RecipeIngredient.quantity` `(10, 3)` (:2338), `SupplierStockItem.unitPrice` `(10, 4)` (:2381), `PurchaseOrderItem.unitPrice` `(10, 4)` (:2432), `IngredientMovement.costPerUnit` `(10, 4)` (:2452), `WasteLog.cost` `(10, 4)` (:2480), `TableAnalytics.revenuePerMinute` `(10, 4)` (:1951), `LeadOffer.discount` `(5, 2)` (:2845, percentage not amount). Stock quantity columns use `(10, 3)` consistently (KG/L tracking) — `StockItem.currentStock` :2256, `StockBatch.quantity` :2291, `WasteLog.quantity` :2477, `IngredientMovement.quantity` :2451, `StockCountItem.expectedQty` :2522, `PurchaseOrderItem.quantityOrdered` :2430. **No `Float` or `Double` columns hold money.** | ❌ none | Off-by-cent in totals; loss of audit precision |
| S-7 | **Currency columns store 3-letter ISO 4217 codes (`TRY`, `USD`, `EUR`, `GBP`, `CAD`, `AUD`).** | Verified at `Tenant.currency` (schema:32), `SubscriptionPlan.currency` (:692), `Subscription.currency` (:768), `SubscriptionPayment.currency` (:805), `Invoice.currency` (:855), `SalesInvoice.currency` (:2984). All default to `TRY`. **No enum constraint** — application enforces it; a malformed write of `"₺"` or `"turkish lira"` would persist. See finding F-9. | ❌ none | Cross-currency reporting confusion if a stray write |
| S-8 | **Unique constraints back every application-asserted invariant.** | Backed: `Order.orderNumber` per tenant (`@@unique([tenantId, orderNumber])` schema:552); `Reservation.reservationNumber` per tenant (:1054); `ZReport.reportNumber` per tenant (:1601); `Table.number` per tenant (:468); `Camera.name` per tenant (:1859); `Customer.email` per tenant (:1203); `Customer.phone` per tenant (:1204); `EdgeDevice.deviceId` per tenant (:2097); `StockItem.sku` per tenant (:2281); `PurchaseOrder.orderNumber` per tenant (:2421); `SalesInvoice.invoiceNumber` per tenant (:3011); `DeliveryPlatformConfig.(tenantId, platform)` AND `(platform, remoteRestaurantId)` (:2149, :2153); `MenuItemMapping.(tenantId, platform, externalItemId)` (:2218); `Attendance.(userId, date)` (:2597); `ShiftAssignment.(userId, date)` (:2650). Partial unique on `Payment.(orderId, idempotencyKey) WHERE idempotencyKey IS NOT NULL` enforced at migration `20260420180000_tenant_fks_and_partial_uniques/migration.sql:24-26` (NOT in Prisma schema — see finding F-10). Partial unique on `Subscription.(tenantId) WHERE status IN ('ACTIVE','TRIALING','PAST_DUE')` at the same migration:119-121. | ❌ none | Race condition writes a duplicate that "shouldn't exist" |
| S-9 | **Sensitive fields are stored as hashes / encrypted, never plaintext.** | Verified: `RefreshToken.tokenHash` (schema:148 — sha256), `User.resetTokenHash` (:206), `User.emailVerificationCodeHash` (:202), `ApiKey.keyHash` (:1105 — sha256, replaces old `key` column per migration `20260420170000`), `SuperAdmin.backupCodes` hashed (:1755), `DeliveryPlatformConfig.credentials/accessToken` AES-256-GCM-encrypted JSON (:2116-2118). `SuperAdmin.twoFactorSecret` is stored plaintext but at the application boundary only the encrypted value lands here per the prior auth audit. | ❌ none | DB leak → usable tokens |

---

## 6. Concurrency hazards (DB-level)

This audit covers what the **schema** enforces — application-level locks are reviewed in their respective per-feature files (`payments.md`, `subscriptions.md`, `z-reports.md`, `stock-management.md`).

**Unique constraints that protect against races:**

- `@@unique([tenantId, orderNumber])` (schema:552) — two concurrent order creates with the same minted number lose at P2002. Caller `orders.service.ts` retries.
- `@@unique([tenantId, reportNumber])` (schema:1601) — two simultaneous Z-Report closings can't share a number.
- `@@unique([tenantId, reservationNumber])` (schema:1054) — same for reservations.
- `@@unique([userId, date])` on Attendance (schema:2597) and ShiftAssignment (schema:2650) — double-clock-in / double-assignment impossible.
- **Partial unique** `payments_orderId_idempotencyKey_notnull_key` (migration `20260420180000:24-26`) — payment retry idempotency. This is **the gold-standard pattern** in the codebase (see `payments.md` §8 and §3 row I-2).
- **Partial unique** `subscriptions_tenantId_active_key` (migration `20260420180000:119-121`) — at most one ACTIVE/TRIALING/PAST_DUE subscription per tenant. Caller catches P2002 at `subscription.service.ts:163-170` (see `subscriptions.md` §8).
- `DeliveryPlatformConfig.(platform, remoteRestaurantId)` (schema:2153) — two tenants can't claim the same remote restaurant id; prevents misrouted webhooks.
- `SubscriptionPayment.externalReference` unique (schema:811) — payment provider receipt id can't be double-recorded.
- `Invoice.invoiceNumber` global unique (schema:848) — monotonic counter `InvoiceCounter` (schema:885-890) is the lock target; concurrent invoice writes serialize on the counter row.

**Race windows the schema does NOT close (handled at app level):**

- **Stock deduction race** — no unique constraint stops two concurrent order-status transitions from double-deducting. `StockMovement` and `IngredientMovement` rely on `Order.stockDeducted` (schema:524) as an idempotency flag updated inside a transaction. Application-side concern; not a schema gap.
- **`InvoiceCounter` scope row** — `InvoiceCounter.scope @id` (schema:886) means concurrent invoice creations for the same `"202604"` scope contend on the same primary key row. `UPDATE ... RETURNING` inside a `$transaction` serializes them. OK.
- **`SubscriptionPlan` re-pricing** — no schema-level lock on `monthlyPrice` / `yearlyPrice`; a SuperAdmin write while a renewal scheduler is mid-flight could result in the renewal capturing the new price for the *current* period (where the tenant signed up at the old price). The schema can't fix this; the scheduler must snapshot `amount` into the `Subscription` row (`Subscription.amount` :767), which it does.
- **`Tenant.featureOverrides` / `limitOverrides` JSON columns** (:58, :59) — no schema constraint; concurrent SuperAdmin writes can lose one update due to JSON-column read-modify-write. Application must use a transaction with `$queryRaw jsonb_set(...)` for safety.

**Indices that exist but don't enforce uniqueness — they only speed up reads.** Listed in §3 row S-3; gaps in §7 F-1 through F-5.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Medium | Perf | `schema.prisma:673-675` (StockMovement) | **T1 — VERIFIED.** Has `@@index([tenantId])`, `@@index([productId])`, `@@index([userId])` but **no compound `(tenantId, createdAt)`**. Date-range filters (e.g., "all stock movements in tenant T this week") do a single-column lookup on `tenantId` then filter on `createdAt`. Mirrors the now-fixed shape on Payment (`schema:647`) and Order (`schema:563`). | Add `@@index([tenantId, createdAt])`. One-line schema change + one-line migration. |
| F-2 | Medium | Perf | `schema.prisma:2491-2494` (WasteLog) | Same pattern as F-1. Has `@@index([tenantId])`, `@@index([createdAt])`, `@@index([stockItemId])`, `@@index([reason])` — but no compound `(tenantId, createdAt)`. The waste-by-date report (per `stock-management.md` §5) is the hot path. | Add `@@index([tenantId, createdAt])`. |
| F-3 | Medium | Perf | `schema.prisma:2467-2472` (IngredientMovement) | Same pattern as F-1. Has `@@index([tenantId])`, `@@index([stockItemId])`, `@@index([type])`, `@@index([referenceType, referenceId])`, `@@index([createdAt])` — but no compound `(tenantId, createdAt)`. Per-tenant audit log queries scan after the single-column index. | Add `@@index([tenantId, createdAt])`. |
| F-4 | Medium | Perf | `schema.prisma:2190-2194` (DeliveryPlatformLog) | Has `@@index([tenantId])`, `@@index([platform])`, `@@index([orderId])`, `@@index([success])`, `@@index([nextRetryAt])` — but no compound `(tenantId, createdAt)` and no `(tenantId, platform)`. The dashboard "show me my Yemeksepeti webhooks today" query has no efficient path. | Add `@@index([tenantId, createdAt])` and `@@index([tenantId, platform])`. |
| F-5 | Low | Perf | `schema.prisma:1383-1385` (Notification) | Has `@@index([tenantId])`, `@@index([userId])`, `@@index([createdAt])` — but no `(tenantId, createdAt)` or `(userId, createdAt)`. The notification dropdown ("unread for user U in tenant T, last 50") cannot serve the user-scoped query from a single index. | Add `@@index([userId, createdAt])` and `@@index([tenantId, createdAt])`. |
| F-6 | High | Cor | `schema.prisma:87` (Tenant.currentPlan) | **T5 — VERIFIED in schema.** `onDelete: SetNull` on `currentPlan`. If a `SubscriptionPlan` is deleted, every tenant with that plan gets `currentPlanId = NULL`. Downstream `tenants.service.ts:91-149` dereferences `tenant.currentPlan.customBranding` for the subdomain-change feature flag → NPE → 500 instead of a clean 403. | Switch FK to `onDelete: Restrict`. SuperAdmin UI must reassign tenants to a different plan before a plan can be deleted. Application read paths should still guard `currentPlan == null` defensively (the FK switch is defense in depth). |
| F-7 | Medium | Arch | `schema.prisma:22` (Tenant.status), `:186` (User.status), `:2141` (DeliveryPlatformConfig.deletedAt) | **Soft-delete inconsistency.** Three styles coexist: `status='DELETED'` (Tenant), `status='INACTIVE'` (User), `deletedAt DateTime?` (DeliveryPlatformConfig only). All other tenant-scoped models (Product, Category, Customer, Order, etc.) hard-delete via `onDelete: Cascade`. There is **no repository helper** that filters out soft-deleted rows globally; every service implements its own `WHERE status != 'DELETED'`, easy to forget. | Standardize on `deletedAt DateTime?` for every soft-deleted model; add a repository helper / Prisma extension that injects `deletedAt: null` into every find. Out of scope to flip in one PR — track as a Phase-2 migration. |
| F-8 | Medium | Cor | `schema.prisma:533` (Order.user) | **§4.20 row — VERIFIED.** `onDelete: Restrict` blocks deleting any User who has ever taken an order. Soft-deleting is the intended path (per F-7), but with the current schema even a tombstoned user can't be removed if needed (GDPR right-to-erasure). | Switch to `onDelete: SetNull`. `Order.userId` is already `String?` (schema:532). Same fix already applied to `Order.approvedBy` (:536), `Order.customer` (:530), `Order.table` (:527). |
| F-9 | Low | Cor | `schema.prisma:32, 692, 768, 805, 855, 2984` (currency columns) | **No DB-level check constraint on `currency`** enforcing ISO 4217 3-letter codes. The Postgres `text` column accepts anything; only application code enforces the allowlist. A bug that writes `"₺"` or `null` would persist silently and break cross-currency reports. | Either (a) add a CHECK constraint `currency ~ '^[A-Z]{3}$'` in a migration, or (b) introduce a Prisma `enum Currency { TRY USD EUR GBP CAD AUD }` and migrate the columns. (b) is more invasive but type-safe. |
| F-10 | Low | Arch | `schema.prisma:637-642` (Payment idempotency comment) | The partial unique index `payments_orderId_idempotencyKey_notnull_key` is **created in a raw SQL migration only**; it is not visible in `schema.prisma`. A future `prisma db push` or `prisma migrate dev` from a developer's machine that drifts the schema can silently lose the partial unique. The schema does carry a code comment pointing at the migration (:637-642), which is the only safeguard. | Add the index as an explicit `@@index([orderId, idempotencyKey], map: "...", where: "...")` once Prisma supports `where:` in `@@index` (currently in preview as `extendedIndexes`/`fullTextSearch` — track and adopt). Until then, the schema comment is the right defense. |
| F-11 | Low | Cor | `schema.prisma:1038, 1041, 1589, 1999, 2405, 2457, 2481, 2503` (orphan-able `*ById` columns) | Audit-style "who did this" fields stored as plain `String?` with **no FK**: `Reservation.confirmedById` (:1038), `Reservation.cancelledBy` (:1041), `ZReport.finalizedById` (:1589), `AnalyticsInsight.reviewedBy` (:1999), `PurchaseOrder.createdById` (:2405), `IngredientMovement.createdById` (:2457), `WasteLog.createdById` (:2481), `StockCount.createdById` (:2503). If the referenced User is hard-deleted the id becomes a string that no longer joins. By contrast `MarketingTask.assignedToId` (:2825-2826) and `LeadActivity.createdById` (:2800-2801) DO carry FK relations. | Add `@relation` + FK with `onDelete: SetNull` (matches the existing pattern on `Order.approvedBy`, `WaiterRequest.acknowledgedBy`, etc.). Low priority — these are audit fields, not business logic. |
| F-12 | Low | Perf | `schema.prisma:1316-1320` (PhoneVerification) | `@@index([phone, tenantId])` (note the order) puts `phone` first. The hot query is "verify code for phone P in tenant T at time now" — `(tenantId, phone, expiresAt)` would serve it better. The current order makes the index useful only when phone is a high-selectivity prefix. | Add `@@index([tenantId, phone])` or reorder. Low impact — table is small and short-TTL. |

**Verified upstream findings (Tier-1 from `CODE_REVIEW.md`):**
- T1 — confirmed missing compound on `StockMovement` (F-1).
- T3 — `WaiterRequest` (`schema:1432-1433`) and `BillRequest` (`schema:1458-1459`) **already have direct `tenantId` columns** and compound `@@index([tenantId, status])` indices, added by migration `20260420180000`. Both per `CODE_REVIEW.md` were *(unverified)*; **dropped — verified, fixed in the April hardening migration.** Recorded in §9.
- T2 — `IngredientMovement` (`schema:2462-2463`) **already has a direct `tenantId` column** since migration `20260311_add_delivery_stock_personnel/migration.sql:444`. **Dropped — verified, the *(unverified)* tag in `CODE_REVIEW.md:78` was warranted caution.** Recorded in §9. The remaining gap is the compound index (F-3).
- T5 — confirmed at schema:87 (F-6).
- §4.20 row "Order.user Restrict" — confirmed at schema:533 (F-8).
- §4.20 row "soft-delete inconsistency" — confirmed (F-7).

---

## 8. What's solid (positive findings)

- **`migration 20260420180000_tenant_fks_and_partial_uniques`** — single migration closed 7 orphan-able tenant FKs (`restaurant_layouts`, `payments`, `customer_sessions`, `phone_verifications`, `waiter_requests`, `bill_requests`, `cash_drawer_movements`, `user_activities`, `loyalty_transactions`) AND added two partial unique indices that backstop application-level invariants. This is the **canonical "lock down the schema" pattern**. The pre-step (`DELETE FROM ... WHERE tenantId NOT IN (SELECT id FROM tenants)`) plus the explicit comment block per table is the right shape.
- **`payments_orderId_idempotencyKey_notnull_key`** partial unique (migration `20260420180000:24-26`) — the **gold-standard idempotency pattern** in this codebase. Combined with the in-code fast-path lookup and the P2002 recovery handler (per `payments.md` §6), this is the three-layer defense the split-bill path (`payments.md` F-2) and the contact-renewal path (`subscriptions.md` F-3) should adopt.
- **`subscriptions_tenantId_active_key`** partial unique (migration `20260420180000:119-121`) — `CREATE UNIQUE INDEX ... ON subscriptions(tenantId) WHERE status IN ('ACTIVE','TRIALING','PAST_DUE')`. Backstops the "one active subscription per tenant" rule the application asserts; concurrent activations lose at P2002 deterministically. **Pattern worth replicating** for any other "one-of-X-per-tenant" invariant.
- **Compound indexing on Order** (`schema:562-564`) — three compound indices `(tenantId, status)`, `(tenantId, createdAt)`, `(tenantId, tableId, status)` cover the three hot list paths (status-filtered, date-range, by-table). This is the **template** the other find-many-by-tenant tables (StockMovement, WasteLog, IngredientMovement, DeliveryPlatformLog — see F-1 through F-4) should mirror.
- **Money column discipline** — all currency amounts are `Decimal @db.Decimal(10, 2)`. No `Float`, no `Int` masquerading as cents, no inconsistent precisions. The deviations to `(10, 3)` or `(10, 4)` are documented in §3 row S-6 and intentional. **This is excellent and should be preserved**; new financial columns must follow the pattern.
- **`InvoiceCounter` (schema:885-890)** — single-row-per-scope monotonic counter, used inside `$transaction(...) { UPDATE invoice_counters ... RETURNING sequence }` to mint collision-free invoice numbers. **The right pattern for monotonic IDs that can't tolerate gaps.** Replicated for purchase orders (`StockSettings.poSequence`, schema:2553) — also correct.
- **`@@unique([tenantId, *])` constraints** — twelve such constraints across the schema (Order, Reservation, ZReport, Table, Customer, EdgeDevice, StockItem, PurchaseOrder, SalesInvoice, ReservationSettings, AccountingSettings, integrated catalogs). **Each one is the database backstop for an application-asserted invariant.** Listed in §3 row S-8.
- **Hash-only storage of secrets** — RefreshToken, User reset/verification, ApiKey, SuperAdmin backup codes all store sha256 hashes; DeliveryPlatformConfig credentials are AES-256-GCM-encrypted JSON. Documented inline (e.g., schema:147, 1104-1105). **No plaintext token in any column.**
- **Cascade graph is sane** — 76 of 76 tenant-scoped models cascade-delete on tenant deletion (S-2). The intentional exception (`Commission.tenant = SetNull`, schema:2876) is correctly chosen because commission audit must outlive tenant churn.
- **Inline schema comments document non-obvious decisions** — schema:637-642 (Payment idempotency partial unique), :1258-1261 (LoyaltyTransaction cascade choice), :211-213 (User.tokenVersion), :521-524 (Order.stockDeducted idempotency flag), :2113-2118 (DeliveryPlatformConfig credentials encryption), :2548-2550 (StockSettings.allowNegativeStock), :880-884 (InvoiceCounter monotonic atomicity), :1583-1591 (ZReport fiscal finalization). **These comments are the codebase's institutional memory** — a future developer cannot accidentally undo the invariant in a refactor without reading why it's there. Continue the pattern for any new constraint.
- **`@@map("snake_case_table_name")`** consistently applied (every model). Postgres tables are snake_case, Prisma models PascalCase — neither side has to learn the other convention. Predictable for raw-SQL migrations.
- **`updatedAt DateTime @updatedAt`** present on every mutable row (98 occurrences across the schema). Used by sync pollers and audit queries; never silently missing on a model that needs change tracking.
- **`@db.Text` used for free-form long-form fields** — `ContactMessage.message` (:1143), `Reservation.notes` (:1028, :1036), `LeadActivity.description` (:2793), `AnalyticsInsight.description` and `recommendation` (:1982-1983), `DesktopRelease.releaseNotes`/`changelog` (:1486-1487). Avoids the Postgres `varchar(255)` truncation foot-gun. Correct.

---

## 9. Spot-checks performed

**Verified:**
- F-1 — `StockMovement` has no `(tenantId, createdAt)` index, only `@@index([tenantId])` at schema:673. Matches T1.
- F-6 — `Tenant.currentPlan` uses `SetNull` at schema:87, exactly as `CODE_REVIEW.md:124` flagged.
- F-7 — soft-delete styles enumerated: `Tenant.status='DELETED'` schema:22, `User.status='INACTIVE'` schema:186 (no DELETED value in the comment but used in service code per `tenants.md`), `DeliveryPlatformConfig.deletedAt` schema:2141. Every other tenant-scoped model is hard-deleted via Cascade. Three styles confirmed.
- F-8 — `Order.user` is `Restrict` at schema:533; `userId` is already nullable at :532, so the `SetNull` flip is mechanical.
- S-6 (money precision) — full sweep of every `Decimal` column produced the precision map in §3; no inconsistency found.

**Dropped (initial report was wrong or has been fixed since):**
- **T2 — "IngredientMovement no direct tenantId."** Verified false: `IngredientMovement.tenantId String` at schema:2462 with `tenant Tenant @relation(...) onDelete: Cascade` at schema:2463, FK present since migration `20260311_add_delivery_stock_personnel/migration.sql:444`. The *(unverified)* tag in `CODE_REVIEW.md:78` was warranted. **The remaining gap is the missing compound index (F-3), not the tenant column.** Drop T2 as stated; replace with F-3.
- **T3 — "WaiterRequest, BillRequest no direct tenantId."** Verified false: both have direct `tenantId` columns (`WaiterRequest.tenantId` schema:1415, `BillRequest.tenantId` schema:1441) plus compound `@@index([tenantId, status])` (schema:1433, :1459). FKs added by migration `20260420180000:46-58`. **Drop T3** — the April hardening migration already fixed it.
- "Cascade on `Customer` deletion drops loyalty audit" — verified false; `LoyaltyTransaction.customer` is `onDelete: Restrict` at schema:1266 since migration `20260420180000:99-101`. The migration explicitly flipped this. **Dropped.**

**Downgraded:**
- T1 (StockMovement) — already downgraded High → Medium in `CODE_REVIEW.md:492`. Confirmed here.

**Inventory snapshots (compact reference):**

- **Models with `(tenantId, createdAt)` compound index (6):** Order :563, Payment :647, LoyaltyTransaction :1291, CashDrawerMovement :1632, UserActivity :1818, AnalyticsInsight :2015. **Missing where needed (5):** StockMovement, WasteLog, IngredientMovement, DeliveryPlatformLog, Notification (F-1 through F-5).
- **Models with `(tenantId, status)` compound index (7):** Order :562, Payment :646, Reservation :1057, WaiterRequest :1433, BillRequest :1459, AnalyticsInsight :2013. **Notable absence:** Subscription has `@@index([status])` (:791) but no `(tenantId, status)` — Subscription is mostly queried by tenantId-alone and that's adequate.
- **Models using `deletedAt DateTime?` soft-delete:** only `DeliveryPlatformConfig` (schema:2141).
- **Models using `status='DELETED'` style soft-delete:** `Tenant.status` (schema:22 — DELETED), `User.status` (schema:186 — INACTIVE used as soft-delete per `auth.md`).
- **Models with `tokenVersion` for session revocation (3):** `User.tokenVersion` (:212), `SuperAdmin.tokenVersion` (:1764), `MarketingUser.tokenVersion` (:2718). Pattern correctly replicated across all three principal types.
- **Decimal precision distribution:** `Decimal(10, 2)` = 50 columns (currency amounts); `Decimal(10, 3)` = 11 columns (stock quantities); `Decimal(10, 4)` = 9 columns (cost-per-unit / per-minute revenue); `Decimal(5, 2)` = 1 column (`LeadOffer.discount` percentage). **No `Float` or `Double` holds money.**

---

## 10. Recommended tests

These tests live at the schema/migration layer, not the per-feature layer. They should run in CI on every schema change.

```ts
// backend/src/__tests__/schema-invariants.spec.ts
describe('schema invariants', () => {
  // S-1: every tenant-scoped model has a direct tenantId column with an FK
  it('S-1: every tenant-scoped table has a tenantId FK to tenants', async () => {
    // arrange: enumerate models from Prisma DMMF; filter to those NOT in the
    //          documented allowlist of platform-global tables (RefreshToken,
    //          ReservedSubdomain, SuperAdmin, MarketingUser, Lead*, AuditLog,
    //          ContactMessage, PageView, PublicReview, PublicStatsCache,
    //          DesktopRelease, InvoiceCounter, SubscriptionPlan, Invoice,
    //          SubscriptionPayment, OrderItem, OrderItemModifier,
    //          ProductToImage, ProductModifierGroup, RecipeIngredient,
    //          PurchaseOrderItem, StockCountItem, SupplierStockItem,
    //          UserNotificationRead, CustomerReferral)
    // act: query information_schema.columns + information_schema.table_constraints
    // assert: every remaining table has `tenantId` column AND a FK on it referencing `tenants(id)`
  });

  // S-3: every tenant-scoped model with a `createdAt` column has a (tenantId, createdAt) compound index
  it('S-3: list-style tables have (tenantId, createdAt) compound index', async () => {
    // arrange: enumerate tenant-scoped tables (from S-1) with a `createdAt` column
    // act: query pg_indexes for compound index covering both columns
    // assert: all present, OR explicitly listed in a "no-list-query" allowlist
    //         (current expected failures pre-fix: StockMovement, WasteLog,
    //         IngredientMovement, DeliveryPlatformLog, Notification — those are F-1..F-5)
  });

  // S-4: soft-delete consistency
  it('S-4: no model uses both deletedAt AND status=DELETED', async () => {
    // arrange: enumerate tables with a deletedAt column
    // act: cross-reference with tables whose status default comment mentions DELETED
    // assert: empty intersection
  });

  // S-6: money columns have consistent precision
  it('S-6: every currency-amount column is Decimal(10,2)', async () => {
    // arrange: enumerate columns named in regex /(amount|total|price|cost|sales|payments|cash|tax|discount|refund)/i
    //          excluding the documented (10,3)/(10,4) stock/recipe exceptions
    // act: query information_schema.columns for numeric_precision, numeric_scale
    // assert: every match has precision=10, scale=2
  });

  // S-7: currency columns hold valid ISO 4217 codes only (post F-9 fix)
  it('S-7: currency columns reject non-ISO values', async () => {
    // arrange: create a tenant
    // act: attempt to write currency='₺' to tenants.currency
    // assert: rejected by CHECK constraint OR Prisma enum (once F-9 is fixed)
  });

  // S-8 (idempotency): partial unique on payments survives migration round-trip
  it('partial unique on payments.idempotencyKey is present after migrate reset', async () => {
    // arrange: drop + recreate database from migrations directory
    // act: query pg_indexes WHERE indexname = 'payments_orderId_idempotencyKey_notnull_key'
    // assert: exactly one row, with `WHERE (idempotencyKey IS NOT NULL)` predicate
  });

  // Migration round-trip
  it('migrate reset → migrate deploy reproduces the live schema byte-for-byte', async () => {
    // arrange: pg_dump --schema-only of the dev DB
    // act: reset to migrations, deploy, pg_dump again
    // assert: diff is empty (modulo ordering)
  });
});
```

Cross-tenant FK invariant test (from `CODE_REVIEW.md §3.1` pattern):

```ts
// backend/src/__tests__/schema-cross-tenant.spec.ts
describe('schema enforces tenant isolation at the DB layer', () => {
  it('cannot insert a tenant-scoped row whose tenantId does not exist', async () => {
    // act: prisma.order.create({ tenantId: 'nonexistent-uuid', ... })
    // assert: P2003 foreign key violation, never silently succeeds
  });

  it('deleting a tenant cascades all 76 tenant-scoped tables', async () => {
    // arrange: create tenant T with one row per tenant-scoped model
    // act: prisma.tenant.delete({ where: { id: T.id } })
    // assert: every tenant-scoped table returns 0 rows for tenantId=T.id
    //         OR the row survived because of an intentional Commission.SetNull
    //         (the only exception, schema:2876)
  });
});
```

The schema-invariants suite should run as a **separate CI job** (database needed) and is the right place to catch regressions when a new model is added without `tenantId` or without the compound index.

---
