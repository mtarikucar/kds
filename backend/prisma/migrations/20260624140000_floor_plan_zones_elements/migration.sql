-- 2D Floor-Plan: zones (kat/bahçe/teras) + decorative/structural elements,
-- plus spatial placement fields on tables.
--
-- A FloorZone is a designable 2D canvas per branch; tables and FloorElements
-- (walls/doors/bar/kitchen/decor/text) are placed on it. Tables gain
-- posX/posY/width/height/rotation/shape and an optional zoneId (null = not
-- yet placed). Additive + idempotent (CREATE TABLE / ADD COLUMN IF NOT
-- EXISTS, guarded constraints) so it is safe to re-run on the live DB and
-- under the deploy baseline pipeline. The legacy tables.section column is
-- retained for now and dropped in a later phase.

-- CreateTable: floor_zones
CREATE TABLE IF NOT EXISTS "floor_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'INDOOR',
    "canvasWidth" INTEGER NOT NULL DEFAULT 1200,
    "canvasHeight" INTEGER NOT NULL DEFAULT 800,
    "gridSize" INTEGER NOT NULL DEFAULT 20,
    "backgroundImageUrl" TEXT,
    "backgroundOpacity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable: floor_elements
CREATE TABLE IF NOT EXISTS "floor_elements" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "points" JSONB,
    "style" JSONB,
    "label" TEXT,
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "zoneId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_elements_pkey" PRIMARY KEY ("id")
);

-- AlterTable: tables spatial placement fields
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "zoneId"   TEXT;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "posX"     DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "posY"     DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "width"    DOUBLE PRECISION NOT NULL DEFAULT 80;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "height"   DOUBLE PRECISION NOT NULL DEFAULT 80;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "shape"    TEXT NOT NULL DEFAULT 'ROUND';

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "floor_zones_tenantId_branchId_name_key" ON "floor_zones"("tenantId", "branchId", "name");
CREATE INDEX IF NOT EXISTS "floor_zones_tenantId_branchId_idx" ON "floor_zones"("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "floor_elements_zoneId_idx" ON "floor_elements"("zoneId");
CREATE INDEX IF NOT EXISTS "floor_elements_tenantId_branchId_idx" ON "floor_elements"("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "tables_zoneId_idx" ON "tables"("zoneId");

-- AddForeignKey (guarded — Postgres has no ADD CONSTRAINT IF NOT EXISTS)
DO $$ BEGIN
  ALTER TABLE "floor_zones" ADD CONSTRAINT "floor_zones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_zones" ADD CONSTRAINT "floor_zones_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_elements" ADD CONSTRAINT "floor_elements_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "floor_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_elements" ADD CONSTRAINT "floor_elements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_elements" ADD CONSTRAINT "floor_elements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "tables" ADD CONSTRAINT "tables_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "floor_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
