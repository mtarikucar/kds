-- Rollback for alacarte_licensing_groundwork.
--
-- Removes EXACTLY what the up added and nothing else. Safe to run twice, and
-- safe to run when never applied: every statement is IF EXISTS.
--
-- Why this down is honest rather than lossy: the up was purely additive. It
-- created five empty tables and added columns that no application code reads
-- yet (the behavioural flip is P3). The only pre-existing data it touched was
-- backfilling checkout_intents."pricedAt" from "createdAt" — and that column
-- is dropped here, so the backfill leaves no residue. No operator or runtime
-- data (orders, inventory, entitlements, tenants) is deleted or rewritten.

-- Children before parents.
DROP TABLE IF EXISTS "tenant_invoice_lines";
DROP TABLE IF EXISTS "tenant_invoices";
DROP TABLE IF EXISTS "renewal_cycles";
DROP TABLE IF EXISTS "credit_ledger";
DROP TABLE IF EXISTS "credit_lots";

-- Checkout intents: drop the frozen-pricing + referral columns. Dropping the
-- column removes its default and its NOT NULL along with it.
DROP INDEX IF EXISTS "checkout_intents_status_expiresAt_idx";

ALTER TABLE "checkout_intents"
  DROP COLUMN IF EXISTS "pricedAt",
  DROP COLUMN IF EXISTS "quoteJson",
  DROP COLUMN IF EXISTS "expiresAt",
  DROP COLUMN IF EXISTS "referralCode",
  DROP COLUMN IF EXISTS "referredByMarketingUserId",
  DROP COLUMN IF EXISTS "renewalCycleId";

-- Ownership columns.
DROP INDEX IF EXISTS "tenant_addons_status_currentPeriodEnd_idx";

ALTER TABLE "tenant_addons"
  DROP COLUMN IF EXISTS "chargedCents",
  DROP COLUMN IF EXISTS "currency",
  DROP COLUMN IF EXISTS "pricingMeta",
  DROP COLUMN IF EXISTS "pendingQuantity",
  DROP COLUMN IF EXISTS "origin",
  DROP COLUMN IF EXISTS "compReason",
  DROP COLUMN IF EXISTS "compActorId";

-- Catalog columns + the cadence default. Restoring 'recurring' returns the
-- column to its pre-3.3 contract; existing rows were never rewritten by the
-- up, so nothing else needs undoing here.
DROP INDEX IF EXISTS "marketplace_addons_status_kind_sortOrder_idx";

ALTER TABLE "marketplace_addons"
  ALTER COLUMN "billing" SET DEFAULT 'recurring';

ALTER TABLE "marketplace_addons"
  DROP COLUMN IF EXISTS "requiresLicense",
  DROP COLUMN IF EXISTS "creditKind",
  DROP COLUMN IF EXISTS "creditUnits",
  DROP COLUMN IF EXISTS "maxQuantity",
  DROP COLUMN IF EXISTS "sortOrder",
  DROP COLUMN IF EXISTS "i18n",
  DROP COLUMN IF EXISTS "commissionRate";

-- Tenant anchor.
DROP INDEX IF EXISTS "tenants_licenseAnchorAt_idx";

ALTER TABLE "tenants"
  DROP COLUMN IF EXISTS "licenseAnchorAt";
