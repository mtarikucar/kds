-- Task 4 (Donanım stok kontrolü ödeme-önüne) — one-time backfill of
-- representative starter stock for DIRECT_SALE hardware products still
-- sitting at the untouched schema default (available = 0).
--
-- DEFECT: CatalogService.allocate() — the only place stock was ever
-- checked — ran inside CheckoutService.confirmAndProvision, AFTER PayTR
-- had already charged the buyer. Every seeded DIRECT_SALE product's
-- hardware_inventory row defaulted to available=0 while the hand-written
-- hardware_products.stockStatus said "in_stock", so every real purchase
-- attempt paid in full and then failed with "Insufficient stock" — money
-- charged, nothing delivered (see checkout-intent.hardware-stock.spec.ts).
-- CheckoutIntentService.createIntent now rejects HARDWARE_OUT_OF_STOCK
-- BEFORE payment; this migration makes the already-seeded catalog (local/
-- staging/prod) actually sellable so that guard isn't just closing the
-- barn door on an empty barn.
--
-- Idempotent + money-safe: the "available = 0" guard makes this a
-- ONE-TIME backfill. Re-running it, or running it against a row ops has
-- since touched via receiveStock/allocate/markShipped (available no
-- longer 0, or allocated/shipped > 0 from real order activity), is a
-- no-op — real tracked inventory is NEVER overwritten. Scoped to
-- published, non-service, DIRECT_SALE rows only — the only tier
-- CatalogService.allocate() / the pre-payment stock gate ever applies to
-- (QUOTE_ONLY/PARTNER_REDIRECT/RECOMMENDED_ONLY and services never reach
-- checkout's stock check).
UPDATE "hardware_inventory" AS hi
SET "available" = 25
FROM "hardware_products" AS hp
WHERE hi."productId" = hp."id"
  AND hi."available" = 0
  AND hi."allocated" = 0
  AND hi."shipped" = 0
  AND hp."status" = 'published'
  AND hp."saleMode" = 'DIRECT_SALE'
  AND hp."category" <> 'service';
