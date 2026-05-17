-- Drop the 3D voxel-world feature: removes the restaurant_layouts table
-- and the per-table / per-camera coordinate columns that fed the 3D view.

DROP TABLE IF EXISTS "restaurant_layouts";

ALTER TABLE "tables"
  DROP COLUMN IF EXISTS "voxelX",
  DROP COLUMN IF EXISTS "voxelY",
  DROP COLUMN IF EXISTS "voxelZ",
  DROP COLUMN IF EXISTS "voxelRotation";

ALTER TABLE "cameras"
  DROP COLUMN IF EXISTS "voxelX",
  DROP COLUMN IF EXISTS "voxelY",
  DROP COLUMN IF EXISTS "voxelZ";
