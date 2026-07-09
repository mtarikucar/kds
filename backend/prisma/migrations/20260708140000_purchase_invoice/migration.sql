-- Accounts-Payable vendor bill + 3-way match status.
CREATE TABLE "purchase_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "matchVariance" DECIMAL(12,2),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_invoices_tenantId_supplierId_invoiceNumber_key" ON "purchase_invoices"("tenantId", "supplierId", "invoiceNumber");
CREATE INDEX "purchase_invoices_tenantId_branchId_status_idx" ON "purchase_invoices"("tenantId", "branchId", "status");
CREATE INDEX "purchase_invoices_tenantId_purchaseOrderId_idx" ON "purchase_invoices"("tenantId", "purchaseOrderId");
