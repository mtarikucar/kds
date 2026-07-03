-- fal.ai generated media for products (auto photo + ingredients video).
-- The ingredients video is a dish-photo → ingredients-on-a-table transition.
-- All nullable + additive.
ALTER TABLE "products" ADD COLUMN "videoUrl" TEXT;
ALTER TABLE "products" ADD COLUMN "videoStatus" TEXT;
ALTER TABLE "products" ADD COLUMN "videoTaskId" TEXT;
ALTER TABLE "products" ADD COLUMN "videoError" TEXT;
ALTER TABLE "products" ADD COLUMN "ingredientsImageUrl" TEXT;
