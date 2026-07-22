-- Rollback for hardware_inventory_seed_stock. Restores the pre-migration
-- available=0 default, but ONLY for rows that still show exactly the
-- untouched post-up signature (available=25, allocated=0, shipped=0) —
-- i.e. nothing has moved on them since the up ran (no receiveStock/
-- allocate/markShipped activity, no real order). Rows ops has since
-- adjusted are left untouched: a rollback must never silently erase real
-- inventory movement. Idempotent — a safe no-op once already reverted or
-- once any row has moved.
UPDATE "hardware_inventory" AS hi
SET "available" = 0
FROM "hardware_products" AS hp
WHERE hi."productId" = hp."id"
  AND hi."available" = 25
  AND hi."allocated" = 0
  AND hi."shipped" = 0
  AND hp."status" = 'published'
  AND hp."saleMode" = 'DIRECT_SALE'
  AND hp."category" <> 'service';
