-- Manual-renewal mimarisi:
-- PayTR Kart Saklama / Tekrarlayan Ödeme yetkisi mağaza 704012 için kapalı
-- (HTTP 401 on /odeme/api/recurring-payment). Auto-renew cron'u söküldü;
-- tenant'lar her cycle'da manuel checkout yapacak. Bu da iki kolonu ölü
-- bilgi haline getirdi:
--   - Tenant.paytrRecurringToken (utoken never stored anymore)
--   - Subscription.autoRenew (no auto-charge path → flag has no effect)
-- Drop them both to keep the schema honest.

ALTER TABLE "tenants" DROP COLUMN IF EXISTS "paytrRecurringToken";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "autoRenew";
