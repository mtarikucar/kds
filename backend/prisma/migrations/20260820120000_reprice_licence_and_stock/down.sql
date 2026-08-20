-- Rollback of the v3.6.7 repricing.
--
-- Restores the licence to "HummyTummy Lisansı" at ₺2.990 granting only
-- `feature.license`, puts `module_inventory` back to ₺1.490, and republishes
-- the two SKUs the up folded into the licence.
--
-- Each statement is guarded by the exact post-state the up produced, so the
-- rollback is a no-op when run twice and does not stomp a price an operator
-- has since edited by hand in the superadmin catalog UI.
--
-- Ownership is untouched here too. A tenant who bought the licence during the
-- ₺4.900 window keeps their TenantAddOn row; rolling the catalog back changes
-- what the row COSTS on the next renewal, never whether it is held. Their
-- already-charged settlement carries its own frozen pricing instant and is not
-- recomputed from the catalog.
--
-- One consequence stated rather than papered over: a tenant who bought the
-- licence while it granted priority support and e-invoicing loses BOTH grants
-- on rollback, because those grants lived on the licence row rather than on a
-- purchase of their own. If that window saw real sales, re-grant them by
-- selling the (now republished) priority_support / fiscal_efatura rows as
-- operator comps before running this down.

-- 1. Licence back to the pre-3.6.7 row.
UPDATE "marketplace_addons"
   SET "name" = 'HummyTummy Lisansı',
       "description" = 'Ücretli modülleri satın alabilmek ve kullanabilmek için gereken yıllık lisans. Satın alma tarihi hesabınızın yıl dönümü olur; sonradan aldığınız her modül bu tarihe orantılı fiyatlanır.',
       "priceCents" = 299000,
       "grants" = '{"feature.license": true}'::jsonb,
       "i18n" = '{"tr":{"name":"HummyTummy Lisansı","description":"Ücretli modülleri satın alabilmek ve kullanabilmek için gereken yıllık lisans. Satın alma tarihi hesabınızın yıl dönümü olur."},"en":{"name":"HummyTummy Licence","description":"The annual licence required to buy and use any paid module. Its purchase date becomes your account anniversary."},"ru":{"name":"Лицензия HummyTummy","description":"Годовая лицензия, необходимая для покупки и использования любого платного модуля. Дата покупки становится годовщиной вашего аккаунта."},"ar":{"name":"ترخيص HummyTummy","description":"الترخيص السنوي المطلوب لشراء واستخدام أي وحدة مدفوعة. يصبح تاريخ الشراء ذكرى حسابك السنوية."},"uz":{"name":"HummyTummy litsenziyasi","description":"Har qanday pullik modulni sotib olish va ishlatish uchun zarur yillik litsenziya. Sotib olingan sana hisobingiz yillik sanasi bo''ladi."}}'::jsonb,
       "updatedAt" = NOW()
 WHERE "code" = 'license_annual'
   AND "priceCents" = 490000;

-- 2. Stock & Cost Management back to ₺1.490.
UPDATE "marketplace_addons"
   SET "priceCents" = 149000,
       "updatedAt" = NOW()
 WHERE "code" = 'module_inventory'
   AND "priceCents" = 390000;

-- 3. Put the two folded SKUs back on sale.
UPDATE "marketplace_addons"
   SET "status" = 'published',
       "updatedAt" = NOW()
 WHERE "status" = 'archived'
   AND "code" IN ('priority_support', 'fiscal_efatura');
