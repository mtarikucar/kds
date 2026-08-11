-- @doctor:idempotent verified=every statement is IF NOT EXISTS / guarded DO-block; the single UPDATE backfills checkout_intents."pricedAt" from "createdAt" only WHERE it is still NULL (no-op on re-run). Purely additive: no column is dropped, no existing value is rewritten.
--
-- À-la-carte licensing — GROUNDWORK (P0 of 9).
--
-- Adds every structure the à-la-carte model needs WITHOUT changing any
-- behaviour: nothing in the application reads these columns or tables yet.
-- The behavioural flip (free core, entitlement projector rewrite, guard
-- replacement) lands separately in P3 so it can be reviewed and reverted on
-- its own.
--
-- Table names are the snake_case @@map names, NOT the Prisma model names —
-- a past production incident shipped `UPDATE "MarketplaceAddOn"` and took
-- 42P01 against the real `marketplace_addons` table.

-- ---------------------------------------------------------------------------
-- 1. Tenant: the immutable anniversary anchor.
-- ---------------------------------------------------------------------------
-- Written exactly once, when the first paid License is provisioned. Stored as
-- UTC midnight of the TENANT-LOCAL calendar date so anniversary arithmetic is
-- pure calendar math. Null = no paid license yet — the normal steady state for
-- a free-core tenant, which is why it must be nullable.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "licenseAnchorAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "tenants_licenseAnchorAt_idx"
  ON "tenants"("licenseAnchorAt");

-- ---------------------------------------------------------------------------
-- 2. Catalog: license/credit/capacity metadata.
-- ---------------------------------------------------------------------------
-- `requiresLicense` defaults to true, which is the correct posture for the
-- existing module/integration rows. P1's catalog migration flips it to false
-- on the license row itself, credit packs and one-time services.
--
-- `commissionRate` mirrors SubscriptionPlan.commissionRate. It exists here
-- because once the SUB payment rail retires, the checkout rail becomes the
-- only source of the PaymentSucceeded event that drives marketing-rep
-- commission — and that event needs a rate per product, not per plan.
ALTER TABLE "marketplace_addons"
  ADD COLUMN IF NOT EXISTS "requiresLicense" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "creditKind"      TEXT,
  ADD COLUMN IF NOT EXISTS "creditUnits"     INTEGER,
  ADD COLUMN IF NOT EXISTS "maxQuantity"     INTEGER,
  ADD COLUMN IF NOT EXISTS "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "i18n"            JSONB,
  ADD COLUMN IF NOT EXISTS "commissionRate"  DECIMAL(5,4) NOT NULL DEFAULT 0.10;

-- New rows default to the annual cadence. Existing rows keep whatever value
-- they already carry ('recurring'/'oneTime'); P1's data migration remaps them.
-- Every current writer (AddOnCatalogService.create, the seed) passes `billing`
-- explicitly, so this default change is inert today — it exists to keep the
-- migrated database in sync with the Prisma schema, which the e2e CI gate
-- builds with `db push`.
ALTER TABLE "marketplace_addons"
  ALTER COLUMN "billing" SET DEFAULT 'annual';

CREATE INDEX IF NOT EXISTS "marketplace_addons_status_kind_sortOrder_idx"
  ON "marketplace_addons"("status", "kind", "sortOrder");

-- ---------------------------------------------------------------------------
-- 3. Ownership: what was actually charged, and how.
-- ---------------------------------------------------------------------------
-- `chargedCents` is the PRORATED amount paid, deliberately distinct from the
-- catalog list price: renewals must re-read the live catalog, never bill from
-- a stale snapshot. `pendingQuantity` exists because capacity DOWNGRADES are
-- renewal-time only — there are no mid-cycle refunds. `origin` keeps operator
-- comps out of revenue reporting.
ALTER TABLE "tenant_addons"
  ADD COLUMN IF NOT EXISTS "chargedCents"    INTEGER,
  ADD COLUMN IF NOT EXISTS "currency"        TEXT NOT NULL DEFAULT 'TRY',
  ADD COLUMN IF NOT EXISTS "pricingMeta"     JSONB,
  ADD COLUMN IF NOT EXISTS "pendingQuantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "origin"          TEXT NOT NULL DEFAULT 'purchase',
  ADD COLUMN IF NOT EXISTS "compReason"      TEXT,
  ADD COLUMN IF NOT EXISTS "compActorId"     TEXT;

-- Drives the nightly sweeper's "which rows reached their period end" scan and
-- the renewal-cycle generator's per-tenant item lookup.
CREATE INDEX IF NOT EXISTS "tenant_addons_status_currentPeriodEnd_idx"
  ON "tenant_addons"("status", "currentPeriodEnd");

