-- Rollback for 20260709120000_combo_campaign_collections.
-- Tam ters çevirir: yeni tablolar + kolonlar + enum drop edilir. Operatör/runtime
-- verisine dokunmaz (yalnızca bu migration'ın eklediklerini kaldırır). Idempotent.

-- Drop new tables (FK'ler tabloyla birlikte düşer)
DROP TABLE IF EXISTS "product_collections";
DROP TABLE IF EXISTS "menu_collections";
DROP TABLE IF EXISTS "combo_group_items";
DROP TABLE IF EXISTS "combo_groups";

-- order_items: combo explosion kolonları (self-FK kolonla birlikte kalkar)
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_parentOrderItemId_fkey";
DROP INDEX IF EXISTS "order_items_parentOrderItemId_idx";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "parentOrderItemId";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "listUnitPrice";

-- products: kampanya + tip kolonları
ALTER TABLE "products" DROP COLUMN IF EXISTS "campaignEndAt";
ALTER TABLE "products" DROP COLUMN IF EXISTS "campaignStartAt";
ALTER TABLE "products" DROP COLUMN IF EXISTS "campaignPrice";
ALTER TABLE "products" DROP COLUMN IF EXISTS "campaignLabel";
ALTER TABLE "products" DROP COLUMN IF EXISTS "productType";

-- enum en son (kolon bağımlılığı kalmadıktan sonra)
DROP TYPE IF EXISTS "ProductType";
