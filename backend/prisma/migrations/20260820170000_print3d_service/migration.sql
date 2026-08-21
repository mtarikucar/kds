-- @doctor:idempotent verified=CREATE TABLE/INDEX IF NOT EXISTS; FK'ler DO/EXCEPTION duplicate_object ile sarılı; iki hardware_products upsert'i ON CONFLICT (sku) DO UPDATE (status HARİÇ); hardware_inventory INSERT'ü ON CONFLICT ("productId") DO NOTHING. Yeniden çalıştırma aynı duruma yakınsar. Hiçbir tenant/ownership/order satırına dokunmaz.
--
-- 20260820170000_print3d_service
-- v3.7.0 — 3D baskı figür hizmeti (üretim ortağı: Figurunica).
--
-- İki parça:
--   1. print3d_jobs + print3d_job_items tabloları (üretim kaydı).
--   2. hardware_products'a iki hizmet SKU'su (satılabilir katalog satırı).
--
-- Neden marketplace_addons DEĞİL: bir oneTime add-on kiracı başına ömür boyu
-- BİR KEZ satılabilir — süpürücü currentPeriodEnd IS NULL satırını hiç
-- kapatmaz (tenant-addon-sweeper.service.ts) ve ikinci alım
-- ADDON_ALREADY_OWNED ile reddedilir (addon-purchasability.rules.ts).
-- Bu hizmet tekrarlanabilir olmak zorunda.
--
-- TABLO ADLARI snake_case: CI `prisma db push` kullanır ve migration SQL'ini
-- HİÇ çalıştırmaz, bu yüzden PascalCase bir ad yalnızca production deploy'da
-- 42P01 verir.

CREATE TABLE IF NOT EXISTS "print3d_jobs" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "branchId"       TEXT,
    "hwOrderId"      TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'queued',
    "partner"        TEXT NOT NULL DEFAULT 'figurunica',
    "basePriceCents" INTEGER NOT NULL,
    "perItemCents"   INTEGER NOT NULL,
    "itemCount"      INTEGER NOT NULL,
    "totalCents"     INTEGER NOT NULL,
    "currency"       TEXT NOT NULL DEFAULT 'TRY',
    "note"           TEXT,
    "partnerRef"     TEXT,
    "opsNote"        TEXT,
    "producedAt"     TIMESTAMP(3),
    "cancelledAt"    TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "print3d_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "print3d_job_items" (
    "id"              TEXT NOT NULL,
    "jobId"           TEXT NOT NULL,
    "productId"       TEXT,
    "productName"     TEXT NOT NULL,
    "productImageUrl" TEXT,
    "model3dUrl"      TEXT,
    "position"        INTEGER NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'pending',
    "opsNote"         TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "print3d_job_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "print3d_jobs_hwOrderId_key"
    ON "print3d_jobs"("hwOrderId");
CREATE INDEX IF NOT EXISTS "print3d_jobs_tenantId_status_idx"
    ON "print3d_jobs"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "print3d_jobs_status_createdAt_idx"
    ON "print3d_jobs"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "print3d_job_items_jobId_productId_key"
    ON "print3d_job_items"("jobId", "productId");
CREATE INDEX IF NOT EXISTS "print3d_job_items_jobId_position_idx"
    ON "print3d_job_items"("jobId", "position");

-- FK'ler: ADD CONSTRAINT IF NOT EXISTS yok, bu yüzden duplicate_object yutulur
-- (20260601000000_v3_branch_scope_strict deseni).
DO $$ BEGIN
  ALTER TABLE "print3d_jobs"
    ADD CONSTRAINT "print3d_jobs_hwOrderId_fkey"
    FOREIGN KEY ("hwOrderId") REFERENCES "hardware_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "print3d_job_items"
    ADD CONSTRAINT "print3d_job_items_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "print3d_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Menü ürünleri GERÇEKTEN siliniyor (products.service.ts). SET NULL:
-- Restrict kiracının ürünü silmesini sonsuza dek engellerdi, Cascade ise
-- ödenmiş siparişin kalemini yok ederdi. Snapshot kolonları manifestoyu
-- bağ koptuktan sonra da ayakta tutar.
DO $$ BEGIN
  ALTER TABLE "print3d_job_items"
    ADD CONSTRAINT "print3d_job_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Katalog satırları. ON CONFLICT DO UPDATE'te "status" YOKTUR: bir operatör
-- SKU'yu bilinçli olarak 'archived' yaptıysa migration'ın yeniden çalışması
-- onu satışa geri açmamalı (tohumdaki status zorlamasını KOPYALAMA).
--
-- complianceDocs TAM OLARAK '{"invoiceIssued":true}' — SEED_DEFAULT_COMPLIANCE
-- ile birebir. Tohumun ortak upsert'ü bu alanı `update: sharedData` içinde her
-- koşuda üstüne yazar, bu yüzden başka bir değer yazmak migre-edilmiş ve
-- tohumlanmış veritabanlarını kalıcı olarak ayrıştırır (ve sürüklenme testini
-- kırar). distributorName gibi ek anahtar EKLEME.
INSERT INTO "hardware_products" (
  "id","sku","category","name","description","priceCents","currency",
  "warrantyMonths","images","stockStatus","status","saleMode","serviceMeta",
  "complianceDocs","createdAt","updatedAt"
) VALUES (
  gen_random_uuid()::text, 'print3d_base', 'service',
  '3D baskı figür — hizmet bedeli',
  'Menünüzden seçtiğiniz ürünlerin 3D baskı figürleri. Kargo dahil. Üretim ortağı: Figurunica.',
  150000, 'TRY', 0, ARRAY['/products/_fallback-service.svg']::TEXT[],
  'in_stock', 'published', 'DIRECT_SALE',
  '{"serviceType":"print3d","partner":"figurunica","role":"base"}'::jsonb,
  '{"invoiceIssued":true}'::jsonb,
  NOW(), NOW()
), (
  gen_random_uuid()::text, 'print3d_item', 'service',
  '3D baskı figür — ürün başına',
  'Seçilen her menü ürünü için bir figür. Taban hizmet bedeliyle birlikte alınır.',
  5000, 'TRY', 0, ARRAY['/products/_fallback-service.svg']::TEXT[],
  'in_stock', 'published', 'DIRECT_SALE',
  '{"serviceType":"print3d","partner":"figurunica","role":"item"}'::jsonb,
  '{"invoiceIssued":true}'::jsonb,
  NOW(), NOW()
)
ON CONFLICT ("sku") DO UPDATE SET
  "category"       = EXCLUDED."category",
  "name"           = EXCLUDED."name",
  "description"    = EXCLUDED."description",
  "priceCents"     = EXCLUDED."priceCents",
  "currency"       = EXCLUDED."currency",
  "images"         = EXCLUDED."images",
  "saleMode"       = EXCLUDED."saleMode",
  "serviceMeta"    = EXCLUDED."serviceMeta",
  "complianceDocs" = EXCLUDED."complianceDocs",
  "updatedAt"      = NOW();

-- Tohum her katalog girdisi için bir envanter satırı açar; migre edilmiş bir
-- veritabanı tohumlanmış bir veritabanından farklı görünmesin. Hizmetler stok
-- tüketmez: available 0.
INSERT INTO "hardware_inventory" ("id","productId","available","allocated","shipped","serialsAvailable","updatedAt")
SELECT gen_random_uuid()::text, p."id", 0, 0, 0, ARRAY[]::TEXT[], NOW()
  FROM "hardware_products" p
 WHERE p."sku" IN ('print3d_base','print3d_item')
ON CONFLICT ("productId") DO NOTHING;
