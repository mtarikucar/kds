-- Finished-product unit cost (distinct from retail `price`). Nullable so
-- existing products default to "no cost basis" until an owner sets it.
ALTER TABLE "products" ADD COLUMN "costPrice" DECIMAL(10,2);
