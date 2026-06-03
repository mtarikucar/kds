-- v2.8.92 P3.B — FeatureEntitlement.tenantId FK + cascade
--
-- Pre-v2.8.92 FeatureEntitlement.tenantId was a free-form String column
-- with no FK. Two consequences:
--   1. Deleting a tenant left orphan rows in feature_entitlements that
--      the engine would re-read on the next reconcile sweep.
--   2. A typo in tenantId at projector write-time silently succeeded.
-- This migration adds the missing FK with ON DELETE CASCADE to match
-- every other tenant-scoped table (subscriptions, branches, users, etc).
--
-- Safe to apply with existing data: orphan-row defensive cleanup first,
-- then the constraint adds.

-- 1. Defensive cleanup — any orphan rows must go before the constraint
--    can attach. On a fresh DB this is a no-op.
DELETE FROM "feature_entitlements"
WHERE "tenantId" NOT IN (SELECT "id" FROM "tenants");

-- 2. Attach the FK with cascade semantics.
ALTER TABLE "feature_entitlements"
  ADD CONSTRAINT "feature_entitlements_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
