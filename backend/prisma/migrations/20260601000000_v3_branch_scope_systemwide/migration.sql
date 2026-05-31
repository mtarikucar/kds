-- v3.0.0 — system-wide multi-branch scope migration.
--
-- This migration turns Branch into a first-class scope dimension
-- parallel to tenantId. The plan tracks the full rationale at
-- /home/tarik/.claude/plans/lazy-cooking-scone.md. Highlights:
--
--   * Every tenant ends with exactly one active "Main" branch
--     (idempotent: existing branches stay; tenants without one get
--     a freshly-minted row).
--   * Operational tables (orders, stock, personnel, cash, KDS,
--     reports) get a nullable `branchId` FK with ON DELETE SET NULL
--     so archiving a branch never orphans operational history; the
--     backfill stamps every existing row with the tenant's Main
--     branch.
--   * Settings tables (POS / QR menu / Reservation / SMS /
--     Integration / Accounting / Stock) flip from per-tenant 1:1 to
--     the override pattern: drop the legacy `tenantId` single-column
--     unique constraint and add `@@unique(tenantId, branchId)`. The
--     existing row stays as the tenant default (branchId=null);
--     per-branch overrides land as additional rows.
--   * Users gain `primaryBranchId` (home branch — required for
--     WAITER/KITCHEN/COURIER, optional for ADMIN/MANAGER). A new
--     `user_branch_assignments` table holds the m:n allow-list
--     BranchGuard consults when ADMIN/MANAGER roams.
--
-- All DDL is transaction-safe; the backfill SQL is idempotent
-- (re-runnable). Soft mode at boot via BRANCH_SCOPE_ENFORCED=false
-- gives a grace window for legacy JWTs while the SPA refreshes.

-- ============================================================
-- 0. Defensive orphan cleanup.
--    Pre-v2.8.93 some FKs were free-form String columns. Mirrors
--    20260531100000's pattern for branches/devices.
-- ============================================================

-- (Branches/devices already cleaned in 20260531100000; nothing more
-- to do here, but leave a guard: ensure every tenant has at least
-- one branch before the backfill runs.)

-- ============================================================
-- 1. Idempotent Main branch backfill.
--    For every tenant that has no active branch, insert one named
--    "Main". Re-runnable thanks to the NOT EXISTS guard.
-- ============================================================

INSERT INTO "branches" ("id", "tenantId", "name", "timezone", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t."id",
  'Main',
  COALESCE(t."timezone", 'UTC'),
  'active',
  NOW(),
  NOW()
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "branches" b
  WHERE b."tenantId" = t."id" AND b."status" = 'active'
);

-- ============================================================
-- 2. Add branchId to operational tables.
--    Pattern: nullable FK with ON DELETE SET NULL, compound index
--    on (tenantId, branchId). Nullable because the backfill below
--    fills the values in-place; flipping to NOT NULL is a later
--    sweep once BRANCH_SCOPE_ENFORCED has been on in prod for a
--    week.
-- ============================================================

-- Stock domain.
ALTER TABLE "stock_items"            ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "stock_batches"          ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "recipes"                ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "purchase_orders"        ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "ingredient_movements"   ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "waste_logs"             ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "stock_counts"           ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "stock_movements"        ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- Order satellites (Order/Table/Device already have branchId from
-- prior migrations).
ALTER TABLE "waiter_requests"        ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "bill_requests"          ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- Reservation + Z-Report + cash drawer.
ALTER TABLE "reservations"           ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "z_reports"              ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "cash_drawer_movements"  ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- Personnel.
ALTER TABLE "attendances"            ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "shift_templates"        ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "shift_assignments"      ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "shift_swap_requests"    ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- ============================================================
-- 3. Add branchId to settings tables + flip uniqueness.
--    Drop the legacy `<table>_tenantId_key` single-column unique,
--    add compound `@@unique(tenantId, branchId)`. NULL = tenant
--    default; non-null = per-branch override.
-- ============================================================

