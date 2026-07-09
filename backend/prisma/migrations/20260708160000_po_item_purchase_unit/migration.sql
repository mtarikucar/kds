-- Opt-in purchase-unit ordering on a PO line. When conversionFactor is set,
-- the line quantities/price are in the purchase unit and receiving converts to
-- the base stock unit. Null = base-unit ordering (existing behaviour).
ALTER TABLE "purchase_order_items" ADD COLUMN "purchaseUnit" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN "conversionFactor" DECIMAL(10,3);
