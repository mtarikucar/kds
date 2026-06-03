-- v3.0.1 audit fix — widen the order idempotency partial unique from
-- (tenantId, idempotencyKey) to (tenantId, branchId, idempotencyKey)
-- so that a POS terminal in branch B2 retrying with idempotencyKey=k
-- can never collide with a different order created in branch B1 with
-- the same key. Pre-fix, two waiters on two branches who happened to
-- template their idempotency key deterministically (rare but seen in
-- the chain-tablet deployment) silently merged their orders.
--
-- Migration is additive in practice — every Order row in production
-- already carries a non-null branchId (v3 strict). The old single-
-- branch tenants see no change; the multi-branch tenants gain
-- isolation.
--
-- The old index must be dropped first because PostgreSQL will reject
-- the new one with the same partial WHERE clause if the old one is
-- still in place and could match a duplicate. We use
-- DROP INDEX IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS so the
-- migration is idempotent against partially-applied state.

DROP INDEX IF EXISTS "orders_tenantId_idempotencyKey_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "orders_tenantId_branchId_idempotencyKey_unique"
  ON "orders" ("tenantId", "branchId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
