-- Branch-centric device hub: designate each tenant's "Merkez/HQ" branch — the
-- home for central (şubesiz) devices. Additive + idempotent (safe to re-run on
-- the deploy baseline pipeline). Pure label/bucket; does NOT affect branch
-- capacity counting.
ALTER TABLE "Branch"
  ADD COLUMN IF NOT EXISTS "isHeadquarters" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: the seeded MAIN branch is the HQ. Run only if no HQ exists yet for
-- the tenant (idempotent — re-runs are no-ops once one is set).
UPDATE "Branch" b
   SET "isHeadquarters" = true
 WHERE b."code" = 'MAIN'
   AND NOT EXISTS (
     SELECT 1 FROM "Branch" h
      WHERE h."tenantId" = b."tenantId" AND h."isHeadquarters" = true
   );

-- Fallback for tenants without a MAIN-coded branch: the earliest branch becomes
-- HQ (one per tenant, only when none is flagged yet).
UPDATE "Branch" b
   SET "isHeadquarters" = true
 WHERE b."id" = (
         SELECT b2."id" FROM "Branch" b2
          WHERE b2."tenantId" = b."tenantId"
          ORDER BY b2."createdAt" ASC, b2."id" ASC
          LIMIT 1
       )
   AND NOT EXISTS (
     SELECT 1 FROM "Branch" h
      WHERE h."tenantId" = b."tenantId" AND h."isHeadquarters" = true
   );
