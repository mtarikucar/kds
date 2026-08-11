-- @doctor:idempotent verified=archive INSERT is ON CONFLICT DO NOTHING; the tenant UPDATE is scoped to rows that still carry a value; the plan UPDATE and the entitlement DELETE converge on re-run. Every value cleared here is first copied into legacy_tenant_overrides, so the down restores it exactly.
--
-- FREE CORE (P3 of 9) — the behavioural flip.
--
-- Three things happen here, and they must happen together with the code in
-- the same release: the projector rewrite, the guard replacement and this
-- migration are one change. Split them and you get either "everything free
-- and ungated" or "everything locked".
--
-- 1. ARCHIVE AND CLEAR tenants.featureOverrides / limitOverrides.
--
--    This is the single highest-risk item in the whole migration. Provisioning
--    seeded featureOverrides with the plan's TRUE feature flags so
--    PlanFeatureGuard's fallback resolved during the projector's warm-up. The
--    new projector turns every key in that map into an `override:admin` grant
--    — so WITHOUT this step every existing tenant would wake up holding
--    permanent overrides for the entire paid feature set: every module, free,
--    forever, re-asserted nightly by the reconcile cron.
--
--    The values are copied first, so `down.sql` can put them back byte for
--    byte. Nothing is destroyed.
--
-- 2. NULL tenants.currentPlanId. Plans no longer decide access. The pointer is
--    archived alongside the overrides.
--
-- 3. DELETE plan-sourced entitlement rows. `feature_entitlements` is entirely
--    engine-derived — the projector recomputes it from source on every run —
--    so deleting the stale plan rows is safe and the baseline replaces them on
--    the next projection. The down does NOT recreate them for the same reason.
--
-- Table names are the snake_case @@map names.

-- ---------------------------------------------------------------------------
-- 1. Archive
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "legacy_tenant_overrides" (
  "tenantId"         TEXT NOT NULL,
  "featureOverrides" JSONB,
  "limitOverrides"   JSONB,
  "currentPlanId"    TEXT,
  "archivedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "legacy_tenant_overrides_pkey" PRIMARY KEY ("tenantId")
);

INSERT INTO "legacy_tenant_overrides"
  ("tenantId", "featureOverrides", "limitOverrides", "currentPlanId")
SELECT "id", "featureOverrides", "limitOverrides", "currentPlanId"
  FROM "tenants"
 WHERE "featureOverrides" IS NOT NULL
    OR "limitOverrides" IS NOT NULL
    OR "currentPlanId" IS NOT NULL
ON CONFLICT ("tenantId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Clear
-- ---------------------------------------------------------------------------
UPDATE "tenants"
   SET "featureOverrides" = NULL,
       "limitOverrides"   = NULL,
       "currentPlanId"    = NULL
 WHERE "featureOverrides" IS NOT NULL
    OR "limitOverrides" IS NOT NULL
    OR "currentPlanId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Retire the plan catalog (rows kept — see below)
-- ---------------------------------------------------------------------------
-- NOT dropped. `subscriptions.planId` is a Restrict FK and the legacy
-- `invoices` table hangs off `subscriptions`; those invoices are tax records
-- Turkish VUK requires retaining for years. Three inert rows cost nothing, and
-- a migration whose down cannot restore what it destroyed is not reversible.
UPDATE "subscription_plans"
   SET "isActive" = false, "isPublic" = false, "updatedAt" = NOW()
 WHERE "isActive" = true OR "isPublic" = true;

-- ---------------------------------------------------------------------------
-- 4. Sweep plan-sourced grants
-- ---------------------------------------------------------------------------
-- Engine-derived data. The projector rebuilds every tenant's set from source
-- (free baseline + owned products + overrides) on the next projection, and the
-- nightly reconcile guarantees it within 24h for anyone not touched sooner.
DELETE FROM "feature_entitlements"
 WHERE "source" LIKE 'plan:%';
