-- Cashier shift: opening float → movements → counted close with over/short.
CREATE TABLE "cashier_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openingFloat" DECIMAL(10,2) NOT NULL,
    "countedCash" DECIMAL(10,2),
    "expectedCash" DECIMAL(10,2),
    "overShort" DECIMAL(10,2),
    "cashSales" DECIMAL(10,2),
    "cashIn" DECIMAL(10,2),
    "cashOut" DECIMAL(10,2),
    "denominationBreakdown" JSONB,
    "notes" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "cashier_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cashier_sessions_tenantId_branchId_status_idx" ON "cashier_sessions"("tenantId", "branchId", "status");
CREATE INDEX "cashier_sessions_tenantId_branchId_userId_status_idx" ON "cashier_sessions"("tenantId", "branchId", "userId", "status");
