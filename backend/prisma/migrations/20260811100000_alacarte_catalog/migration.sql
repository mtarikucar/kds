-- @doctor:idempotent verified=all writes are ON CONFLICT (code) DO UPDATE or status-scoped UPDATEs on marketplace_addons (catalog/config data, not tenant-owned). Re-running converges to the same catalog. Touches no tenant_addons, no entitlements, no orders.
--
-- À-la-carte catalog (P1 of 9).
--
-- Replaces the tier-era add-on catalog with the à-la-carte product list:
-- one annual Licence, eight modules, seven integrations, one capacity item,
-- four credit packs, one service. Source of truth is
-- src/modules/marketplace/alacarte-catalog.const.ts; this file is generated
-- from it and a spec re-parses it to prove the two never diverge (a price
-- that lives only in the seed means dev and production charge differently).
--
-- WHY EVERY ANNUAL ROW LANDS AS `draft`
--
-- The quote engine cannot price an annual cadence yet — that is P2. Today
-- QuoteService maps anything that is not `recurring` to a oneTime line, and
-- TenantMarketplaceService gives anything that is not `oneTime` a 30-day
-- period. Publishing an `annual` row here would therefore sell a ₺2.990
-- yearly product as a flat charge with a 30-day period. Drafting is the
-- honest option: for one release the store shows only hardware and the
-- on-site service, and P2 publishes the catalog together with the proration
-- that makes it correct. There are no paying subscribers to disrupt.
--
-- Ownership is unaffected: the projector reads TenantAddOn rows regardless of
-- the catalog row's status, so nobody loses an entitlement they paid for.
--
-- Table names are the snake_case @@map names — `marketplace_addons`, not
-- `"MarketplaceAddOn"` (a past production incident took 42P01 on exactly this).

-- ---------------------------------------------------------------------------
-- 1. Retire the device-capacity products.
-- ---------------------------------------------------------------------------
-- ARCHIVED, never deleted: `code` may not be reused and TenantAddOn.addOnId is
-- onDelete: Restrict, so a DELETE would either fail or orphan a paying tenant.
-- All three granted limit.kdsScreens / limit.kdsStations / limit.tablets —
-- keys no enforcement code has ever read. They took money and capped nothing.
UPDATE "marketplace_addons"
   SET "status" = 'archived', "updatedAt" = NOW()
 WHERE "code" IN ('kds_extra_screen', 'kds_extra_station', 'extra_tablet')
   AND "status" <> 'archived';

-- ---------------------------------------------------------------------------
-- 2. Upsert the à-la-carte catalog.
-- ---------------------------------------------------------------------------
-- Existing codes are REUSED rather than replaced (advanced_reports, api_access,
-- priority_support, extra_branch, the fiscal/delivery/caller integrations,
-- onsite_install_full) so no tenant's TenantAddOn.addOnId is invalidated.
--
-- Note fiscal_hugin: its deps go from {plan:PRO} to {}. Plans are retired, so
-- leaving that dep would 400 every Hugin purchase the moment currentPlanId
-- goes null in P3.
--
-- Note the delivery rows: they now also grant feature.deliveryIntegration.
-- The domain flag folds with OR, so owning any one platform lights up the
-- delivery UI and buying a second is idempotent.