-- ---------------------------------------------------------------------------
-- 4. Checkout intents: FROZEN pricing + referral snapshot.
-- ---------------------------------------------------------------------------
-- Annual proration depends on `now`, and CheckoutService re-quotes the cart at
-- settlement and refuses to provision when the total diverges by more than one
-- kuruş. Without a frozen instant, an intent created at 23:58 and settled at
-- 00:03 loses a day of remaining-days: the card is charged and NOTHING is
-- provisioned. Settlement passes `pricedAt` back in as `now`, so the tolerance
-- keeps catching what it is actually for — catalog price edits mid-flight.
ALTER TABLE "checkout_intents"
  ADD COLUMN IF NOT EXISTS "pricedAt"                  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "quoteJson"                 JSONB,
  ADD COLUMN IF NOT EXISTS "expiresAt"                 TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "referralCode"              TEXT,
  ADD COLUMN IF NOT EXISTS "referredByMarketingUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "renewalCycleId"            TEXT;

-- Backfill from createdAt rather than now(): an in-flight intent was priced
-- when it was created, and stamping it with the migration timestamp would
-- silently move its pricing instant forward. Guarded so a re-run is a no-op.
UPDATE "checkout_intents"
  SET "pricedAt" = "createdAt"
  WHERE "pricedAt" IS NULL;

ALTER TABLE "checkout_intents"
  ALTER COLUMN "pricedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "checkout_intents"
  ALTER COLUMN "pricedAt" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "checkout_intents_status_expiresAt_idx"
  ON "checkout_intents"("status", "expiresAt");

-- ---------------------------------------------------------------------------
-- 5. Prepaid credits.
-- ---------------------------------------------------------------------------
-- Created EMPTY here. The legacy `ai_generation_usage` table keeps serving
-- AI quota until P4 swaps MenuAiQuotaService for CreditService and migrates
-- its rows across — keeping P0 purely additive means P0 cannot break AI
-- generation.
--
-- balance(tenant, kind) = SUM(credit_lots.units WHERE NOT voided)
--                       - SUM(credit_ledger.units WHERE NOT voided)
CREATE TABLE IF NOT EXISTS "credit_lots" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "units"      INTEGER NOT NULL,
  "source"     TEXT NOT NULL,
  "addOnCode"  TEXT,
  "paymentRef" TEXT,
  "priceCents" INTEGER,
  "currency"   TEXT NOT NULL DEFAULT 'TRY',
  "expiresAt"  TIMESTAMP(3),
  "voided"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "credit_lots_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credit_lots_tenantId_fkey'
  ) THEN
    ALTER TABLE "credit_lots"
      ADD CONSTRAINT "credit_lots_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Checkout idempotency: a PayTR webhook replay must not double-grant credits.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_lots_tenantId_paymentRef_addOnCode_key"
  ON "credit_lots"("tenantId", "paymentRef", "addOnCode");

CREATE INDEX IF NOT EXISTS "credit_lots_tenantId_kind_voided_idx"
  ON "credit_lots"("tenantId", "kind", "voided");

-- Consumption ledger. Deliberately no FK on "refId": product deletion
-- cascades media jobs away and consumption must survive that, otherwise
-- "delete product -> credit refunded" farms free generations. Same rule the
-- ai_generation_usage table already documents for its jobId.
CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "units"     INTEGER NOT NULL DEFAULT 1,
  "lotId"     TEXT,
  "refType"   TEXT,
  "refId"     TEXT,
  "voided"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_tenantId_fkey'
  ) THEN
    ALTER TABLE "credit_ledger"
      ADD CONSTRAINT "credit_ledger_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "credit_ledger_tenantId_kind_voided_idx"
  ON "credit_ledger"("tenantId", "kind", "voided");

CREATE INDEX IF NOT EXISTS "credit_ledger_refId_idx"
  ON "credit_ledger"("refId");

CREATE INDEX IF NOT EXISTS "credit_ledger_lotId_idx"
  ON "credit_ledger"("lotId");

-- ---------------------------------------------------------------------------
-- 6. Renewal cycles.
-- ---------------------------------------------------------------------------
-- Materialized ~30 days before the anniversary so the reminder cron has a
-- stable target, the "one itemized invoice per year" promise has somewhere to
-- live, and the grace/expiry job has a record of what was owed. Prices are
-- read live from the catalog at generation time and then frozen here, so the
-- tenant pays exactly what the reminder email quoted.
CREATE TABLE IF NOT EXISTS "renewal_cycles" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "anniversaryAt" TIMESTAMP(3) NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'open',
  "cartJson"      JSONB NOT NULL,
  "quoteJson"     JSONB NOT NULL,
  "totalCents"    INTEGER NOT NULL,
  "currency"      TEXT NOT NULL DEFAULT 'TRY',
  "graceEndsAt"   TIMESTAMP(3) NOT NULL,
  "remindersSent" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "invoiceId"     TEXT,
  "paymentRef"    TEXT,
  "generatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"        TIMESTAMP(3),
  "lapsedAt"      TIMESTAMP(3),

  CONSTRAINT "renewal_cycles_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'renewal_cycles_tenantId_fkey'
  ) THEN
    ALTER TABLE "renewal_cycles"
      ADD CONSTRAINT "renewal_cycles_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- One open cycle per tenant per anniversary — makes the generator cron
