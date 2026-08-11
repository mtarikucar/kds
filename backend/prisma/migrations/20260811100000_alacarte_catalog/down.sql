-- Rollback for alacarte_catalog.
--
-- Restores the pre-3.3 catalog LITERALLY: every code that existed before the
-- up gets its original kind, billing, price, deps and published status back;
-- every code the up introduced is deleted — but ONLY when no tenant owns it.
--
-- The NOT EXISTS guard on the delete is the important part. This is the one
-- place where a rollback could touch real operator data: if a tenant bought a
-- licence or a module between the up and the down, deleting its catalog row
-- would either fail on the Restrict FK or, worse, strand a paid entitlement.
-- Leaving such a row behind is the correct trade — a stale draft product is
-- harmless, a destroyed purchase is not.
--
-- Idempotent: re-running is a no-op (the UPDATEs converge, the DELETE matches
-- nothing the second time round).

-- ---------------------------------------------------------------------------
-- 1. Restore the pre-3.3 rows.
-- ---------------------------------------------------------------------------
-- The three device-capacity products, back to published with their dead
-- grant keys intact (the up only changed their status).
UPDATE "marketplace_addons"
   SET "status" = 'published', "updatedAt" = NOW()
 WHERE "code" IN ('kds_extra_screen', 'kds_extra_station', 'extra_tablet');

UPDATE "marketplace_addons" SET
  "kind" = 'capacity', "billing" = 'recurring', "priceCents" = 39900,
  "grants" = '{"limit.maxBranches":1,"feature.multiLocation":true}'::jsonb,
  "deps" = ARRAY[]::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'extra_branch';

UPDATE "marketplace_addons" SET
  "kind" = 'integration', "billing" = 'recurring', "priceCents" = 19900,
  "grants" = '{"integration.fiscal":["efatura"]}'::jsonb,
  "deps" = ARRAY[]::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'fiscal_efatura';

-- deps returns to {plan:PRO} — that WAS the pre-3.3 state, bug and all.
UPDATE "marketplace_addons" SET
  "kind" = 'integration', "billing" = 'recurring', "priceCents" = 29900,
  "grants" = '{"integration.fiscal":["hugin"]}'::jsonb,
  "deps" = ARRAY['plan:PRO']::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'fiscal_hugin';

UPDATE "marketplace_addons" SET
  "kind" = 'integration', "billing" = 'recurring', "priceCents" = 24900,
  "grants" = '{"integration.delivery":["yemeksepeti"]}'::jsonb,
  "deps" = ARRAY[]::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'delivery_yemeksepeti';

UPDATE "marketplace_addons" SET
  "kind" = 'integration', "billing" = 'recurring', "priceCents" = 24900,
  "grants" = '{"integration.delivery":["getir"]}'::jsonb,
  "deps" = ARRAY[]::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'delivery_getir';

UPDATE "marketplace_addons" SET
  "kind" = 'integration', "billing" = 'recurring', "priceCents" = 24900,
  "grants" = '{"integration.delivery":["trendyol_yemek"]}'::jsonb,
  "deps" = ARRAY[]::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'delivery_trendyol_yemek';

UPDATE "marketplace_addons" SET
  "kind" = 'integration', "billing" = 'recurring', "priceCents" = 14900,
  "grants" = '{"integration.caller":["generic"]}'::jsonb,
  "deps" = ARRAY[]::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'caller_id_integration';

UPDATE "marketplace_addons" SET
  "kind" = 'software', "billing" = 'recurring', "priceCents" = 12900,
  "grants" = '{"feature.advancedReports":true}'::jsonb,
  "deps" = ARRAY[]::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'advanced_reports';

UPDATE "marketplace_addons" SET
  "kind" = 'software', "billing" = 'recurring', "priceCents" = 24900,
  "grants" = '{"feature.apiAccess":true}'::jsonb,
  "deps" = ARRAY[]::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'api_access';

UPDATE "marketplace_addons" SET
  "kind" = 'support', "billing" = 'recurring', "priceCents" = 19900,
  "grants" = '{"feature.prioritySupport":true}'::jsonb,
  "deps" = ARRAY[]::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'priority_support';

UPDATE "marketplace_addons" SET
  "kind" = 'support', "billing" = 'oneTime', "priceCents" = 750000,
  "grants" = '{}'::jsonb,
  "deps" = ARRAY[]::TEXT[], "status" = 'published', "updatedAt" = NOW()
 WHERE "code" = 'onsite_install_full';

-- Clear the à-la-carte-only metadata from every restored row so the rollback
-- leaves no residue. (The COLUMNS themselves belong to the groundwork
-- migration and are dropped by ITS down, not this one.)
UPDATE "marketplace_addons" SET
  "requiresLicense" = true, "creditKind" = NULL, "creditUnits" = NULL,
  "maxQuantity" = NULL, "sortOrder" = 0, "i18n" = NULL
 WHERE "code" IN (
   'kds_extra_screen', 'kds_extra_station', 'extra_tablet', 'extra_branch',
   'fiscal_efatura', 'fiscal_hugin', 'delivery_yemeksepeti', 'delivery_getir',
   'delivery_trendyol_yemek', 'caller_id_integration', 'advanced_reports',
   'api_access', 'priority_support', 'onsite_install_full'
 );

-- ---------------------------------------------------------------------------
-- 2. Remove the products this migration introduced — but never a paid one.
-- ---------------------------------------------------------------------------
DELETE FROM "marketplace_addons" m
 WHERE m."code" IN (
   'license_annual',
   'module_inventory', 'module_reservations', 'module_personnel',
   'module_ai_studio', 'module_external_display',
   'sms_integration',
   'credit_ai_photo_100', 'credit_ai_video_20', 'credit_ai_3d_10',
   'credit_sms_500'
 )
   AND NOT EXISTS (
     SELECT 1 FROM "tenant_addons" ta WHERE ta."addOnId" = m."id"
   );
