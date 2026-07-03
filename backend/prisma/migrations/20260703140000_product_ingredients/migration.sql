-- Customer-facing "içindekiler" (ingredients/contents) shown on the QR menu.
-- Distinct from the internal Recipe (stock deduction). Nullable + additive.
ALTER TABLE "products" ADD COLUMN "ingredients" TEXT;
