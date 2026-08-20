-- @doctor:idempotent verified=a read-only pre-flight guard (statement 0, writes nothing), one INSERT ... ON CONFLICT (code) DO UPDATE (status excluded), one NOT EXISTS-guarded prior-status stamp into audit_logs (statement 2a, written once per addon row), one status-guarded UPDATE on marketplace_addons, and ownership moves on tenant_addons guarded by the pre-move addOnId plus a NOT EXISTS bundle check so a second run matches nothing. Deletes only OPEN, UNPAID renewal_cycles whose anniversaryAt is still in the FUTURE — exactly the set the 06:00 UTC generator recreates.
--
-- Paket servis: üç SKU -> tek paket.
--
-- Teslimat kapısı ALAN-GENELİ: delivery-platforms.controller.ts sınıf
-- seviyesinde @RequiresIntegration("delivery") taşıyor ve sağlayıcı adı
-- YOK (delivery-gate.spec.ts bunu pinliyor). Yani tek platform satın alan
-- kiracı dördünü de kullanabiliyordu; platform başına ₺2.490 kurguydu.
-- ₺2.499'luk tek paket satılanı gerçekte teslim edilenle hizalar.
--
-- MÜLKİYET NEDEN TAŞINIYOR
-- Arşivlemek grant'i kaldırmaz (projektör TenantAddOn'u katalog satırının
-- status'una bakmadan okur), ama yenileme sepetini SESSİZCE eksiltir:
-- RenewalCycleService sahip olunan kodları QuoteService'e verir, QuoteService
-- yayımlanmamış satırı "addon_not_purchasable" uyarısıyla düşürür. Fatura
-- teslimat kalemi olmadan çıkar, sweeper satırı past_due -> expired yapar ve
-- müşteri ödediği şeyi kaybeder. Bu yüzden sahiplik yeni pakete taşınır.
--
-- Tablo adları snake_case @@map adlarıdır — "marketplace_addons" /
-- "tenant_addons" / "renewal_cycles"; PascalCase bir ad yalnızca production
-- deploy'unda 42P01 verir (CI `prisma db push` kullanır, migration SQL'ini
-- hiç çalıştırmaz).

