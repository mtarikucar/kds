-- Purchasing unit-of-measure: buy in purchaseUnit, stock in the base unit.
-- purchaseConversion = base units per 1 purchase unit (a BOX of 12 → 12).
ALTER TABLE "stock_items" ADD COLUMN "purchaseUnit" TEXT;
ALTER TABLE "stock_items" ADD COLUMN "purchaseConversion" DECIMAL(10,3);
