-- Delivery platform configs: multi-branch routing + sandbox/test environment.
--
-- `environment` lets a config run against the platform's sandbox endpoints (and
-- is what the built-in test-order simulator stamps) so a tenant can validate the
-- full ingest -> KDS -> print pipeline without a live platform account.
--
-- `branchId` is the per-platform branch mapping the order-ingest path has long
-- needed (delivery orders previously fell back to the tenant's first active
-- branch). NULL preserves that legacy fallback; a set value routes the platform's
-- orders to that branch. FK is ON DELETE SET NULL so deleting a branch never
-- orphans / blocks an in-flight config.

ALTER TABLE "delivery_platform_configs"
  ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'production',
  ADD COLUMN "branchId" TEXT;

CREATE INDEX "delivery_platform_configs_branchId_idx" ON "delivery_platform_configs"("branchId");

ALTER TABLE "delivery_platform_configs"
  ADD CONSTRAINT "delivery_platform_configs_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
