# 20260512100000_z_report_consistency_and_indexes

## What this does

- Adds `Order.cancelledAt` so the z-report can window cancelled orders
  by the event time rather than `createdAt` (which mismatched the
  `paidAt`-based PAID window).
- Adds five composite indexes that cover hot query paths:
  - `orders(tenantId, status, paidAt)` — z-report PAID window
  - `orders(tenantId, status, cancelledAt)` — z-report cancellation window
  - `notifications(tenantId, isGlobal, expiresAt)` — inbox query
  - `reservations(tenantId, tableId, date, startTime)` — overlap check
  - `ingredient_movements(stockItemId, createdAt)` — stock history

## Production deployment notes

`CREATE INDEX` on a large table takes an `ACCESS EXCLUSIVE` lock for the
duration of the build, which blocks reads and writes. For tables ≳ 1M
rows this can be several seconds to minutes.

**If the orders / ingredient_movements tables are large at deploy time,
run the index creation manually with `CONCURRENTLY` before applying the
migration**, then comment out the matching `CREATE INDEX` lines in
`migration.sql`. Prisma's `migrate deploy` does not support
`CONCURRENTLY`.

Example manual run (psql, as DB owner):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_tenantId_status_paidAt_idx"
  ON "orders" ("tenantId", "status", "paidAt");
-- repeat for each of the five indexes
```

After the indexes exist, run `npx prisma migrate deploy`. The migration's
`CREATE INDEX IF NOT EXISTS` will see the existing indexes and skip.

## Adding the column

`ADD COLUMN cancelledAt TIMESTAMP(3)` is fast — Postgres ≥ 11 uses
metadata-only DDL for nullable columns with no default, so the table is
not rewritten and the lock is brief.

## Backfilling cancelledAt

The migration deliberately does NOT backfill historical cancelled orders.
The z-report query falls back to `createdAt` when `cancelledAt IS NULL`,
which keeps the historical numbers consistent. Backfilling would shift
old reports by whatever delta exists between the original cancel
timestamp and what we'd guess (typically `updatedAt`).

If you want to backfill anyway (e.g. for cleaner reporting going
forward), run after the deploy in a window where the dashboard isn't
being queried:

```sql
UPDATE "orders"
   SET "cancelledAt" = "updatedAt"
 WHERE "status" = 'CANCELLED' AND "cancelledAt" IS NULL;
```

This is best-effort — `updatedAt` may have moved since cancellation if
the row was touched for unrelated reasons, but it's closer than
`createdAt`.
