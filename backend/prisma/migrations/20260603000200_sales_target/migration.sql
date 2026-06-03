-- Phase 4 sales targets/quotas. A manager sets a per-rep, per-period target for
-- a metric; performance is computed from marketing-owned data and compared.
-- marketingUserId/setById are soft references to MarketingUser (no FK — portable
-- for the eventual DB split).
CREATE TABLE "sales_targets" (
  "id"              TEXT NOT NULL,
  "marketingUserId" TEXT NOT NULL,
  "period"          TEXT NOT NULL,
  "metric"          TEXT NOT NULL,
  "targetValue"     DECIMAL(14,2) NOT NULL,
  "setById"         TEXT NOT NULL,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sales_targets_marketingUserId_period_metric_key" ON "sales_targets"("marketingUserId", "period", "metric");
CREATE INDEX "sales_targets_period_idx" ON "sales_targets"("period");
CREATE INDEX "sales_targets_marketingUserId_period_idx" ON "sales_targets"("marketingUserId", "period");
