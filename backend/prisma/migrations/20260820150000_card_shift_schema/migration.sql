-- @doctor:idempotent verified=IF NOT EXISTS'li ADD COLUMN + CREATE UNIQUE INDEX; hiçbir satır güncellenmiyor, hiçbir tenant verisine dokunulmuyor. Tekrar çalıştırma no-op.
--
-- Kartlı vardiya (v3.6.8) şeması. Tablo adları snake_case @@map adlarıdır
-- ("users", "attendances") — PascalCase bir ad CI'da (db push) görünmez,
-- yalnız prod deploy'unda 42P01 verir.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "staffCardUidHash"      TEXT,
  -- K22: ENCRYPTION_MASTER_KEY rotasyonunda "çöz -> yeniden HMAC'le" işini mümkün
  -- kılan geri döndürülebilir kopya (AES-256-GCM, encryptString "v2:" biçimi).
  -- Tap yolunda okunmaz, hiçbir uç döndürmez.
  ADD COLUMN IF NOT EXISTS "staffCardUidEnc"       TEXT,
  ADD COLUMN IF NOT EXISTS "staffCardHashVersion"  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "staffCardLast4"        TEXT,
  ADD COLUMN IF NOT EXISTS "staffCardAssignedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "staffCardAssignedById" TEXT;

-- NULL'lar Postgres'te birbirinden farklı sayılır: kartsız personel sayısı sınırsız.
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenantId_staffCardUidHash_key"
  ON "users" ("tenantId", "staffCardUidHash");

CREATE INDEX IF NOT EXISTS "users_staffCardAssignedById_idx"
  ON "users" ("staffCardAssignedById");

DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_staffCardAssignedById_fkey"
    FOREIGN KEY ("staffCardAssignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "attendances"
  ADD COLUMN IF NOT EXISTS "clockInSource"  TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "clockOutSource" TEXT;
