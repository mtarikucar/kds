-- @doctor:idempotent verified=single status UPDATE on marketplace_addons scoped to eight legacy codes with billing='MONTHLY' and status='published'; re-running matches nothing. Catalog/config data only.
--
-- Retire the pre-à-la-carte monthly catalog.
--
-- The à-la-carte migrations published the new annual products but left the old
-- monthly rows exactly as they were: still `published`, still billing='MONTHLY'.
-- The live price list came out of the deploy listing both, which is wrong three
-- separate ways.
--
--   1. It advertises monthly billing, in a release whose entire premise is that
--      monthly billing no longer exists.
--   2. Six of the eight duplicate a new annual product — personnel_management
--      ₺49,99/ay next to module_personnel ₺990/yıl, and so on.
--   3. Two of them sell what is now free: custom_branding and multi_branch
--      cover feature.customBranding and feature.multiLocation, both of which
--      every tenant now gets from free:baseline at no cost.
--
-- Worse than the display: the quote engine priced anything non-`annual` as a
-- flat oneTime line, so ₺49,99/month became ₺49,99 ONCE, granting the feature
-- with no period to expire — a permanent licence to a ₺990/yr module for the
-- price of one month. That hole is closed in code as well (QuoteService now
-- refuses any cadence that is neither annual nor oneTime); this migration
-- removes the rows that made it reachable.
--
-- Ownership is deliberately untouched. Archiving a catalog row stops it being
-- sold; it does not revoke anything. The projector grants from TenantAddOn
-- joined to the catalog row and never consults the row's own status, so a
-- tenant who already owns one of these keeps every grant it carries.
--
-- Scoped to the exact codes AND to billing='MONTHLY' AND status='published': an
-- operator who has already archived one keeps that decision, and a code reused
-- later for a real annual product is not caught by a stale rule.
UPDATE "marketplace_addons"
   SET "status" = 'archived', "updatedAt" = NOW()
 WHERE "status" = 'published'
   AND "billing" = 'MONTHLY'
   AND "code" IN (
     'custom_branding',
     'delivery_integration',
     'integration_efatura',
     'integration_sms',
     'inventory_tracking',
     'multi_branch',
     'personnel_management',
     'reservation_system'
   );
