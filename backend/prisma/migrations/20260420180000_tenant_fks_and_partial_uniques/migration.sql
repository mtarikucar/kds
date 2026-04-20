-- Seven models previously stored `tenantId` as a bare String with no FK.
-- Cascade on tenant delete was silently broken; a bug in service code could
-- write a cross-tenant value with no DB-level catch. Add the relations and
-- let Postgres enforce referential integrity. Orphaned rows are deleted
-- before the FK is created so the constraint can be applied cleanly.

-- ========== RestaurantLayout ==========
DELETE FROM "restaurant_layouts" WHERE "tenantId" NOT IN (SELECT id FROM "tenants");
ALTER TABLE "restaurant_layouts"
  ADD CONSTRAINT "restaurant_layouts_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- ========== Payment ==========
DELETE FROM "payments" WHERE "tenantId" NOT IN (SELECT id FROM "tenants");
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- Payment idempotency: the Prisma-native @@unique([orderId, idempotencyKey])
-- does NOT dedupe NULL keys in Postgres (multiple NULLs distinct). The
-- unique index created by Prisma for that @@unique still exists from the
-- earlier migration; add a partial unique that actually enforces the
-- guarantee for non-null keys.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_orderId_idempotencyKey_notnull_key"
  ON "payments"("orderId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- Composite indexes used by admin payment lists
CREATE INDEX IF NOT EXISTS "payments_tenantId_status_idx" ON "payments"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "payments_tenantId_createdAt_idx" ON "payments"("tenantId", "createdAt");

-- ========== CustomerSession ==========
DELETE FROM "customer_sessions" WHERE "tenantId" NOT IN (SELECT id FROM "tenants");
ALTER TABLE "customer_sessions"
  ADD CONSTRAINT "customer_sessions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- ========== PhoneVerification ==========
DELETE FROM "phone_verifications" WHERE "tenantId" NOT IN (SELECT id FROM "tenants");
ALTER TABLE "phone_verifications"
  ADD CONSTRAINT "phone_verifications_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- ========== WaiterRequest ==========
DELETE FROM "waiter_requests" WHERE "tenantId" NOT IN (SELECT id FROM "tenants");
ALTER TABLE "waiter_requests"
  ADD CONSTRAINT "waiter_requests_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- ========== BillRequest ==========
DELETE FROM "bill_requests" WHERE "tenantId" NOT IN (SELECT id FROM "tenants");
ALTER TABLE "bill_requests"
  ADD CONSTRAINT "bill_requests_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- ========== CashDrawerMovement ==========
DELETE FROM "cash_drawer_movements" WHERE "tenantId" NOT IN (SELECT id FROM "tenants");
ALTER TABLE "cash_drawer_movements"
  ADD CONSTRAINT "cash_drawer_movements_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "cash_drawer_movements_tenantId_createdAt_idx"
  ON "cash_drawer_movements"("tenantId", "createdAt");

-- ========== UserActivity ==========
DELETE FROM "user_activities" WHERE "tenantId" NOT IN (SELECT id FROM "tenants");
ALTER TABLE "user_activities"
  ADD CONSTRAINT "user_activities_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "user_activities_tenantId_createdAt_idx"
  ON "user_activities"("tenantId", "createdAt");

-- ========== LoyaltyTransaction ==========
-- Tenant isolation was previously implicit via customerId → Customer. Add
-- an explicit tenantId + FK so audit queries don't need a join and a bug
-- in service code can't write cross-tenant rows. Flip the Customer cascade
-- to Restrict so loyalty audit survives customer deletion.
ALTER TABLE "loyalty_transactions" ADD COLUMN "tenantId" TEXT;

UPDATE "loyalty_transactions" lt
SET "tenantId" = c."tenantId"
FROM "customers" c
WHERE lt."customerId" = c."id" AND lt."tenantId" IS NULL;

DELETE FROM "loyalty_transactions" WHERE "tenantId" IS NULL;
ALTER TABLE "loyalty_transactions" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "loyalty_transactions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- Flip customer cascade to Restrict. Done by dropping + recreating the
-- existing FK; the constraint name matches Prisma's default convention.
ALTER TABLE "loyalty_transactions"
  DROP CONSTRAINT IF EXISTS "loyalty_transactions_customerId_fkey";
ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "loyalty_transactions_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS "loyalty_transactions_tenantId_idx"
  ON "loyalty_transactions"("tenantId");
CREATE INDEX IF NOT EXISTS "loyalty_transactions_tenantId_createdAt_idx"
  ON "loyalty_transactions"("tenantId", "createdAt");

-- ========== Subscription one-active-per-tenant guard ==========
-- Business rule: a tenant can only have one simultaneously-active subscription
-- (ACTIVE, TRIALING, PAST_DUE, or CANCELED-but-with-end-of-period-access).
-- Without this, a race in the billing flow can insert a duplicate ACTIVE row.
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_tenantId_active_key"
  ON "subscriptions"("tenantId")
  WHERE "status" IN ('ACTIVE', 'TRIALING', 'PAST_DUE');
