-- 20260820170000_print3d_service geri alımı.
--
-- İKİ DEĞİŞMEZ:
--   (1) ÖDENMİŞ ÜRETİM KAYDINA ASLA DOKUNMA. Down yalnızca up'ın eklediğini
--       kaldırır, operatör/çalışma-zamanı verisine dokunmaz. Bu yüzden
--       koşulsuz DROP TABLE YASAK: katalog DELETE'inin koruduğu ödenmiş
--       işleri — üstelik guard'ın KENDİ KANITINI — yok ederdi.
--   (2) İDEMPOTAN. İkinci koşu hata VERMEZ. Tablolar düştükten sonra
--       "NOT EXISTS (SELECT 1 FROM print3d_jobs)" ayrıştırma aşamasında
--       42P01 undefined_table verirdi; bu yüzden her print3d_jobs referansı
--       to_regclass ile korunur.

-- 0) FAIL-FAST: ödenmiş iş varsa geri alım BAŞLAMADAN, sessizce değil
--    GÜRÜLTÜYLE durur. RAISE EXCEPTION tüm down işlemini geri sarar (katalog
--    DELETE'i de dahil), yani veritabanı tutarlı kalır.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.print3d_jobs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "print3d_jobs"' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'ABORT: print3d_jobs holds % paid job(s). Export and delete them before rolling back 20260820170000_print3d_service.', n;
    END IF;
  END IF;
END $$;

-- 1) Envanter satırları — YALNIZCA bu migration'ın up'ının açtığı iki satır.
--    ÜRÜN SİLİNMEDEN ÖNCE çalışmalı, çünkü kapsam sku üzerinden join'leniyor.
--    (Kapsamsız bir "orphan sweep" platform genelinde başka SKU'ların stok
--    sayaçlarını — allocated/shipped geçmişi dahil — silebilirdi.)
DELETE FROM "hardware_inventory" hi
 USING "hardware_products" hp
 WHERE hi."productId" = hp."id"
   AND hp."sku" IN ('print3d_base','print3d_item')
   AND hi."allocated" = 0
   AND hi."shipped" = 0;

-- 2) Katalog satırları. Guard: ödenmiş bir satın alımı ASLA öksüz bırakma.
--    Hizmet satırları hardware_order_items üretmiyor, bu yüzden asıl kanıt
--    print3d_jobs'tır — ikisine de bakılır. to_regclass sarmalayıcısı ikinci
--    koşuyu (tablo artık yok) hatasız kılar.
DELETE FROM "hardware_products" hp
 WHERE hp."sku" IN ('print3d_base','print3d_item')
   AND NOT EXISTS (
     SELECT 1 FROM "hardware_order_items" hoi WHERE hoi."productId" = hp."id"
   )
   AND (
     to_regclass('public.print3d_jobs') IS NULL
     OR NOT EXISTS (SELECT 1 FROM "print3d_jobs")
   );

-- 3) Tabloları düşür. Buraya ulaşıldıysa 0. adım hiçbir ödenmiş iş bulmadı.
DROP TABLE IF EXISTS "print3d_job_items";
DROP TABLE IF EXISTS "print3d_jobs";
