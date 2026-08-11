-- @doctor:idempotent verified=single status UPDATE on marketplace_addons scoped to the a-la-carte codes and status='draft'; re-running matches nothing. Catalog/config data only.
--
-- Publish the à-la-carte catalog (P2 of 9).
--
-- P1 deliberately landed every annual and credit product as `draft`, because
-- the quote engine could not yet price an annual cadence: it mapped anything
-- non-`recurring` to a oneTime line and purchase() gave it a rolling 30-day
-- period, so a published ₺2.990/yr licence would have been sold as a flat
-- 30-day charge.
--
-- That is now fixed. QuoteService day-prorates annual lines to the tenant's
-- licence anniversary, CheckoutIntent freezes the pricing instant so
-- settlement re-quotes deterministically, and purchase() provisions the
-- anniversary-aligned period the line was priced for. The catalog can go live.
--
-- Scoped to the exact product codes and to status='draft': an operator who
-- has deliberately archived one of these rows keeps that decision.
UPDATE "marketplace_addons"
   SET "status" = 'published', "updatedAt" = NOW()
 WHERE "status" = 'draft'
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