-- idempotent across replicas.
CREATE UNIQUE INDEX IF NOT EXISTS "renewal_cycles_tenantId_anniversaryAt_key"
  ON "renewal_cycles"("tenantId", "anniversaryAt");

CREATE INDEX IF NOT EXISTS "renewal_cycles_status_graceEndsAt_idx"
  ON "renewal_cycles"("status", "graceEndsAt");

CREATE INDEX IF NOT EXISTS "renewal_cycles_status_anniversaryAt_idx"
  ON "renewal_cycles"("status", "anniversaryAt");

-- ---------------------------------------------------------------------------
-- 7. Itemized tenant invoices.
-- ---------------------------------------------------------------------------
-- NEW tables rather than a relaxation of "invoices": that table's
-- "subscriptionId" is NOT NULL behind a cascade FK, and Turkish VUK requires
-- multi-year invoice retention. Making it nullable would produce an
-- unwritable down migration — NOT NULL cannot be restored once a-la-carte
-- rows exist, and a down that deleted them would be destroying tax records.
-- "invoices"/"subscription_payments" are frozen as read-only legacy archives.
--
-- Numbering SHARES the existing atomic "invoice_counters" table through
-- common/helpers/invoice-number.helper.ts. Two independent counters over the
-- same INV-{YYYYMM}-{seq}-{hex} format would eventually collide on the unique
-- index, and that collision surfaces at settlement — after the card is charged.
CREATE TABLE IF NOT EXISTS "tenant_invoices" (
  "id"                        TEXT NOT NULL,
  "tenantId"                  TEXT NOT NULL,
  "invoiceNumber"             TEXT NOT NULL,
  "status"                    TEXT NOT NULL DEFAULT 'PAID',
  "kind"                      TEXT NOT NULL,
  "paymentRef"                TEXT,
  "renewalCycleId"            TEXT,
  "subtotalCents"             INTEGER NOT NULL,
  "taxCents"                  INTEGER NOT NULL,
  "shippingCents"             INTEGER NOT NULL DEFAULT 0,
  "totalCents"                INTEGER NOT NULL,
  "currency"                  TEXT NOT NULL DEFAULT 'TRY',
  "periodStart"               TIMESTAMP(3),
  "periodEnd"                 TIMESTAMP(3),
  "issuedAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"                    TIMESTAMP(3),
  "taxIdSnapshot"             TEXT,
  "referralCode"              TEXT,
  "referredByMarketingUserId" TEXT,
  "pdfUrl"                    TEXT,

  CONSTRAINT "tenant_invoices_pkey" PRIMARY KEY ("id")
);

-- Restrict, not Cascade: a paid invoice is a tax record and must block the
-- hard-delete of its tenant rather than vanish with it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_invoices_tenantId_fkey'
  ) THEN
    ALTER TABLE "tenant_invoices"
      ADD CONSTRAINT "tenant_invoices_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_invoices_invoiceNumber_key"
  ON "tenant_invoices"("invoiceNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_invoices_paymentRef_key"
  ON "tenant_invoices"("paymentRef");

CREATE INDEX IF NOT EXISTS "tenant_invoices_tenantId_issuedAt_idx"
  ON "tenant_invoices"("tenantId", "issuedAt");

CREATE INDEX IF NOT EXISTS "tenant_invoices_status_idx"
  ON "tenant_invoices"("status");

CREATE INDEX IF NOT EXISTS "tenant_invoices_renewalCycleId_idx"
  ON "tenant_invoices"("renewalCycleId");

CREATE TABLE IF NOT EXISTS "tenant_invoice_lines" (
  "id"            TEXT NOT NULL,
  "invoiceId"     TEXT NOT NULL,
  "lineNo"        INTEGER NOT NULL,
  "kind"          TEXT NOT NULL,
  "code"          TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "qty"           INTEGER NOT NULL DEFAULT 1,
  "unitCents"     INTEGER NOT NULL,
  "subtotalCents" INTEGER NOT NULL,
  "prorationMeta" JSONB,
  "periodStart"   TIMESTAMP(3),
  "periodEnd"     TIMESTAMP(3),

  CONSTRAINT "tenant_invoice_lines_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_invoice_lines_invoiceId_fkey'
  ) THEN
    ALTER TABLE "tenant_invoice_lines"
      ADD CONSTRAINT "tenant_invoice_lines_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "tenant_invoices"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tenant_invoice_lines_invoiceId_lineNo_idx"
  ON "tenant_invoice_lines"("invoiceId", "lineNo");
