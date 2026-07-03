-- Rollback for 20260703160000_product_fal_media.
ALTER TABLE "products" DROP COLUMN IF EXISTS "ingredientsImageUrl";
ALTER TABLE "products" DROP COLUMN IF EXISTS "videoError";
ALTER TABLE "products" DROP COLUMN IF EXISTS "videoTaskId";
ALTER TABLE "products" DROP COLUMN IF EXISTS "videoStatus";
ALTER TABLE "products" DROP COLUMN IF EXISTS "videoUrl";
