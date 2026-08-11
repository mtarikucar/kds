-- Rollback: return the à-la-carte catalog to `draft`.
--
-- Scoped to status='published' and to the exact codes, so an operator's own
-- archive decision survives and nothing outside this catalog is touched.
-- Ownership is unaffected either way: the projector reads TenantAddOn rows
-- regardless of the catalog row's status, so no tenant loses an entitlement
-- they paid for.
UPDATE "marketplace_addons"
   SET "status" = 'draft', "updatedAt" = NOW()
 WHERE "status" = 'published'
   AND "code" IN (
     'license_annual',
     'advanced_reports', 'module_inventory', 'module_reservations',
     'module_personnel', 'module_ai_studio', 'api_access',
     'module_external_display', 'priority_support',
     'delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek',
     'fiscal_efatura', 'fiscal_hugin', 'caller_id_integration',
     'sms_integration',
     'extra_branch',
     'credit_ai_photo_100', 'credit_ai_video_20', 'credit_ai_3d_10',
     'credit_sms_500'
   );