ALTER TABLE "pos_settings"           ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "qr_menu_settings"       ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "reservation_settings"   ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "sms_settings"           ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "integration_settings"   ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "accounting_settings"    ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "stock_settings"         ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- Drop legacy single-column unique on tenantId. IF EXISTS so the
-- migration is idempotent if a hand-fix preceded it.
ALTER TABLE "pos_settings"          DROP CONSTRAINT IF EXISTS "pos_settings_tenantId_key";
ALTER TABLE "qr_menu_settings"      DROP CONSTRAINT IF EXISTS "qr_menu_settings_tenantId_key";
ALTER TABLE "reservation_settings"  DROP CONSTRAINT IF EXISTS "reservation_settings_tenantId_key";
ALTER TABLE "sms_settings"          DROP CONSTRAINT IF EXISTS "sms_settings_tenantId_key";
ALTER TABLE "accounting_settings"   DROP CONSTRAINT IF EXISTS "accounting_settings_tenantId_key";
ALTER TABLE "stock_settings"        DROP CONSTRAINT IF EXISTS "stock_settings_tenantId_key";
-- IntegrationSettings: replace 3-tuple unique with 4-tuple including
-- branchId (so a per-branch override doesn't collide with the
-- tenant-default row of the same integration provider).
ALTER TABLE "integration_settings"  DROP CONSTRAINT IF EXISTS "integration_settings_tenantId_integrationType_provider_key";

