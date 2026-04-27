-- Add client-supplied idempotency key for order-create dedup.
-- Mirrors the Payment.idempotencyKey pattern (see migration
-- 20260420180000). The partial unique index treats a NULL key as
-- "no dedup wanted" — multiple legacy NULL-key inserts coexist —
-- but two inserts with the same non-NULL key collide with P2002,
-- which the service catches and translates into "return existing".

ALTER TABLE "orders" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "orders_tenantId_idempotencyKey_unique"
  ON "orders" ("tenantId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
