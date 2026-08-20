-- @doctor:idempotent verified=three UPDATEs on marketplace_addons, each scoped by code AND by the exact pre-state it replaces (old price / old status); re-running matches nothing. Catalog/config data only, no tenant or ownership rows touched.
--
-- v3.6.7 repricing: give the licence contents, and price the stock module for
-- what it does.
--
-- Two problems this closes.
--
--   1. The licence took ₺2.990 and unlocked no capability of its own — it only
--      granted the RIGHT to buy other things. A mandatory fee that delivers
--      nothing is the highest-friction line in any quote, and the field guide
--      had to carry a dedicated objection script for it ("Bu 'lisans' da ne?").
--      Folding in the two products most often bought alongside it turns it into
--      a package with contents: priority support (₺1.990) + e-invoice filing
--      (₺1.990) + the licence (₺2.990) = ₺6.970 of separate SKUs, now ₺4.900.
--      The customer pays ₺2.070 less; the entry line rises 64%.
--
--   2. `module_inventory` at ₺1.490 was priced BELOW the reservation module
--      while being the highest-ROI thing in the catalog for a kitchen — it is
--      what makes waste measurable. The price told buyers it was a minor
--      add-on. ₺3.900 still sits far under competing suites, which bundle the
--      same capability into packages several times this.
--
-- Ownership is deliberately untouched. Archiving a catalog row stops it being
-- SOLD; it revokes nothing. The projector grants from TenantAddOn joined to the
-- catalog row and never consults that row's status, so a tenant who already
-- bought priority_support or fiscal_efatura keeps every grant it carries — and
-- now also receives the same grants from the licence. Both fold idempotently
-- (feature.* with OR, integration.* with UNION), so the overlap is harmless.
--
-- `integration.fiscal: ["efatura"]` on the licence folds with UNION against
-- fiscal_hugin's ["hugin"]. A tenant holding both ends up with
-- ["efatura","hugin"]; neither clobbers the other.

-- 1. The licence becomes "Bakım, Destek ve Güncelleme".
UPDATE "marketplace_addons"
   SET "name" = 'Bakım, Destek ve Güncelleme',
       "description" = 'Ücretli modülleri satın alabilmek ve kullanabilmek için gereken yıllık paket. Öncelikli destek, e-Fatura gönderimi, tüm sürüm güncellemeleri ve günlük yedekleme dahildir. Satın alma tarihi hesabınızın yıl dönümü olur; sonradan aldığınız her modül bu tarihe orantılı fiyatlanır.',
       "priceCents" = 490000,
       "grants" = '{"feature.license": true, "feature.prioritySupport": true, "integration.fiscal": ["efatura"]}'::jsonb,
       "i18n" = '{"tr":{"name":"Bakım, Destek ve Güncelleme","description":"Ücretli modülleri açan yıllık paket. Öncelikli destek, e-Fatura gönderimi, tüm güncellemeler ve günlük yedekleme dahil. Satın alma tarihi hesabınızın yıl dönümü olur."},"en":{"name":"Maintenance, Support & Updates","description":"The annual package that unlocks every paid module. Includes priority support, e-invoice filing, all version updates and daily backups. Its purchase date becomes your account anniversary."},"ru":{"name":"Обслуживание, поддержка и обновления","description":"Годовой пакет, открывающий все платные модули. Включает приоритетную поддержку, отправку электронных счетов, все обновления и ежедневное резервное копирование. Дата покупки становится годовщиной аккаунта."},"ar":{"name":"الصيانة والدعم والتحديثات","description":"الباقة السنوية التي تفتح كل وحدة مدفوعة. تشمل الدعم ذا الأولوية وإرسال الفاتورة الإلكترونية وجميع التحديثات والنسخ الاحتياطي اليومي. يصبح تاريخ الشراء ذكرى حسابك السنوية."},"uz":{"name":"Texnik xizmat, qo''llab-quvvatlash va yangilanishlar","description":"Barcha pullik modullarni ochadigan yillik paket. Ustuvor qo''llab-quvvatlash, e-Faktura yuborish, barcha yangilanishlar va kunlik zaxira nusxa kiradi. Sotib olingan sana hisobingiz yillik sanasi bo''ladi."}}'::jsonb,
       "updatedAt" = NOW()
 WHERE "code" = 'license_annual'
   AND "priceCents" = 299000;

-- 2. Stock & Cost Management ₺1.490 -> ₺3.900.
UPDATE "marketplace_addons"
   SET "priceCents" = 390000,
       "updatedAt" = NOW()
 WHERE "code" = 'module_inventory'
   AND "priceCents" = 149000;

-- 3. Retire the two SKUs now carried by the licence. ARCHIVED, never deleted:
-- `code` is not reusable and TenantAddOn.addOnId is onDelete: Restrict.
UPDATE "marketplace_addons"
   SET "status" = 'archived',
       "updatedAt" = NOW()
 WHERE "status" = 'published'
   AND "code" IN ('priority_support', 'fiscal_efatura');
