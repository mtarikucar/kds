-- Rollback for 20260703140000_product_ingredients.
ALTER TABLE "products" DROP COLUMN IF EXISTS "ingredients";
