-- Audit trail columns: record who mutated each stock-related row so
-- investigations can trace shortfalls or bad counts back to a user.
ALTER TABLE "ingredient_movements" ADD COLUMN "createdById" TEXT;
ALTER TABLE "waste_logs" ADD COLUMN "createdById" TEXT;
ALTER TABLE "stock_counts" ADD COLUMN "createdById" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "createdById" TEXT;

-- Idempotency flag: once an order has had its recipe components deducted
-- we never do it again, even if deductOnStatus changes mid-lifecycle
-- or a duplicate hook fires.
ALTER TABLE "orders" ADD COLUMN "stockDeducted" BOOLEAN NOT NULL DEFAULT false;

-- Explicit negative-stock knob replaces the prior silent "deduct only
-- what's available" fallback. Defaults to false so shortages surface.
ALTER TABLE "stock_settings" ADD COLUMN "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false;
-- Monotonic PO-number counter, used under transaction to mint
-- deterministic PO-XXXXX identifiers without collision.
ALTER TABLE "stock_settings" ADD COLUMN "poSequence" INTEGER NOT NULL DEFAULT 0;
