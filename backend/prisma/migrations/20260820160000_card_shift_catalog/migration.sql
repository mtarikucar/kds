-- @doctor:idempotent verified=marketplace_addons/hardware_products'a ON CONFLICT (code|sku) DO UPDATE ile yazar, hardware_inventory'ye ON CONFLICT DO NOTHING; tenant_addons'a, entitlement'lara ve siparişlere dokunmaz. Tekrar çalıştırma aynı kataloğa yakınsar.
--
-- Kartlı Vardiya (v3.6.8): katalog ürünü + USB HID RFID okuyucu SKU'su.
--
-- STATUS NEDEN "DO UPDATE" LİSTESİNDE DEĞİL
-- 20260811100000 satırı ON CONFLICT'te "status"u da ezer; bir superadmin ürünü
-- arşivledikten sonra migration tekrar oynatılırsa ürün kendiliğinden yeniden
-- yayına girer. Burada "status" DO UPDATE listesinden ÇIKARILDI: ilk INSERT
-- 'published' yazar, sonraki her çalıştırma operatörün seçimini korur.
--
-- Tablo adları snake_case @@map adlarıdır.

-- 1) Katalog ürünü ------------------------------------------------------------
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'module_personnel_card_shift', 'Kartlı Vardiya', 'Personel giriş-çıkışını RFID kart okutarak damgalar. Ucuz USB kart okuyucularla çalışır; puantaj, mola ve fazla mesai hesabı Personel Yönetimi modülündeki kayıtların üstüne yazılır. Tek seferlik satın alma — yenileme ücreti yoktur, lisansınız aktif olduğu sürece geçerlidir.',
  'module', 'oneTime', 400000, 'TRY',
  '{"feature.cardShift":true}'::jsonb, ARRAY['module_personnel']::TEXT[], 'published', true,
  NULL, NULL,
  NULL, 18, '{"tr":{"name":"Kartlı Vardiya","description":"Personel giriş-çıkışını RFID kart okutarak damgalar. Ucuz USB kart okuyucularla çalışır; puantaj, mola ve fazla mesai hesabı Personel Yönetimi modülündeki kayıtların üstüne yazılır. Tek seferlik satın alma — yenileme ücreti yoktur, lisansınız aktif olduğu sürece geçerlidir."},"en":{"name":"Card Shift","description":"Staff clock in and out by tapping an RFID card. It works with inexpensive USB readers; attendance, breaks and overtime are written onto the records of the Staff Management module. One-time purchase — there is no renewal fee, and it stays available for as long as your licence is active."},"ru":{"name":"Смена по карте","description":"Сотрудники отмечают приход и уход, прикладывая RFID-карту. Работает с недорогими USB-считывателями; учёт времени, перерывы и сверхурочные пишутся поверх записей модуля «Управление персоналом». Разовая покупка — плата за продление отсутствует, доступ сохраняется, пока действует ваша лицензия."},"ar":{"name":"الوردية بالبطاقة","description":"يسجّل الموظفون الدخول والخروج بتمرير بطاقة RFID. يعمل مع قارئات USB غير المكلفة؛ تُكتب سجلات الحضور والاستراحات والعمل الإضافي فوق سجلات وحدة إدارة الموظفين. شراء لمرة واحدة — لا توجد رسوم تجديد، ويظل متاحًا ما دام ترخيصك ساريًا."},"uz":{"name":"Karta bilan smena","description":"Xodimlar RFID kartani o''qitib kelish-ketishni qayd etadi. Arzon USB o''quvchilar bilan ishlaydi; davomat, tanaffus va qo''shimcha ish vaqti Xodimlarni boshqarish moduli yozuvlari ustiga yoziladi. Bir martalik xarid — yangilash to''lovi yo''q, litsenziyangiz faol bo''lgunicha amal qiladi."}}'::jsonb, 0.10,
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
  "requiresLicense" = EXCLUDED."requiresLicense",
  "creditKind"      = EXCLUDED."creditKind",
  "creditUnits"     = EXCLUDED."creditUnits",
  "maxQuantity"     = EXCLUDED."maxQuantity",
  "sortOrder"       = EXCLUDED."sortOrder",
  "i18n"            = EXCLUDED."i18n",
  "updatedAt"       = NOW();

-- 2) Donanım SKU'su -----------------------------------------------------------
-- category='card_reader' (yeni sözlük değeri), saleMode=DIRECT_SALE.
-- complianceDocs, seed'in SEED_DEFAULT_COMPLIANCE'ı ile aynı: {"invoiceIssued":true}
-- (DIRECT_SALE yayın kapısı en az bir dolu alan ister).
INSERT INTO "hardware_products" (
  "id", "sku", "category", "name", "brand", "model", "description", "specs",
  "compat", "details", "serviceMeta", "priceCents", "rentalMonthlyCents",
  "currency", "warrantyMonths", "images", "stockStatus", "shippingProfile",
  "status", "saleMode", "partnerRedirect", "complianceDocs", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'card-reader-rfid-usb-hid', 'card_reader',
  'RFID Personel Kart Okuyucu (USB HID) + 10 Kart', NULL, NULL,
  'Masaüstü 13.56 MHz (Mifare) USB kart okuyucu. Bilgisayara klavye gibi bağlanır, sürücü gerektirmez: kartı okuttuğunuzda numarayı ekrandaki alana yazar. Kartlı Vardiya modülü ile personel giriş-çıkışı için 10 adet personel kartı dahildir.',
  '{"headlineSpecs":["13.56 MHz Mifare","USB HID — sürücüsüz","10 kart dahil"]}'::jsonb,
  '{"requiredAddOn":["module_personnel_card_shift"]}'::jsonb,
  NULL, NULL, 129000, NULL, 'TRY', 12, ARRAY[]::TEXT[], 'in_stock', NULL,
  'published', 'DIRECT_SALE'::"HardwareSaleMode", NULL,
  '{"invoiceIssued":true}'::jsonb, NOW(), NOW()
)
ON CONFLICT ("sku") DO UPDATE SET
  "category" = EXCLUDED."category", "name" = EXCLUDED."name",
  "description" = EXCLUDED."description", "specs" = EXCLUDED."specs",
  "compat" = EXCLUDED."compat", "priceCents" = EXCLUDED."priceCents",
  "warrantyMonths" = EXCLUDED."warrantyMonths", "updatedAt" = NOW();

-- 3) Stok satırı --------------------------------------------------------------
-- Seed'in create-only davranışıyla aynı (seed-marketplace.ts:1104-1110): var olan
-- bir stok satırı ASLA ezilmez — gerçek receiveStock/allocate hareketi silinirdi.
INSERT INTO "hardware_inventory" ("id", "productId", "available", "allocated", "shipped", "updatedAt")
SELECT gen_random_uuid()::text, hp."id", 25, 0, 0, NOW()
  FROM "hardware_products" hp
 WHERE hp."sku" = 'card-reader-rfid-usb-hid'
   AND NOT EXISTS (SELECT 1 FROM "hardware_inventory" hi WHERE hi."productId" = hp."id");
