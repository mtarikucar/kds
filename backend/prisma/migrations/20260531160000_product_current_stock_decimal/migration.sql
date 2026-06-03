-- v2.8.98 P2f — Product.currentStock Int → Decimal(10, 3)
--
-- Pre-fix the column was INTEGER, which couldn't model fractional
-- units (kg-priced products sold in 0.5kg cuts, bottled drinks sold
-- by the pour) and overflowed at JS Number.MAX_SAFE on very-high-
-- volume warehouse SKUs.
--
-- Aligned with StockItem.currentStock at Decimal(10, 3). PostgreSQL's
-- INTEGER → NUMERIC(10, 3) cast is in-place and exact (every integer
-- < 10^10 has an exact NUMERIC(10,3) representation), so no row-by-row
-- rewrite is needed.

ALTER TABLE "products"
  ALTER COLUMN "currentStock" TYPE DECIMAL(10, 3) USING "currentStock"::DECIMAL(10, 3);
