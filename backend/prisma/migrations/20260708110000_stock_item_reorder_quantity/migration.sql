-- Optional fixed reorder quantity used by the reorder-suggestion engine.
-- Null falls back to a derived default (bring stock toward 2× the par level).
ALTER TABLE "stock_items" ADD COLUMN "reorderQuantity" DECIMAL(10,3);
