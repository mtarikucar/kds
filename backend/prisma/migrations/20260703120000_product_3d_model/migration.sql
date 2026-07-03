-- Product 3D / AR model fields (menu AI-AR feature, Phase 2).
-- A dish photo can be turned into a 3D model via Meshy; the QR menu then
-- offers "view in AR on your table". All nullable + additive — a product
-- without a model just shows no AR button, so this is a safe forward migration.
ALTER TABLE "products" ADD COLUMN "model3dUrl" TEXT;
ALTER TABLE "products" ADD COLUMN "model3dUsdzUrl" TEXT;
ALTER TABLE "products" ADD COLUMN "model3dStatus" TEXT;
ALTER TABLE "products" ADD COLUMN "model3dTaskId" TEXT;
ALTER TABLE "products" ADD COLUMN "model3dError" TEXT;