-- Add compound (tenantId, branchId) unique. Postgres treats NULL
-- as distinct in unique indexes by default — meaning multiple
-- tenant-default rows (branchId=NULL) for the same tenant would
-- pass uniqueness. That's wrong: we want exactly one default row
-- per tenant. So we use NULLS NOT DISTINCT (Postgres 15+) where
-- available; the older NULL handling is preserved as a runtime
-- check in the service layer for older Postgres targets.
CREATE UNIQUE INDEX IF NOT EXISTS "pos_settings_tenantId_branchId_key"
  ON "pos_settings" ("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "qr_menu_settings_tenantId_branchId_key"
  ON "qr_menu_settings" ("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "reservation_settings_tenantId_branchId_key"
  ON "reservation_settings" ("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "sms_settings_tenantId_branchId_key"
  ON "sms_settings" ("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "integration_settings_tenantId_branchId_integrationType_provider_key"
  ON "integration_settings" ("tenantId", "branchId", "integrationType", "provider") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_settings_tenantId_branchId_key"
  ON "accounting_settings" ("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "stock_settings_tenantId_branchId_key"
  ON "stock_settings" ("tenantId", "branchId") NULLS NOT DISTINCT;

-- ============================================================
-- 4. Add User.primaryBranchId + UserBranchAssignment.
--    Nullable on Users so existing accounts keep working in soft
--    mode. The m:n allow-list table is brand new.
-- ============================================================

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "primaryBranchId" TEXT;

CREATE TABLE IF NOT EXISTS "user_branch_assignments" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "branchId"     TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "assignedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_branch_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_branch_assignments_userId_branchId_key"
  ON "user_branch_assignments"("userId", "branchId");
CREATE INDEX IF NOT EXISTS "user_branch_assignments_tenantId_idx"
  ON "user_branch_assignments"("tenantId");
CREATE INDEX IF NOT EXISTS "user_branch_assignments_tenantId_branchId_idx"
  ON "user_branch_assignments"("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "user_branch_assignments_userId_idx"
  ON "user_branch_assignments"("userId");
CREATE INDEX IF NOT EXISTS "user_branch_assignments_branchId_idx"
  ON "user_branch_assignments"("branchId");

-- ============================================================
-- 5. Foreign keys for every new branchId column.
--    All SET NULL on delete: archiving a branch must not cascade
--    into operational history. Wrapped in a DO block + EXCEPTION
--    so re-running the migration over partially-applied state
--    doesn't fail on duplicate constraint names.
-- ============================================================

DO $$
BEGIN
  -- Operational FKs.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_items_branchId_fkey') THEN
    ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_batches_branchId_fkey') THEN
    ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_branchId_fkey') THEN
    ALTER TABLE "recipes" ADD CONSTRAINT "recipes_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_branchId_fkey') THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingredient_movements_branchId_fkey') THEN
    ALTER TABLE "ingredient_movements" ADD CONSTRAINT "ingredient_movements_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waste_logs_branchId_fkey') THEN
    ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_counts_branchId_fkey') THEN
    ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_branchId_fkey') THEN
    ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waiter_requests_branchId_fkey') THEN
    ALTER TABLE "waiter_requests" ADD CONSTRAINT "waiter_requests_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_requests_branchId_fkey') THEN
    ALTER TABLE "bill_requests" ADD CONSTRAINT "bill_requests_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_branchId_fkey') THEN
    ALTER TABLE "reservations" ADD CONSTRAINT "reservations_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'z_reports_branchId_fkey') THEN
    ALTER TABLE "z_reports" ADD CONSTRAINT "z_reports_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_drawer_movements_branchId_fkey') THEN
    ALTER TABLE "cash_drawer_movements" ADD CONSTRAINT "cash_drawer_movements_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendances_branchId_fkey') THEN
    ALTER TABLE "attendances" ADD CONSTRAINT "attendances_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_templates_branchId_fkey') THEN
    ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_assignments_branchId_fkey') THEN
    ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_swap_requests_branchId_fkey') THEN
    ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- Settings FKs.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_branchId_fkey') THEN
    ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qr_menu_settings_branchId_fkey') THEN
    ALTER TABLE "qr_menu_settings" ADD CONSTRAINT "qr_menu_settings_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_settings_branchId_fkey') THEN
    ALTER TABLE "reservation_settings" ADD CONSTRAINT "reservation_settings_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sms_settings_branchId_fkey') THEN
    ALTER TABLE "sms_settings" ADD CONSTRAINT "sms_settings_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_settings_branchId_fkey') THEN
    ALTER TABLE "integration_settings" ADD CONSTRAINT "integration_settings_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_settings_branchId_fkey') THEN
    ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_settings_branchId_fkey') THEN
    ALTER TABLE "stock_settings" ADD CONSTRAINT "stock_settings_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- Users FK.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_primaryBranchId_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_primaryBranchId_fkey"
      FOREIGN KEY ("primaryBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- UserBranchAssignment FKs.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_branch_assignments_userId_fkey') THEN
    ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_branch_assignments_branchId_fkey') THEN
    ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_branch_assignments_tenantId_fkey') THEN
    ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_branch_assignments_assignedById_fkey') THEN
    ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_assignedById_fkey"
      FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 6. Compound indexes on (tenantId, branchId) for every
--    branch-scoped operational table. Settings tables already
--    got their compound unique above.
-- ============================================================

CREATE INDEX IF NOT EXISTS "stock_items_tenantId_branchId_idx"            ON "stock_items"            ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "stock_batches_tenantId_branchId_idx"          ON "stock_batches"          ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "recipes_tenantId_branchId_idx"                ON "recipes"                ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "purchase_orders_tenantId_branchId_idx"        ON "purchase_orders"        ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "ingredient_movements_tenantId_branchId_idx"   ON "ingredient_movements"   ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "waste_logs_tenantId_branchId_idx"             ON "waste_logs"             ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "stock_counts_tenantId_branchId_idx"           ON "stock_counts"           ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "stock_movements_tenantId_branchId_idx"        ON "stock_movements"        ("tenantId", "branchId");

CREATE INDEX IF NOT EXISTS "waiter_requests_tenantId_branchId_idx"        ON "waiter_requests"        ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "bill_requests_tenantId_branchId_idx"          ON "bill_requests"          ("tenantId", "branchId");

CREATE INDEX IF NOT EXISTS "reservations_tenantId_branchId_idx"           ON "reservations"           ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "z_reports_tenantId_branchId_idx"              ON "z_reports"              ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "cash_drawer_movements_tenantId_branchId_idx"  ON "cash_drawer_movements"  ("tenantId", "branchId");

CREATE INDEX IF NOT EXISTS "attendances_tenantId_branchId_idx"            ON "attendances"            ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "shift_templates_tenantId_branchId_idx"        ON "shift_templates"        ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "shift_assignments_tenantId_branchId_idx"      ON "shift_assignments"      ("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "shift_swap_requests_tenantId_branchId_idx"    ON "shift_swap_requests"    ("tenantId", "branchId");

CREATE INDEX IF NOT EXISTS "users_tenantId_primaryBranchId_idx"           ON "users"                  ("tenantId", "primaryBranchId");

-- ============================================================
-- 7. Backfill: stamp every existing row with the tenant's Main
--    branch. Each UPDATE is idempotent (WHERE branchId IS NULL).
-- ============================================================

-- Helper expression: SELECT the tenant's first active branch.
-- Inlined per-table because Postgres doesn't have a "WITH" form
-- that survives across statements in a migration file.

UPDATE "stock_items" si
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = si."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE si."branchId" IS NULL;

UPDATE "stock_batches" sb
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = sb."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE sb."branchId" IS NULL;

UPDATE "recipes" r
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = r."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE r."branchId" IS NULL;

UPDATE "purchase_orders" po
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = po."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE po."branchId" IS NULL;

UPDATE "ingredient_movements" im
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = im."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE im."branchId" IS NULL;

UPDATE "waste_logs" wl
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = wl."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE wl."branchId" IS NULL;

UPDATE "stock_counts" sc
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = sc."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE sc."branchId" IS NULL;

UPDATE "stock_movements" sm
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = sm."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE sm."branchId" IS NULL;

UPDATE "waiter_requests" wr
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = wr."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE wr."branchId" IS NULL;

UPDATE "bill_requests" br
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = br."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE br."branchId" IS NULL;

UPDATE "reservations" r
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = r."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE r."branchId" IS NULL;

UPDATE "z_reports" zr
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = zr."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE zr."branchId" IS NULL;

UPDATE "cash_drawer_movements" cdm
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = cdm."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE cdm."branchId" IS NULL;

UPDATE "attendances" a
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = a."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE a."branchId" IS NULL;

UPDATE "shift_templates" st
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = st."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE st."branchId" IS NULL;

UPDATE "shift_assignments" sa
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = sa."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE sa."branchId" IS NULL;

UPDATE "shift_swap_requests" ssr
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = ssr."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE ssr."branchId" IS NULL;

-- Settings: existing rows stay as the tenant default. branchId
-- remains NULL by design (the override pattern's "default" row).

-- ============================================================
-- 8. User primaryBranchId backfill.
--    WAITER / KITCHEN / COURIER get a mandatory home branch
--    (BranchGuard hard-restricts these roles to it). ADMIN /
--    MANAGER stay NULL — they roam via BranchPicker by default;
--    ops can explicitly set primaryBranchId via the admin panel.
-- ============================================================

UPDATE "users" u
SET "primaryBranchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = u."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE u."primaryBranchId" IS NULL
  AND u."role" IN ('WAITER', 'KITCHEN', 'COURIER');

-- WAITER / KITCHEN / COURIER also need an explicit allow-list
-- entry so BranchGuard's allow-list checks don't false-reject.
INSERT INTO "user_branch_assignments" ("id", "userId", "branchId", "tenantId", "createdAt")
SELECT
  gen_random_uuid()::text,
  u."id",
  u."primaryBranchId",
  u."tenantId",
  NOW()
FROM "users" u
WHERE u."primaryBranchId" IS NOT NULL
  AND u."role" IN ('WAITER', 'KITCHEN', 'COURIER')
  AND NOT EXISTS (
    SELECT 1 FROM "user_branch_assignments" uba
    WHERE uba."userId" = u."id" AND uba."branchId" = u."primaryBranchId"
  );
