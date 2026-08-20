-- Rollback: card_shift_schema. YALNIZ bu migration'ın eklediği kolonları/indeksleri
-- düşürür. Kart atamaları bu kolonların İÇİNDE yaşıyor, yani geri alma onları da
-- siler — bilinçli: kolon kalırsa şema Prisma ile tutarsız kalır. Operatör/işletme
-- verisinin hiçbiri (puantaj satırları, kullanıcılar) silinmez.
--
-- >>> ZORUNLU ADIM 0 — BU DOSYAYI ÇALIŞTIRMADAN ÖNCE ATAMALARI DIŞA AKTAR. <<<
-- UID hiçbir yerde düz metin tutulmaz (K8), bu yüzden atamalar başka bir tablodan
-- geri getirilemez; yedek alınmazsa her tenant her kartı elle yeniden kaydeder.
--   psql "$DATABASE_URL" -c "\copy (SELECT id, \"staffCardUidHash\", \"staffCardUidEnc\", \"staffCardHashVersion\", \"staffCardLast4\", \"staffCardAssignedAt\", \"staffCardAssignedById\" FROM users WHERE \"staffCardUidHash\" IS NOT NULL) TO 'staff-cards-backup.csv' CSV HEADER"
--
-- Idempotent: IF EXISTS'ler ikinci çalıştırmayı no-op yapar.
ALTER TABLE "attendances" DROP COLUMN IF EXISTS "clockOutSource";
ALTER TABLE "attendances" DROP COLUMN IF EXISTS "clockInSource";

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_staffCardAssignedById_fkey";
DROP INDEX IF EXISTS "users_staffCardAssignedById_idx";
DROP INDEX IF EXISTS "users_tenantId_staffCardUidHash_key";
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "staffCardAssignedById",
  DROP COLUMN IF EXISTS "staffCardAssignedAt",
  DROP COLUMN IF EXISTS "staffCardLast4",
  DROP COLUMN IF EXISTS "staffCardHashVersion",
  DROP COLUMN IF EXISTS "staffCardUidEnc",
  DROP COLUMN IF EXISTS "staffCardUidHash";
