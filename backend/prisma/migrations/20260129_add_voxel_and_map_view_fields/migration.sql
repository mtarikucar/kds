-- Add voxel world position fields to tables
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "voxelX" INTEGER;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "voxelY" INTEGER DEFAULT 0;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "voxelZ" INTEGER;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "voxelRotation" INTEGER DEFAULT 0;

-- Add new POS settings fields
ALTER TABLE "pos_settings" ADD COLUMN IF NOT EXISTS "defaultMapView" TEXT DEFAULT '2d';
ALTER TABLE "pos_settings" ADD COLUMN IF NOT EXISTS "requireServedForDineInPayment" BOOLEAN DEFAULT false;