-- license_annual
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'license_annual', 'HummyTummy Lisansı', 'Ücretli modülleri satın alabilmek ve kullanabilmek için gereken yıllık lisans. Satın alma tarihi hesabınızın yıl dönümü olur; sonradan aldığınız her modül bu tarihe orantılı fiyatlanır.',
  'license', 'annual', 299000, 'TRY',
  '{"feature.license":true}'::jsonb, ARRAY[]::TEXT[], 'draft', false,
  NULL, NULL,
  NULL, 0, '{"tr":{"name":"HummyTummy Lisansı","description":"Ücretli modülleri satın alabilmek ve kullanabilmek için gereken yıllık lisans. Satın alma tarihi hesabınızın yıl dönümü olur."},"en":{"name":"HummyTummy Licence","description":"The annual licence required to buy and use any paid module. Its purchase date becomes your account anniversary."},"ru":{"name":"Лицензия HummyTummy","description":"Годовая лицензия, необходимая для покупки и использования любого платного модуля. Дата покупки становится годовщиной вашего аккаунта."},"ar":{"name":"ترخيص HummyTummy","description":"الترخيص السنوي المطلوب لشراء واستخدام أي وحدة مدفوعة. يصبح تاريخ الشراء ذكرى حسابك السنوية."},"uz":{"name":"HummyTummy litsenziyasi","description":"Har qanday pullik modulni sotib olish va ishlatish uchun zarur yillik litsenziya. Sotib olingan sana hisobingiz yillik sanasi bo''ladi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- advanced_reports
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'advanced_reports', 'Gelişmiş Rapor & Analitik', 'Detaylı satış, ürün, personel ve müşteri analitiği; muhasebe back-office ve e-belge ayarları.',
  'module', 'annual', 129000, 'TRY',
  '{"feature.advancedReports":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 10, '{"tr":{"name":"Gelişmiş Rapor & Analitik","description":"Detaylı satış, ürün, personel ve müşteri analitiği ile muhasebe back-office."},"en":{"name":"Advanced Reports & Analytics","description":"Detailed sales, product, staff and customer analytics plus the accounting back-office."},"ru":{"name":"Расширенные отчёты и аналитика","description":"Подробная аналитика продаж, товаров, персонала и клиентов, а также бухгалтерский бэк-офис."},"ar":{"name":"التقارير والتحليلات المتقدمة","description":"تحليلات مفصلة للمبيعات والمنتجات والموظفين والعملاء بالإضافة إلى مكتب المحاسبة الخلفي."},"uz":{"name":"Kengaytirilgan hisobot va tahlil","description":"Savdo, mahsulot, xodimlar va mijozlar bo''yicha batafsil tahlil hamda buxgalteriya back-office."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- module_inventory
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'module_inventory', 'Stok & Maliyet Yönetimi', 'Reçete, stok sayımı, satın alma siparişi, fire takibi, tedarikçi yönetimi ve şubeler arası transfer.',
  'module', 'annual', 149000, 'TRY',
  '{"feature.inventoryTracking":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 11, '{"tr":{"name":"Stok & Maliyet Yönetimi","description":"Reçete, sayım, satın alma siparişi, fire takibi, tedarikçi ve şubeler arası transfer."},"en":{"name":"Inventory & Cost Management","description":"Recipes, stock counts, purchase orders, waste tracking, suppliers and inter-branch transfers."},"ru":{"name":"Управление запасами и себестоимостью","description":"Рецепты, инвентаризация, заказы поставщикам, учёт списаний, поставщики и переводы между филиалами."},"ar":{"name":"إدارة المخزون والتكاليف","description":"الوصفات وجرد المخزون وأوامر الشراء وتتبع الهدر والموردين والتحويلات بين الفروع."},"uz":{"name":"Ombor va tannarx boshqaruvi","description":"Retseptlar, inventarizatsiya, xarid buyurtmalari, chiqindi hisobi, ta''minotchilar va filiallararo transfer."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- module_reservations
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'module_reservations', 'Rezervasyon Sistemi', 'Rezervasyon takvimi, müsaitlik hesabı, halka açık online rezervasyon sayfası ve personel rezervasyon girişi.',
  'module', 'annual', 99000, 'TRY',
  '{"feature.reservationSystem":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 12, '{"tr":{"name":"Rezervasyon Sistemi","description":"Rezervasyon takvimi, müsaitlik hesabı ve halka açık online rezervasyon sayfası."},"en":{"name":"Reservation System","description":"Booking calendar, availability engine and a public online reservation page."},"ru":{"name":"Система бронирования","description":"Календарь броней, расчёт доступности и публичная страница онлайн-бронирования."},"ar":{"name":"نظام الحجوزات","description":"تقويم الحجوزات ومحرك التوافر وصفحة حجز إلكترونية عامة."},"uz":{"name":"Rezervatsiya tizimi","description":"Bron kalendari, bandlik hisobi va ommaviy onlayn rezervatsiya sahifasi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- module_personnel
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'module_personnel', 'Personel Yönetimi', 'Puantaj, vardiya planlama, vardiya değişimi ve personel performans takibi.',
  'module', 'annual', 99000, 'TRY',
  '{"feature.personnelManagement":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 13, '{"tr":{"name":"Personel Yönetimi","description":"Puantaj, vardiya planlama, vardiya değişimi ve performans takibi."},"en":{"name":"Staff Management","description":"Attendance, shift planning, shift swaps and performance tracking."},"ru":{"name":"Управление персоналом","description":"Табель учёта, планирование смен, обмен сменами и отслеживание эффективности."},"ar":{"name":"إدارة الموظفين","description":"الحضور وتخطيط الورديات وتبادل الورديات وتتبع الأداء."},"uz":{"name":"Xodimlarni boshqarish","description":"Davomat, smena rejalashtirish, smena almashinuvi va samaradorlik nazorati."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- module_ai_studio
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'module_ai_studio', 'AI Menü Stüdyosu', 'Yapay zekâ ile ürün fotoğrafı, video ve 3D model üretimi, menü OCR içe aktarma. Üretimler kontörle harcanır.',
  'module', 'annual', 199000, 'TRY',
  '{"feature.aiContentGeneration":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 14, '{"tr":{"name":"AI Menü Stüdyosu","description":"Yapay zekâ ile ürün fotoğrafı, video ve 3D model üretimi ile menü OCR içe aktarma. Üretimler kontörle harcanır."},"en":{"name":"AI Menu Studio","description":"AI-generated product photos, video and 3D models, plus OCR menu import. Generations are paid for with credits."},"ru":{"name":"AI-студия меню","description":"Генерация фото, видео и 3D-моделей товаров с помощью ИИ и импорт меню через OCR. Генерации расходуют кредиты."},"ar":{"name":"استوديو القائمة بالذكاء الاصطناعي","description":"إنشاء صور ومقاطع فيديو ونماذج ثلاثية الأبعاد للمنتجات بالذكاء الاصطناعي واستيراد القائمة عبر OCR. تُخصم عمليات الإنشاء من الرصيد."},"uz":{"name":"AI menyu studiyasi","description":"Sun''iy intellekt bilan mahsulot fotosurati, video va 3D model yaratish hamda OCR orqali menyu import qilish. Yaratishlar kredit hisobidan yechiladi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- api_access
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'api_access', 'API & Webhook Erişimi', 'Kendi sistemlerinizi bağlamak için REST API anahtarları ve giden webhook''lar.',
  'module', 'annual', 249000, 'TRY',
  '{"feature.apiAccess":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 15, '{"tr":{"name":"API & Webhook Erişimi","description":"Kendi sistemlerinizi bağlamak için REST API anahtarları ve giden webhook''lar."},"en":{"name":"API & Webhook Access","description":"REST API keys and outbound webhooks for connecting your own systems."},"ru":{"name":"Доступ к API и вебхукам","description":"Ключи REST API и исходящие вебхуки для подключения ваших систем."},"ar":{"name":"الوصول إلى API والويب هوك","description":"مفاتيح REST API وخطافات الويب الصادرة لربط أنظمتك الخاصة."},"uz":{"name":"API va Webhook kirishi","description":"O''z tizimlaringizni ulash uchun REST API kalitlari va chiquvchi webhook''lar."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- module_external_display
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'module_external_display', 'Partner Ekran API', 'Üçüncü taraf ekranların (masa tabletleri, harici menü ekranları) menünüzü göstermesi için ekran bazlı API erişimi.',
  'module', 'annual', 199000, 'TRY',
  '{"feature.externalDisplay":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 16, '{"tr":{"name":"Partner Ekran API","description":"Üçüncü taraf ekranların menünüzü göstermesi için ekran bazlı API erişimi."},"en":{"name":"Partner Display API","description":"Per-screen API access so third-party displays can show your menu."},"ru":{"name":"API партнёрских экранов","description":"Доступ к API на уровне экрана, чтобы сторонние дисплеи показывали ваше меню."},"ar":{"name":"واجهة برمجة شاشات الشركاء","description":"وصول برمجي لكل شاشة حتى تتمكن الشاشات الخارجية من عرض قائمتك."},"uz":{"name":"Hamkor ekran API","description":"Uchinchi tomon ekranlari menyungizni ko''rsatishi uchun ekran darajasidagi API kirishi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- priority_support
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'priority_support', 'Öncelikli Destek', 'Destek taleplerinizde öncelikli sıra ve garantili yanıt süresi.',
  'module', 'annual', 199000, 'TRY',
  '{"feature.prioritySupport":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 17, '{"tr":{"name":"Öncelikli Destek","description":"Destek taleplerinizde öncelikli sıra ve garantili yanıt süresi."},"en":{"name":"Priority Support","description":"Front-of-queue support with a guaranteed response time."},"ru":{"name":"Приоритетная поддержка","description":"Приоритетная очередь обращений и гарантированное время ответа."},"ar":{"name":"الدعم ذو الأولوية","description":"أولوية في طابور الدعم مع زمن استجابة مضمون."},"uz":{"name":"Ustuvor qo''llab-quvvatlash","description":"Murojaatlarda ustuvor navbat va kafolatlangan javob vaqti."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- delivery_yemeksepeti
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'delivery_yemeksepeti', 'Yemeksepeti Entegrasyonu', 'Yemeksepeti siparişlerinin otomatik olarak POS ve mutfağa düşmesi.',
  'integration', 'annual', 249000, 'TRY',
  '{"integration.delivery":["yemeksepeti"],"feature.deliveryIntegration":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 20, '{"tr":{"name":"Yemeksepeti Entegrasyonu","description":"Yemeksepeti siparişleri otomatik olarak POS ve mutfağa düşer."},"en":{"name":"Yemeksepeti Integration","description":"Yemeksepeti orders flow automatically into the POS and the kitchen."},"ru":{"name":"Интеграция Yemeksepeti","description":"Заказы Yemeksepeti автоматически поступают в POS и на кухню."},"ar":{"name":"تكامل Yemeksepeti","description":"تصل طلبات Yemeksepeti تلقائيًا إلى نقطة البيع والمطبخ."},"uz":{"name":"Yemeksepeti integratsiyasi","description":"Yemeksepeti buyurtmalari avtomatik ravishda POS va oshxonaga tushadi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- delivery_getir
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'delivery_getir', 'Getir Entegrasyonu', 'Getir siparişlerinin otomatik olarak POS ve mutfağa düşmesi.',
  'integration', 'annual', 249000, 'TRY',
  '{"integration.delivery":["getir"],"feature.deliveryIntegration":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 21, '{"tr":{"name":"Getir Entegrasyonu","description":"Getir siparişleri otomatik olarak POS ve mutfağa düşer."},"en":{"name":"Getir Integration","description":"Getir orders flow automatically into the POS and the kitchen."},"ru":{"name":"Интеграция Getir","description":"Заказы Getir автоматически поступают в POS и на кухню."},"ar":{"name":"تكامل Getir","description":"تصل طلبات Getir تلقائيًا إلى نقطة البيع والمطبخ."},"uz":{"name":"Getir integratsiyasi","description":"Getir buyurtmalari avtomatik ravishda POS va oshxonaga tushadi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- delivery_trendyol_yemek
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'delivery_trendyol_yemek', 'Trendyol Yemek Entegrasyonu', 'Trendyol Yemek siparişlerinin otomatik olarak POS ve mutfağa düşmesi.',
  'integration', 'annual', 249000, 'TRY',
  '{"integration.delivery":["trendyol_yemek"],"feature.deliveryIntegration":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 22, '{"tr":{"name":"Trendyol Yemek Entegrasyonu","description":"Trendyol Yemek siparişleri otomatik olarak POS ve mutfağa düşer."},"en":{"name":"Trendyol Yemek Integration","description":"Trendyol Yemek orders flow automatically into the POS and the kitchen."},"ru":{"name":"Интеграция Trendyol Yemek","description":"Заказы Trendyol Yemek автоматически поступают в POS и на кухню."},"ar":{"name":"تكامل Trendyol Yemek","description":"تصل طلبات Trendyol Yemek تلقائيًا إلى نقطة البيع والمطبخ."},"uz":{"name":"Trendyol Yemek integratsiyasi","description":"Trendyol Yemek buyurtmalari avtomatik ravishda POS va oshxonaga tushadi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- fiscal_efatura
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'fiscal_efatura', 'e-Fatura (Nilvera)', 'Satış faturalarınızın Nilvera üzerinden e-Fatura / e-Arşiv olarak GİB''e gönderilmesi.',
  'integration', 'annual', 199000, 'TRY',
  '{"integration.fiscal":["efatura"]}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 23, '{"tr":{"name":"e-Fatura (Nilvera)","description":"Satış faturalarınız Nilvera üzerinden e-Fatura / e-Arşiv olarak gönderilir."},"en":{"name":"e-Invoice (Nilvera)","description":"Your sales invoices are filed as e-Fatura / e-Arşiv through Nilvera."},"ru":{"name":"Электронный счёт (Nilvera)","description":"Ваши счета отправляются как e-Fatura / e-Arşiv через Nilvera."},"ar":{"name":"الفاتورة الإلكترونية (Nilvera)","description":"تُرسل فواتير مبيعاتك كفاتورة إلكترونية عبر Nilvera."},"uz":{"name":"e-Faktura (Nilvera)","description":"Savdo hisob-fakturalaringiz Nilvera orqali e-Faktura sifatida yuboriladi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- fiscal_hugin
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'fiscal_hugin', 'ÖKC / Yazarkasa (Hugin)', 'Hugin yazarkasa ile entegre fiş kesimi ve mali rapor senkronizasyonu.',
  'integration', 'annual', 299000, 'TRY',
  '{"integration.fiscal":["hugin"]}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 24, '{"tr":{"name":"ÖKC / Yazarkasa (Hugin)","description":"Hugin yazarkasa ile entegre fiş kesimi ve mali rapor senkronizasyonu."},"en":{"name":"Fiscal Printer (Hugin)","description":"Integrated receipt printing and fiscal report sync with a Hugin device."},"ru":{"name":"Фискальный регистратор (Hugin)","description":"Интегрированная печать чеков и синхронизация фискальных отчётов с Hugin."},"ar":{"name":"الطابعة الضريبية (Hugin)","description":"طباعة إيصالات متكاملة ومزامنة التقارير الضريبية مع جهاز Hugin."},"uz":{"name":"Fiskal printer (Hugin)","description":"Hugin qurilmasi bilan integratsiyalashgan chek chiqarish va fiskal hisobot sinxronizatsiyasi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- caller_id_integration
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'caller_id_integration', 'Çağrı-ID Entegrasyonu', 'Gelen telefon çağrılarında müşteriyi otomatik tanıma ve tek tıkla sipariş açma.',
  'integration', 'annual', 149000, 'TRY',
  '{"integration.caller":["generic"]}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 25, '{"tr":{"name":"Çağrı-ID Entegrasyonu","description":"Gelen çağrılarda müşteriyi otomatik tanıyın, tek tıkla sipariş açın."},"en":{"name":"Caller-ID Integration","description":"Recognise the customer on an incoming call and open an order in one click."},"ru":{"name":"Интеграция Caller-ID","description":"Автоматическое распознавание клиента при входящем звонке и заказ в один клик."},"ar":{"name":"تكامل معرّف المتصل","description":"التعرف تلقائيًا على العميل عند المكالمة الواردة وفتح طلب بنقرة واحدة."},"uz":{"name":"Caller-ID integratsiyasi","description":"Kiruvchi qo''ng''iroqda mijozni avtomatik aniqlang va bir bosishda buyurtma oching."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- sms_integration
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'sms_integration', 'SMS Bildirimleri', 'Sipariş, rezervasyon ve kampanya SMS''leri. Gönderimler kontörle harcanır.',
  'integration', 'annual', 99000, 'TRY',
  '{"integration.sms":["*"]}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  NULL, 26, '{"tr":{"name":"SMS Bildirimleri","description":"Sipariş, rezervasyon ve kampanya SMS''leri. Gönderimler kontörle harcanır."},"en":{"name":"SMS Notifications","description":"Order, reservation and campaign SMS. Each send is paid for with credits."},"ru":{"name":"SMS-уведомления","description":"SMS о заказах, бронях и акциях. Каждая отправка расходует кредиты."},"ar":{"name":"إشعارات الرسائل القصيرة","description":"رسائل الطلبات والحجوزات والحملات. تُخصم كل رسالة من الرصيد."},"uz":{"name":"SMS bildirishnomalari","description":"Buyurtma, rezervatsiya va kampaniya SMS''lari. Har bir yuborish kredit hisobidan yechiladi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- extra_branch
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'extra_branch', 'Ek Şube', 'Hesabınıza bir şube daha ekler. İlk şube ücretsizdir. Adet olarak alınabilir.',
  'capacity', 'annual', 399000, 'TRY',
  '{"limit.maxBranches":1,"feature.multiLocation":true}'::jsonb, ARRAY[]::TEXT[], 'draft', true,
  NULL, NULL,
  100, 30, '{"tr":{"name":"Ek Şube","description":"Hesabınıza bir şube daha ekler. İlk şube ücretsizdir."},"en":{"name":"Extra Branch","description":"Adds one more branch to your account. The first branch is free."},"ru":{"name":"Дополнительный филиал","description":"Добавляет ещё один филиал. Первый филиал бесплатный."},"ar":{"name":"فرع إضافي","description":"يضيف فرعًا آخر إلى حسابك. الفرع الأول مجاني."},"uz":{"name":"Qo''shimcha filial","description":"Hisobingizga yana bitta filial qo''shadi. Birinchi filial bepul."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- credit_ai_photo_100
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'credit_ai_photo_100', '100 AI Görsel Kontörü', '100 adet yapay zekâ ürün görseli üretim hakkı. Süresi yoktur, tükenene kadar geçerlidir.',
  'credit', 'oneTime', 69000, 'TRY',
  '{}'::jsonb, ARRAY['module_ai_studio']::TEXT[], 'draft', false,
  'PHOTO', 100,
  NULL, 40, '{"tr":{"name":"100 AI Görsel Kontörü","description":"100 adet yapay zekâ görsel üretimi. Süresiz — tükenene kadar geçerli."},"en":{"name":"100 AI Image Credits","description":"100 AI image generations. No expiry — valid until consumed."},"ru":{"name":"100 кредитов AI-изображений","description":"100 генераций изображений ИИ. Без срока — действуют до израсходования."},"ar":{"name":"100 رصيد صور بالذكاء الاصطناعي","description":"100 عملية إنشاء صورة. بلا انتهاء صلاحية — صالحة حتى النفاد."},"uz":{"name":"100 ta AI rasm krediti","description":"100 ta AI rasm yaratish. Muddatsiz — tugaguncha amal qiladi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- credit_ai_video_20
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'credit_ai_video_20', '20 AI Video Kontörü', '20 adet yapay zekâ ürün videosu üretim hakkı. Süresi yoktur, tükenene kadar geçerlidir.',
  'credit', 'oneTime', 89000, 'TRY',
  '{}'::jsonb, ARRAY['module_ai_studio']::TEXT[], 'draft', false,
  'VIDEO', 20,
  NULL, 41, '{"tr":{"name":"20 AI Video Kontörü","description":"20 adet yapay zekâ video üretimi. Süresiz — tükenene kadar geçerli."},"en":{"name":"20 AI Video Credits","description":"20 AI video generations. No expiry — valid until consumed."},"ru":{"name":"20 кредитов AI-видео","description":"20 генераций видео ИИ. Без срока — действуют до израсходования."},"ar":{"name":"20 رصيد فيديو بالذكاء الاصطناعي","description":"20 عملية إنشاء فيديو. بلا انتهاء صلاحية — صالحة حتى النفاد."},"uz":{"name":"20 ta AI video krediti","description":"20 ta AI video yaratish. Muddatsiz — tugaguncha amal qiladi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- credit_ai_3d_10
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'credit_ai_3d_10', '10 AI 3D Model Kontörü', '10 adet yapay zekâ 3D ürün modeli üretim hakkı. Süresi yoktur, tükenene kadar geçerlidir.',
  'credit', 'oneTime', 79000, 'TRY',
  '{}'::jsonb, ARRAY['module_ai_studio']::TEXT[], 'draft', false,
  'MODEL3D', 10,
  NULL, 42, '{"tr":{"name":"10 AI 3D Model Kontörü","description":"10 adet yapay zekâ 3D model üretimi. Süresiz — tükenene kadar geçerli."},"en":{"name":"10 AI 3D Model Credits","description":"10 AI 3D model generations. No expiry — valid until consumed."},"ru":{"name":"10 кредитов AI 3D-моделей","description":"10 генераций 3D-моделей ИИ. Без срока — действуют до израсходования."},"ar":{"name":"10 رصيد نموذج ثلاثي الأبعاد","description":"10 عمليات إنشاء نموذج ثلاثي الأبعاد. بلا انتهاء صلاحية — صالحة حتى النفاد."},"uz":{"name":"10 ta AI 3D model krediti","description":"10 ta AI 3D model yaratish. Muddatsiz — tugaguncha amal qiladi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- credit_sms_500
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'credit_sms_500', '500 SMS Kontörü', '500 adet SMS gönderim hakkı. Süresi yoktur, tükenene kadar geçerlidir.',
  'credit', 'oneTime', 49000, 'TRY',
  '{}'::jsonb, ARRAY['sms_integration']::TEXT[], 'draft', false,
  'SMS', 500,
  NULL, 43, '{"tr":{"name":"500 SMS Kontörü","description":"500 adet SMS gönderimi. Süresiz — tükenene kadar geçerli."},"en":{"name":"500 SMS Credits","description":"500 SMS sends. No expiry — valid until consumed."},"ru":{"name":"500 SMS-кредитов","description":"500 отправок SMS. Без срока — действуют до израсходования."},"ar":{"name":"500 رصيد رسائل قصيرة","description":"500 عملية إرسال رسالة. بلا انتهاء صلاحية — صالحة حتى النفاد."},"uz":{"name":"500 ta SMS krediti","description":"500 ta SMS yuborish. Muddatsiz — tugaguncha amal qiladi."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- onsite_install_full
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'onsite_install_full', 'Yerinde Kurulum & Eğitim', 'Tam gün yerinde kurulum, cihaz devreye alma ve personel eğitimi. Tek seferlik hizmet.',
  'service', 'oneTime', 750000, 'TRY',
  '{}'::jsonb, ARRAY[]::TEXT[], 'published', false,
  NULL, NULL,
  NULL, 50, '{"tr":{"name":"Yerinde Kurulum & Eğitim","description":"Tam gün yerinde kurulum, cihaz devreye alma ve personel eğitimi."},"en":{"name":"On-site Installation & Training","description":"A full day of on-site installation, device commissioning and staff training."},"ru":{"name":"Установка и обучение на месте","description":"Полный день установки на месте, ввода устройств в эксплуатацию и обучения персонала."},"ar":{"name":"التركيب والتدريب في الموقع","description":"يوم كامل من التركيب في الموقع وتشغيل الأجهزة وتدريب الموظفين."},"uz":{"name":"Joyida o''rnatish va o''qitish","description":"To''liq kunlik joyida o''rnatish, qurilmalarni ishga tushirish va xodimlarni o''qitish."}}'::jsonb, 0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "description"     = EXCLUDED."description",
  "kind"            = EXCLUDED."kind",
  "billing"         = EXCLUDED."billing",
  "priceCents"      = EXCLUDED."priceCents",
  "grants"          = EXCLUDED."grants",
  "deps"            = EXCLUDED."deps",
  "status"          = EXCLUDED."status",
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

