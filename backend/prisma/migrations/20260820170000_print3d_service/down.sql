-- Round-trip verified 2026-08-21 on a throwaway Postgres: up -> up(2x) ->
-- archived-status preserved -> paid-job guard aborts with nothing lost ->
-- down -> down(2x, no 42P01) -> up. Inventory delta on down was exactly 2.
-- First pass caught a real bug in the katalog DELETE (a plain SQL statement
-- resolves ALL referenced relations at parse time, so an OR'd
-- to_regclass(...) IS NULL guard does not protect a second down run once
-- print3d_jobs is dropped); fixed by moving both branches into a PL/pgSQL
-- IF/ELSE, whose untaken branch is never parsed. Round-trip re-verified
-- clean after the fix.

-- 20260820170000_print3d_service geri alımı.
--
-- İKİ DEĞİŞMEZ:
--   (1) ÖDENMİŞ ÜRETİM KAYDINA ASLA DOKUNMA. Down yalnızca up'ın eklediğini
--       kaldırır, operatör/çalışma-zamanı verisine dokunmaz. Bu yüzden
--       koşulsuz DROP TABLE YASAK: katalog DELETE'inin koruduğu ödenmiş
--       işleri — üstelik guard'ın KENDİ KANITINI — yok ederdi.
--   (2) İDEMPOTAN. İkinci koşu hata VERMEZ. Tablolar düştükten sonra düz bir
--       SQL ifadesindeki "FROM print3d_jobs" ayrıştırma aşamasında 42P01
--       undefined_table verir — bir OR/AND dalının runtime'da kısa devre
--       yapması ayrıştırıcıyı kurtarmaz. Bu yüzden her print3d_jobs referansı
--       ya to_regclass ile korunan bir PL/pgSQL dalının İÇİNDE durur (alınmayan
--       dal hiç plan edilmez), ya da EXECUTE ile dinamik SQL'e taşınır.

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
--    print3d_jobs'tır — ikisine de bakılır.
--
--    NEDEN İKİ AYRI DAL (yalnız to_regclass ile OR YETMEZ): düz bir SQL
--    DELETE'te tüm ilişkiler PARSE anında çözülür — bir OR dalının runtime'da
--    kısa devre yapacak olması ayrıştırıcıyı print3d_jobs var olma
--    zorunluluğundan kurtarmaz (ikinci koşuda tablo dropped: 42P01). PL/pgSQL
--    DO bloğundaki her komut ise İLK ÇALIŞTIRILDIĞINDA hazırlanır — alınmayan
--    dal hiç plan edilmez. Bu yüzden print3d_jobs referansı yalnızca tablo
--    var olduğu ONAYLANMIŞ dalda durur; ELSE dalı ona hiç değinmez.
DO $$ BEGIN
  IF to_regclass('public.print3d_jobs') IS NOT NULL THEN
    DELETE FROM "hardware_products" hp
     WHERE hp."sku" IN ('print3d_base','print3d_item')
       AND NOT EXISTS (
         SELECT 1 FROM "hardware_order_items" hoi WHERE hoi."productId" = hp."id"
       )
       AND NOT EXISTS (SELECT 1 FROM "print3d_jobs");
  ELSE
    DELETE FROM "hardware_products" hp
     WHERE hp."sku" IN ('print3d_base','print3d_item')
       AND NOT EXISTS (
         SELECT 1 FROM "hardware_order_items" hoi WHERE hoi."productId" = hp."id"
       );
  END IF;
END $$;

-- 3) Tabloları düşür. Buraya ulaşıldıysa 0. adım hiçbir ödenmiş iş bulmadı.
DROP TABLE IF EXISTS "print3d_job_items";
DROP TABLE IF EXISTS "print3d_jobs";