-- ---------------------------------------------------------------------------
-- 0. UÇUŞ-ÖNCESİ KİLİT. Emekliye ayrılan bir SKU'yu adlandıran, ödenmiş ama
--    provision edilmemiş (ya da hâlâ ödenebilir) bir checkout intent varken
--    ÇALIŞMAYI REDDET. Sepet intent anında donuyor
--    (checkout-intent.service.ts:283) ve TTL 48 saat (:53); settlement
--    katalogu YENİDEN okuyor (checkout.service.ts:193, 221-223), arşivli satır
--    quote.service.ts:81-85'te sessizce düşüyor, 1 kuruş toleransı aşılıyor
--    (:233-243) ve PayTR tahsilatı yapılmışken provision REDDEDİLİYOR.
--    Otomatik iade rayı YOK.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM "checkout_intents" ci
   WHERE ci."status" IN ('pending', 'succeeded')
     AND ci."provisionedAt" IS NULL
     AND (ci."expiresAt" IS NULL OR ci."expiresAt" > NOW())
     AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(ci."cartJson" -> 'items') AS it
            WHERE it ->> 'code' IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
         );
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % adet uçuşta checkout intent emekliye ayrılan bir teslimat SKU''suna referans veriyor. Hepsi settle olduktan veya süresi dolduktan sonra tekrar çalıştır (INTENT_TTL_HOURS=48).', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Paket satırı. status DO UPDATE listesinde DEĞİL: bir operatör satırı
--    arşivlediyse yeniden çalıştırma onu geri yayımlamamalı.
-- ---------------------------------------------------------------------------
INSERT INTO "marketplace_addons" (
  "id", "code", "name", "description", "kind", "billing", "priceCents",
  "currency", "grants", "deps", "status", "requiresLicense", "creditKind",
  "creditUnits", "maxQuantity", "sortOrder", "i18n", "commissionRate",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text, 'delivery_platforms', 'Paket Servis Entegrasyonları', 'Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişlerinin otomatik olarak POS ve mutfağa düşmesi.',
  'integration', 'annual', 249900, 'TRY',
  '{"integration.delivery":["yemeksepeti","getir","trendyol_yemek","migros"],"feature.deliveryIntegration":true}'::jsonb, ARRAY[]::TEXT[], 'published', true,
  NULL, NULL,
  NULL, 20,
  '{"tr":{"name":"Paket Servis Entegrasyonları","description":"Yemeksepeti, Getir, Trendyol Yemek ve Migros Yemek siparişleri otomatik olarak POS ve mutfağa düşer. Tek pakette dört platform."},"en":{"name":"Delivery Platform Integrations","description":"Yemeksepeti, Getir, Trendyol Yemek and Migros Yemek orders flow automatically into the POS and the kitchen. Four platforms in one package."},"ru":{"name":"Интеграции служб доставки","description":"Заказы Yemeksepeti, Getir, Trendyol Yemek и Migros Yemek автоматически поступают в POS и на кухню. Четыре платформы в одном пакете."},"ar":{"name":"تكاملات منصات التوصيل","description":"تصل طلبات Yemeksepeti وGetir وTrendyol Yemek وMigros Yemek تلقائيًا إلى نقطة البيع والمطبخ. أربع منصات في باقة واحدة."},"uz":{"name":"Yetkazib berish platformalari integratsiyasi","description":"Yemeksepeti, Getir, Trendyol Yemek va Migros Yemek buyurtmalari avtomatik ravishda POS va oshxonaga tushadi. Bitta paketda to''rtta platforma."}}'::jsonb,
  0.10,
  NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",  -- NOT: "status" bilerek YOK
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

-- ---------------------------------------------------------------------------
-- 2a. ARŞİVLEMEDEN ÖNCE her satırın MEVCUT statüsünü damgala.
--     Neden: 2b yalnız 'published' satırları arşivliyor, dolayısıyla down koşulsuz
--     'published' yazarsa operatörün migration'dan ÖNCE elle arşivlediği (ya da
--     'draft'ta bıraktığı) bir satırı geri yayına sokar — down sadık bir ters
--     işlem olmaktan çıkar.
--     Damga NEREYE: marketplace_addons'ta `pricingMeta` gibi serbest bir meta
--     kolonu YOK (grants ve i18n ürün verisidir, damga taşıyamaz). Bu yüzden
--     statü değişimi için zaten var olan tabloya — audit_logs — yazılır.
--     actorId bu migration'a özel bir sabittir; down yalnız o actorId'li
--     satırları okur ve siler.
-- ---------------------------------------------------------------------------
INSERT INTO "audit_logs" (
  "id", "action", "entityType", "entityId", "actorId", "actorEmail",
  "previousData", "newData", "metadata", "createdAt"
)
SELECT gen_random_uuid()::text,
       'UPDATE',
       'MARKETPLACE_ADDON',
       m."id",
       'migration:20260820140000_delivery_platforms_bundle',
       'migration@system.local',
       jsonb_build_object('migratedPriorStatus', m."status"),
       jsonb_build_object('status', 'archived'),
       jsonb_build_object('migration', '20260820140000_delivery_platforms_bundle',
                          'code', m."code"),
       NOW()
  FROM "marketplace_addons" m
 WHERE m."code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
   AND NOT EXISTS (
         SELECT 1 FROM "audit_logs" a
          WHERE a."actorId" = 'migration:20260820140000_delivery_platforms_bundle'
            AND a."entityId" = m."id"
       );

-- ---------------------------------------------------------------------------
-- 2b. Üç SKU arşivlenir. ARŞİV, ASLA SİLME: `code` yeniden kullanılamaz ve
--     TenantAddOn.addOnId onDelete: Restrict.
-- ---------------------------------------------------------------------------
UPDATE "marketplace_addons"
   SET "status" = 'archived',
       "updatedAt" = NOW()
 WHERE "status" = 'published'
   AND "code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek');

-- ---------------------------------------------------------------------------
-- 3a. Taşımadan ÖNCE kökeni damgala. addOnId üzerine yazıldığında hangi
--     platformun satıldığı bilgisi kaybolur; down.sql'in geri dönebilmesi
--     için tek kaynak budur.
-- ---------------------------------------------------------------------------
UPDATE "tenant_addons" t
   SET "pricingMeta" = COALESCE(t."pricingMeta", '{}'::jsonb)
                       || jsonb_build_object('migratedFrom', m."code")
  FROM "marketplace_addons" m
 WHERE t."addOnId" = m."id"
   AND m."code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
   AND t."status" IN ('active', 'past_due')
   AND NOT (COALESCE(t."pricingMeta", '{}'::jsonb) ? 'migratedFrom');

