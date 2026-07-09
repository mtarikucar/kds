-- Monthly per-category expense budget for the budget-vs-actual report.
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "budgets_tenantId_branchId_category_year_month_key" ON "budgets"("tenantId", "branchId", "category", "year", "month");
CREATE INDEX "budgets_tenantId_branchId_year_month_idx" ON "budgets"("tenantId", "branchId", "year", "month");
