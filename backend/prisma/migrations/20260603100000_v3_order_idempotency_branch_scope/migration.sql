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
--
-- ⚠ Lock window — Prisma wraps each migration in BEGIN/COMMIT, so
-- concurrent writers never observe the both-absent state. But
-- CREATE UNIQUE INDEX (non-CONCURRENTLY) takes ACCESS EXCLUSIVE on
-- `orders` for the index build duration; on a multi-million-row prod
-- table this can be tens of seconds during which POST /orders blocks.
-- For the cutover window, run during a low-traffic period OR rewrite
-- as a two-phase migration:
--   1. CREATE UNIQUE INDEX CONCURRENTLY (outside any tx)
--   2. DROP INDEX CONCURRENTLY (outside any tx)
-- Prisma can't express CONCURRENTLY in a migration; if needed, run
-- the SQL manually against prod and use `prisma migrate resolve
-- --applied <name>` to register it.

DROP INDEX IF EXISTS "orders_tenantId_idempotencyKey_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "orders_tenantId_branchId_idempotencyKey_unique"
  ON "orders" ("tenantId", "branchId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
