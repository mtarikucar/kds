-- Paket servis tek-paket geçişinin geri alınması.
--
-- Her ifade up'ın ürettiği TAM son-durumla korunur, iki kez çalıştırılınca
-- no-op olur ve operatörün elle değiştirdiği bir fiyatı/statüyü ezmez.
-- Kiracı verisine yalnızca up'ın dokunduğu yerde dokunur: taşınan
-- `addOnId`'yi `pricingMeta.migratedFrom` damgasından geri yazar ve damgaları
-- temizler. Katalog statüsü de damgadan gelir: üç SKU koşulsuz 'published'
-- yapılmaz, up'ın 2a adımında audit_logs'a yazdığı `migratedPriorStatus`
-- değerine döner. Silinen açık yenileme döngüleri geri getirilmez —
-- türetilmiş veridir, 06:00 UTC üreticisi yeniden yaratır.
--
-- down'ın adım 0 karşılığı YOKTUR ve olmamalıdır: uçuş-öncesi kilit yalnız bir
-- okuma kapısıdır, hiçbir şey yazmaz, geri alınacak bir şey bırakmaz.

-- 1. Dedupe ile kapatılan satırları eski statülerine döndür (bunlar hiç
--    taşınmadı: 3c yalnız active/past_due satırları taşıdı).
--    cancelledAt/endedAt NULL'lanMAZ, damgadan GERİ YAZILIR: satırın up'tan
--    önce zaten bir cancelledAt'i olabilir ve onu silmek down'ı sadık bir ters
--    işlem olmaktan çıkarır. to_jsonb(NULL) 'null' ürettiği için NULLIF ile
--    tekrar NULL'a çevrilir.
--    pricingMeta'nın kendisi de aynı ilkeye tabi: up COALESCE(pricingMeta,
--    '{}') ile başladığı için stamp anahtarları çıkarılınca dıştaki NULLIF
--    boş '{}' kalırsa gerçek NULL'a çevirir — up'tan önce hiç pricingMeta'sı
--    olmayan (satırların büyük çoğunluğu) bir satır down sonrası '{}' değil
--    NULL'a döner; round-trip'te gözlemlenen NULL->'{}' sürüklenmesini kapatır.
UPDATE "tenant_addons" t
   SET "status" = t."pricingMeta" ->> 'migratedPriorStatus',
       "cancelledAt" = NULLIF(t."pricingMeta" ->> 'migratedPriorCancelledAt', 'null')::timestamp,
       "endedAt"     = NULLIF(t."pricingMeta" ->> 'migratedPriorEndedAt', 'null')::timestamp,
       "pricingMeta" = NULLIF(((((t."pricingMeta" - 'migratedPriorStatus')
                          - 'migratedPriorCancelledAt')
                          - 'migratedPriorEndedAt')
                          - 'migratedFrom'), '{}'::jsonb)
 WHERE t."pricingMeta" ? 'migratedPriorStatus';

-- 2. Taşınan satırları özgün SKU'larına geri yaz. pricingMeta burada da aynı
--    NULLIF ile: taşınan satırın up'tan önce başka bir meta alanı yoksa (tek
--    anahtarı migratedFrom idiyse) down onu gerçek NULL'a döndürür.
UPDATE "tenant_addons" t
   SET "addOnId" = m."id",
       "pricingMeta" = NULLIF(t."pricingMeta" - 'migratedFrom', '{}'::jsonb)
  FROM "marketplace_addons" m
 WHERE m."code" = t."pricingMeta" ->> 'migratedFrom'
   AND t."pricingMeta" ? 'migratedFrom'
   AND t."addOnId" = (SELECT "id" FROM "marketplace_addons" WHERE "code" = 'delivery_platforms');

-- 3. Üç SKU up'tan ÖNCEKİ statüsüne döner — koşulsuz 'published'a DEĞİL.
--    Kaynak: up'ın 2a adımında audit_logs'a yazdığı `migratedPriorStatus`.
--    `IS DISTINCT FROM` sayesinde damgadaki değer zaten yazılıysa satır hiç
--    güncellenmez.
UPDATE "marketplace_addons" m
   SET "status" = a."previousData" ->> 'migratedPriorStatus',
       "updatedAt" = NOW()
  FROM "audit_logs" a
 WHERE a."actorId" = 'migration:20260820140000_delivery_platforms_bundle'
   AND a."entityId" = m."id"
   AND m."code" IN ('delivery_yemeksepeti', 'delivery_getir', 'delivery_trendyol_yemek')
   AND (a."previousData" ->> 'migratedPriorStatus') IS NOT NULL
   AND m."status" IS DISTINCT FROM (a."previousData" ->> 'migratedPriorStatus');

-- 3b. Damgayı temizle. Down "yalnız up'ın eklediğini kaldırır" kuralı gereği bu
--     satırları silmek zorundadır: bırakılırsa bir sonraki up->down turunda bayat
--     bir "önceki statü" geri yazılır. Kapsam actorId ile bu migration'a çakılıdır;
--     başka hiçbir audit satırına dokunulmaz. İkinci çalıştırmada 0 satır siler.
DELETE FROM "audit_logs"
 WHERE "actorId" = 'migration:20260820140000_delivery_platforms_bundle';

-- 4. Paket satırı silinir — ama ASLA bir satın almayı sahipsiz bırakmadan.
--    (2. adım başarısız olduysa NOT EXISTS bu DELETE'i no-op yapar: fail-safe.)
DELETE FROM "marketplace_addons" ma
 WHERE ma."code" = 'delivery_platforms'
   AND NOT EXISTS (
         SELECT 1 FROM "tenant_addons" ta WHERE ta."addOnId" = ma."id"
       );

-- 5. Paketi referanslayan açık/ödenmemiş yenileme döngüleri temizlenir.
--    up'ın 4. adımıyla AYNI daraltma: yıl dönümü gelmiş/geçmiş bir open
--    döngüyü silmek faturayı da lapse tetikleyicisini de yok eder.
DELETE FROM "renewal_cycles" rc
 WHERE rc."status" = 'open'
   AND rc."paymentRef" IS NULL
   AND rc."anniversaryAt" > NOW() + INTERVAL '1 day'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(rc."cartJson" -> 'items') AS it
          WHERE it ->> 'code' = 'delivery_platforms'
       );