-- 3b. Bir kiracı birden fazla platform tutuyorsa BİRİ hariç hepsi kapatılır —
--     paket zaten dördünü de kapsıyor, iki satır iki kez faturalanır
--     (renewal-cycle.service.ts:103-122; TenantAddOn'da (tenantId,addOnId)
--     unique YOK).
--     HAYATTA KALAN = EN UZAĞA ÖDENMİŞ satır. plan-projector.service.ts:295-299
--     validUntil'i currentPeriodEnd'den türetir; "en eski aktive edilen kalsın"
--     demek, Getir'i altı ay sonra alan kiracının ÖDEDİĞİ GÜNLERİ yakmak olur.
--     Önceki status VE zaman damgaları geri alınabilsin diye pricingMeta'ya
--     yazılır — down bunları NULL'lamaz, geri yazar.
WITH old AS (
  SELECT "id" FROM "marketplace_addons"
   WHERE "code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
), ranked AS (
  SELECT ta."id",
         ta."status"      AS prior_status,
         ta."cancelledAt" AS prior_cancelled_at,
         ta."endedAt"     AS prior_ended_at,
         ROW_NUMBER() OVER (
           PARTITION BY ta."tenantId"
           ORDER BY ta."currentPeriodEnd" DESC NULLS LAST,
                    ta."activatedAt" ASC,
                    ta."id" ASC
         ) AS rn
    FROM "tenant_addons" ta
   WHERE ta."addOnId" IN (SELECT "id" FROM old)
     AND ta."status" IN ('active', 'past_due')
)
UPDATE "tenant_addons" t
   SET "status" = 'cancelled',
       "cancelledAt" = NOW(),
       "endedAt" = NOW(),
       "pricingMeta" = COALESCE(t."pricingMeta", '{}'::jsonb)
                       || jsonb_build_object(
                            'migratedPriorStatus',      r.prior_status,
                            'migratedPriorCancelledAt', to_jsonb(r.prior_cancelled_at),
                            'migratedPriorEndedAt',     to_jsonb(r.prior_ended_at)
                          )
  FROM ranked r
 WHERE t."id" = r."id"
   AND r.rn > 1;

-- 3c. Hayatta kalan satır pakete taşınır — ama kiracıda ZATEN bir paket satırı
--     varsa TAŞINMAZ. (tenantId, addOnId) unique olmadığı için ikinci bir satır
--     yenileme sepetine ikinci kez ₺2.499 yazardı; kısmi rollback / yeniden
--     çalıştırma bunu gerçekten üretir.
UPDATE "tenant_addons"
   SET "addOnId" = (SELECT "id" FROM "marketplace_addons" WHERE "code" = 'delivery_platforms')
 WHERE "status" IN ('active', 'past_due')
   AND "addOnId" IN (
         SELECT "id" FROM "marketplace_addons"
          WHERE "code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
       )
   AND NOT EXISTS (
         SELECT 1
           FROM "tenant_addons" x
          WHERE x."tenantId" = "tenant_addons"."tenantId"
            AND x."addOnId" = (SELECT "id" FROM "marketplace_addons" WHERE "code" = 'delivery_platforms')
            AND x."status" IN ('active', 'past_due')
       );

-- ---------------------------------------------------------------------------
-- 4. Eski kodları taşıyan AÇIK, ÖDENMEMİŞ ve YIL DÖNÜMÜ HENÜZ GELMEMİŞ
--    yenileme döngüleri silinir.
--    Silinmezse: müşteri donuk totalCents'i öder, settlement yeniden teklif
--    alır (arşivli satır düşer), 1 kuruş toleransı aşılır ve provision
--    reddedilir — para alınmış, hizmet verilmemiş olur.
--    (tenantId, anniversaryAt) unique olduğu ve generate() varsa erken
--    döndüğü için UPDATE değil DELETE gerekir; 06:00 UTC cron'u paket
--    satırıyla yeniden üretir.
--
--    "anniversaryAt > NOW() + 1 gün" ŞARTI HAYATİ:
--    nextAnniversary() (anniversary.ts:114-121) bugün >= yıl dönümü olduğunda
--    BİR SONRAKİ YILA atlar, yani üretici o döngüyü asla geri getirmez. Yıl
--    dönümü gelmiş/geçmiş bir open döngüyü silmek hem faturayı yok eder hem de
--    lapseUnpaidCycles'ın (renewal-scheduler.service.ts:144-153) tek tetikleyicisini
--    siler: bayat TenantAddOn satırları hiç 'expired' olmaz ve kiracı ödediği her
--    yetkiyi SÜRESİZ BEDAVA kullanmaya devam eder. O satırlar ELLE mutabık kılınır.
-- ---------------------------------------------------------------------------
DELETE FROM "renewal_cycles" rc
 WHERE rc."status" = 'open'
   AND rc."paymentRef" IS NULL
   AND rc."anniversaryAt" > NOW() + INTERVAL '1 day'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(rc."cartJson" -> 'items') AS it
          WHERE it ->> 'code' IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
       );
