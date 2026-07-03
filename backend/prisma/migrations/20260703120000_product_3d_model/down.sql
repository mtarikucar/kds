-- Rollback for 20260703120000_product_3d_model.
-- Drops EXACTLY the five columns the up migration added; IF EXISTS keeps it a
-- safe no-op if already reverted. Touches no operator/runtime data.
ALTER TABLE "products" DROP COLUMN IF EXISTS "model3dError";
ALTER TABLE "products" DROP COLUMN IF EXISTS "model3dTaskId";
ALTER TABLE "products" DROP COLUMN IF EXISTS "model3dStatus";
ALTER TABLE "products" DROP COLUMN IF EXISTS "model3dUsdzUrl";
ALTER TABLE "products" DROP COLUMN IF EXISTS "model3dUrl";
