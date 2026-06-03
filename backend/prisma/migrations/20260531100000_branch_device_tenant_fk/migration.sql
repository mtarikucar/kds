-- v2.8.93 P0 — Branch + Device tenantId FK + cascade
--
-- Pre-v2.8.93 the Branch.tenantId and Device.tenantId columns were
-- free-form String with no FK declaration in Prisma. Two consequences,
-- same as the v2.8.92 FeatureEntitlement cleanup:
--   1. Orphan rows survive tenant deletion (the engine reconcile sweep,
--      stock totals, device mesh routing all re-read them).
--   2. A typo at write-time silently succeeds (no `tenants.id` lookup).
-- This migration adds the missing FKs with ON DELETE CASCADE.

-- Defensive cleanup first — orphan rows must go before the constraint
-- can attach. No-op on a fresh DB.
DELETE FROM "branches"
WHERE "tenantId" NOT IN (SELECT "id" FROM "tenants");

DELETE FROM "devices"
WHERE "tenantId" NOT IN (SELECT "id" FROM "tenants");

-- Attach the FKs with cascade semantics.
ALTER TABLE "branches"
  ADD CONSTRAINT "branches_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
