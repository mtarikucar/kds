-- Scannable barcode on stock items for receiving + counts.
ALTER TABLE "stock_items" ADD COLUMN "barcode" TEXT;
CREATE INDEX "stock_items_tenantId_branchId_barcode_idx" ON "stock_items"("tenantId", "branchId", "barcode");
