-- Rollback for free_core.
--
-- Restores every tenant's featureOverrides / limitOverrides / currentPlanId
-- from the archive the up wrote, and re-publishes the plan catalog. Because
-- the up copied before clearing, this is a genuine restore rather than a
-- best-effort reconstruction.
--
-- feature_entitlements is deliberately NOT restored: the table is entirely
-- engine-derived, so hand-writing rows would just be a second source of truth
-- that the next projection overwrites. Reverting the code restores the plan
-- projection, and the nightly reconcile (or any tenant mutation) rebuilds the
-- rows from source within 24h.

-- Guarded so a second run is a clean no-op: the archive table is dropped at
-- the end of this file, and an unguarded UPDATE ... FROM a missing table is a
-- hard error rather than a no-op.
DO $$
BEGIN
  IF to_regclass('public.legacy_tenant_overrides') IS NOT NULL THEN
    UPDATE "tenants" t
       SET "featureOverrides" = l."featureOverrides",
           "limitOverrides"   = l."limitOverrides",
           "currentPlanId"    = l."currentPlanId"
      FROM "legacy_tenant_overrides" l
     WHERE t."id" = l."tenantId";
  END IF;
END $$;

-- TRIAL was never public (it is assigned, not chosen); everything else was.
UPDATE "subscription_plans"
   SET "isActive" = true,
       "isPublic" = ("name" <> 'TRIAL'),
       "updatedAt" = NOW()
 WHERE "name" IN ('TRIAL', 'BASIC', 'PRO', 'BUSINESS');

DROP TABLE IF EXISTS "legacy_tenant_overrides";
