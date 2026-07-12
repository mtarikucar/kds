-- Accounting period lock for the OpEx ledger: once a (tenant, year, month) is
-- locked, expense create/update/delete in that month is rejected so closed
-- books can't drift. Idempotent (IF NOT EXISTS) — safe to re-apply.
CREATE TABLE IF NOT EXISTS "expense_period_locks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedByUserId" TEXT,
    CONSTRAINT "expense_period_locks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "expense_period_locks_tenantId_year_month_key" ON "expense_period_locks"("tenantId", "year", "month");
