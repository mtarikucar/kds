-- Task 5 (DEF-6) — fix the extra_branch marketplace add-on's dead grant key.
--
-- DEFECT: seed-marketplace.ts's `extra_branch` entry wrote
-- `{ "limit.branches": 1, "feature.multiLocation": true }`, but every
-- entitlement consumer reads `limit.maxBranches` — the actual key
-- PlanProjectorService.LIMIT_COLUMNS projects from SubscriptionPlan,
-- check-limit.decorator's `LimitType.BRANCHES = "maxBranches"`, and
-- PlanFeatureGuard.checkLimit's `engineSet.limits[\`limit.${limitType}\`]`
-- lookup all agree on. PlanProjectorService.projectAddOnsTx sums a
-- catalog add-on's `grants` verbatim into the engine, so it faithfully
-- projected `limit.branches` — a key NOTHING reads. A tenant paying
-- ₺399/mo for extra_branch never actually saw their branch cap rise.
--
-- FIX: rename the key in the published catalog row. `feature.
-- multiLocation` and any other keys are left untouched (jsonb `-`
-- removes only the one key; jsonb_set adds the renamed one back with
-- the SAME value that was there, so quantity-multiplier semantics in
-- projectAddOnsTx are unaffected for tenants who bought >1 unit).
--
-- Idempotent: the `grants ? 'limit.branches'` guard makes this a
-- one-time rename — re-running it, or running it against a catalog row
-- a fresh install already seeded with the corrected seed file (which
-- never had `limit.branches` to begin with), is a no-op. Scoped to
-- exactly `code = 'extra_branch'` — no other add-on row is touched.
--
-- This is catalog/config data (MarketplaceAddOn), not tenant-owned
-- operator data (orders, inventory, entitlement ledgers) — same risk
-- class as the ai_menu_quota_plan_gating migration's subscription_plans
-- column backfill, not the hardware_inventory_seed_stock migration's
-- careful untouched-row signature guard (that one protects real stock
-- movement; this one protects nothing beyond "don't touch a row that
-- doesn't have the bug").
--
-- RE-PROJECTION NOTE for tenants who already own an active/past_due
-- extra_branch TenantAddOn: this migration only fixes the CATALOG row.
-- Those tenants' current FeatureEntitlement rows still carry the OLD
-- `limit.branches` grant from whatever projection last ran — until
-- that tenant is reprojected. No bulk FeatureEntitlement backfill is
-- done here, and none is needed:
--   PlanProjectorService.projectAddOnsTx (plan-projector.service.ts)
--   reads `TenantAddOn.addOn.grants` LIVE via a Prisma join on every
--   projection call — it never caches the catalog row — so the very
--   next reprojection for an affected tenant picks up the corrected
--   key automatically. That reprojection is triggered by:
--     1. Any lifecycle event for that tenant (subscription change, a
--        new/renewed add-on purchase, an admin override edit) — see
--        EntitlementsModule.onModuleInit's `reproject()` listener; or
--     2. At the latest, PlanProjectorService.reconcileNightly (cron
--        "15 3 * * *") walks EVERY tenant and reprojects from scratch
--        — the exact self-heal path EntitlementsModule's own module
--        doc already documents for a missed reprojection event ("A
--        missed activation therefore self-heals within ~24h").
--   Hand-patching FeatureEntitlement rows here was deliberately NOT
--   done: that table is entirely engine-derived (recomputed from
--   source on every projection), so a direct UPDATE would just be
--   overwritten by the next reproject anyway — a second, transient
--   source of truth with no value. If an affected tenant's cap must
--   rise same-day (not next-nightly-cron), the safe ops action is to
--   call PlanProjectorService.projectTenant(tenantId) for that tenant
--   (e.g. via a one-off script querying TenantAddOn WHERE addOnId =
--   the extra_branch row's id AND status IN ('active','past_due')),
--   not to edit FeatureEntitlement by hand.
UPDATE "MarketplaceAddOn"
SET grants = jsonb_set(
  grants - 'limit.branches',
  '{limit.maxBranches}',
  grants -> 'limit.branches'
)
WHERE code = 'extra_branch'
  AND grants ? 'limit.branches';
