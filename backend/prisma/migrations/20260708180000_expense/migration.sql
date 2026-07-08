-- Operating expenses (OpEx) for the P&L line below gross profit.
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2),
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "expenses_tenantId_branchId_expenseDate_idx" ON "expenses"("tenantId", "branchId", "expenseDate");
CREATE INDEX "expenses_tenantId_category_idx" ON "expenses"("tenantId", "category");
