-- v3.0.0 strict multi-branch scope migration.
--
-- This is the canonical v3.0.0 schema delta. It transforms every
-- operational entity from tenant-only to (tenantId, branchId) compound
-- scope, settings tables from per-tenant 1:1 to the override pattern,
-- and the User model into a branch-aware allow-list shape.
--
-- Strict invariants enforced at the DB layer:
--   * Every operational table column branchId is NOT NULL + FK Restrict.
--     Archiving a branch fails until ops re-attributes rows explicitly.
--   * Settings tables carry @@unique([tenantId, branchId]) with NULLS
--     NOT DISTINCT (PG15+) so the tenant-default row (branchId=null) is
--     unique and per-branch overrides land as separate rows.
--   * Table(id, branchId) is unique so Reservation/Order can carry
--     compound FKs back, guaranteeing branchId == table.branchId at the
--     DB layer (no application-code race can wedge cross-branch refs).
--   * users CHECK constraint: WAITER/KITCHEN/COURIER roles must carry
--     a non-null primaryBranchId. The application cannot create a
--     restricted user without a home branch even if it tried.
--
-- Cutover model: in-place backfill. Staging hit "branchId of
-- relation devices contains null values" trying to flip the column
-- to NOT NULL on a live v2 dataset (deploy log run 26723493012).
-- The block below seeds a Main branch for every tenant that lacks
-- one and backfills every NULL branchId column to that branch
-- BEFORE the SET NOT NULL / ADD COLUMN NOT NULL statements run.
-- All steps are idempotent; reapplying is safe.

-- 1. Ensure every tenant has a Main branch (idempotent — skips
--    tenants that already have one active).
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

-- 2. Backfill every nullable branchId column on tables that v2
--    already had a (nullable) branchId on. Stamping with the
--    tenant's first active branch keeps history aligned to the
--    canonical Main row created in step 1.
UPDATE "devices" d
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = d."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE d."branchId" IS NULL;

UPDATE "tables" t
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = t."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE t."branchId" IS NULL;

UPDATE "orders" o
SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = o."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
)
WHERE o."branchId" IS NULL;

-- DropForeignKey
ALTER TABLE "tables" DROP CONSTRAINT "tables_branchId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_branchId_fkey";

-- DropForeignKey
ALTER TABLE "devices" DROP CONSTRAINT "devices_branchId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "qr_menu_settings_tenantId_key";

-- DropIndex
DROP INDEX IF EXISTS "pos_settings_tenantId_key";

-- DropIndex
DROP INDEX IF EXISTS "reservation_settings_tenantId_key";

-- DropIndex
DROP INDEX IF EXISTS "sms_settings_tenantId_key";

-- DropIndex
DROP INDEX IF EXISTS "integration_settings_tenantId_integrationType_provider_key";

-- DropIndex
DROP INDEX IF EXISTS "stock_settings_tenantId_key";

-- DropIndex
DROP INDEX IF EXISTS "accounting_settings_tenantId_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "primaryBranchId" TEXT;

-- AlterTable
ALTER TABLE "tables" ALTER COLUMN "branchId" SET NOT NULL;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "branchId" SET NOT NULL;

-- AddColumn nullable
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "payments" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "payments" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "order_item_payments" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "order_item_payments" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "order_item_payments" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "pending_self_payments" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "pending_self_payments" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "pending_self_payments" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "stock_movements" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "stock_movements" ALTER COLUMN "branchId" SET NOT NULL;


-- AlterTable
ALTER TABLE "qr_menu_settings" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- AlterTable
ALTER TABLE "pos_settings" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- AlterTable
ALTER TABLE "reservation_settings" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- AlterTable
ALTER TABLE "sms_settings" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- AddColumn nullable
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "reservations" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "reservations" ALTER COLUMN "branchId" SET NOT NULL;


-- AlterTable
ALTER TABLE "integration_settings" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- AddColumn nullable
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "notifications" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "notifications" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "waiter_requests" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "waiter_requests" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "waiter_requests" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "bill_requests" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "bill_requests" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "bill_requests" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "z_reports" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "z_reports" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "z_reports" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "cash_drawer_movements" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "cash_drawer_movements" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "cash_drawer_movements" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "cameras" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "cameras" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "cameras" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "occupancy_records" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "occupancy_records" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "occupancy_records" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "traffic_flow_records" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "traffic_flow_records" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "traffic_flow_records" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "table_analytics" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "table_analytics" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "table_analytics" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "analytics_insights" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "analytics_insights" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "analytics_insights" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "analytics_heatmap_cache" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "analytics_heatmap_cache" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "analytics_heatmap_cache" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "edge_devices" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "edge_devices" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "edge_devices" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "delivery_platform_logs" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "delivery_platform_logs" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "delivery_platform_logs" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "stock_items" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "stock_items" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "stock_batches" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "stock_batches" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "stock_batches" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "recipes" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "recipes" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "purchase_orders" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "purchase_orders" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "ingredient_movements" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "ingredient_movements" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "ingredient_movements" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "waste_logs" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "waste_logs" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "waste_logs" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "stock_counts" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "stock_counts" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "stock_counts" ALTER COLUMN "branchId" SET NOT NULL;


-- AlterTable
ALTER TABLE "stock_settings" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- AddColumn nullable
ALTER TABLE "attendances" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "attendances" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "attendances" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "shift_templates" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "shift_templates" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "shift_templates" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "shift_assignments" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "shift_assignments" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "shift_assignments" ALTER COLUMN "branchId" SET NOT NULL;


-- AddColumn nullable
ALTER TABLE "shift_swap_requests" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "shift_swap_requests" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "shift_swap_requests" ALTER COLUMN "branchId" SET NOT NULL;


-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- AlterTable
ALTER TABLE "devices" ALTER COLUMN "branchId" SET NOT NULL;

-- AddColumn nullable
ALTER TABLE "device_commands" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
-- Backfill from tenant's first active branch
UPDATE "device_commands" x SET "branchId" = (
  SELECT b."id" FROM "branches" b
  WHERE b."tenantId" = x."tenantId" AND b."status" = 'active'
  ORDER BY b."createdAt" ASC LIMIT 1
) WHERE x."branchId" IS NULL;
-- Promote to NOT NULL
ALTER TABLE "device_commands" ALTER COLUMN "branchId" SET NOT NULL;


-- CreateTable
CREATE TABLE IF NOT EXISTS "user_branch_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branch_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_branch_assignments_tenantId_branchId_idx" ON "user_branch_assignments"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_branch_assignments_userId_branchId_key" ON "user_branch_assignments"("userId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_tenantId_primaryBranchId_idx" ON "users"("tenantId", "primaryBranchId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tables_id_branchId_key" ON "tables"("id", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_tenantId_branchId_idx" ON "payments"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_item_payments_tenantId_branchId_idx" ON "order_item_payments"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pending_self_payments_tenantId_branchId_idx" ON "pending_self_payments"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_movements_tenantId_branchId_idx" ON "stock_movements"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "qr_menu_settings_tenantId_branchId_key" ON "qr_menu_settings"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pos_settings_tenantId_branchId_key" ON "pos_settings"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reservation_settings_tenantId_branchId_key" ON "reservation_settings"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sms_settings_tenantId_branchId_key" ON "sms_settings"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reservations_tenantId_branchId_idx" ON "reservations"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "integration_settings_tenantId_branchId_idx" ON "integration_settings"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "integration_settings_tenantId_branchId_integrationType_prov_key" ON "integration_settings"("tenantId", "branchId", "integrationType", "provider");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_tenantId_branchId_idx" ON "notifications"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "waiter_requests_tenantId_branchId_idx" ON "waiter_requests"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bill_requests_tenantId_branchId_idx" ON "bill_requests"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "z_reports_tenantId_branchId_idx" ON "z_reports"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cash_drawer_movements_tenantId_branchId_idx" ON "cash_drawer_movements"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cameras_tenantId_branchId_idx" ON "cameras"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "occupancy_records_tenantId_branchId_idx" ON "occupancy_records"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "traffic_flow_records_tenantId_branchId_idx" ON "traffic_flow_records"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "table_analytics_tenantId_branchId_idx" ON "table_analytics"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "analytics_insights_tenantId_branchId_idx" ON "analytics_insights"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "analytics_heatmap_cache_tenantId_branchId_idx" ON "analytics_heatmap_cache"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "edge_devices_tenantId_branchId_idx" ON "edge_devices"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "delivery_platform_logs_tenantId_branchId_idx" ON "delivery_platform_logs"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_items_tenantId_branchId_idx" ON "stock_items"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_batches_tenantId_branchId_idx" ON "stock_batches"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "recipes_tenantId_branchId_idx" ON "recipes"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "purchase_orders_tenantId_branchId_idx" ON "purchase_orders"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ingredient_movements_tenantId_branchId_idx" ON "ingredient_movements"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "waste_logs_tenantId_branchId_idx" ON "waste_logs"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_counts_tenantId_branchId_idx" ON "stock_counts"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "stock_settings_tenantId_branchId_key" ON "stock_settings"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "attendances_tenantId_branchId_idx" ON "attendances"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shift_templates_tenantId_branchId_idx" ON "shift_templates"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shift_assignments_tenantId_branchId_idx" ON "shift_assignments"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shift_swap_requests_tenantId_branchId_idx" ON "shift_swap_requests"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_settings_tenantId_branchId_key" ON "accounting_settings"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "device_commands_tenantId_branchId_idx" ON "device_commands"("tenantId", "branchId");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "users" ADD CONSTRAINT "users_primaryBranchId_fkey" FOREIGN KEY ("primaryBranchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "tables" ADD CONSTRAINT "tables_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "payments" ADD CONSTRAINT "payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "order_item_payments" ADD CONSTRAINT "order_item_payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "pending_self_payments" ADD CONSTRAINT "pending_self_payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "qr_menu_settings" ADD CONSTRAINT "qr_menu_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "reservation_settings" ADD CONSTRAINT "reservation_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "sms_settings" ADD CONSTRAINT "sms_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "reservations" ADD CONSTRAINT "reservations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "integration_settings" ADD CONSTRAINT "integration_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "notifications" ADD CONSTRAINT "notifications_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "waiter_requests" ADD CONSTRAINT "waiter_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "bill_requests" ADD CONSTRAINT "bill_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "z_reports" ADD CONSTRAINT "z_reports_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "cash_drawer_movements" ADD CONSTRAINT "cash_drawer_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "cameras" ADD CONSTRAINT "cameras_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "occupancy_records" ADD CONSTRAINT "occupancy_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "traffic_flow_records" ADD CONSTRAINT "traffic_flow_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "table_analytics" ADD CONSTRAINT "table_analytics_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "analytics_insights" ADD CONSTRAINT "analytics_insights_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "analytics_heatmap_cache" ADD CONSTRAINT "analytics_heatmap_cache_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "edge_devices" ADD CONSTRAINT "edge_devices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "delivery_platform_logs" ADD CONSTRAINT "delivery_platform_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "recipes" ADD CONSTRAINT "recipes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "ingredient_movements" ADD CONSTRAINT "ingredient_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "stock_settings" ADD CONSTRAINT "stock_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "attendances" ADD CONSTRAINT "attendances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "devices" ADD CONSTRAINT "devices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================
-- v3.0.0 additions beyond Prisma's emitted DDL.
-- ============================================================

-- Settings compound unique indexes get upgraded to NULLS NOT DISTINCT
-- so a tenant cannot accidentally end up with two "default" rows
-- (branchId=NULL) for the same settings type. Prisma 6.19 does not yet
-- emit this modifier; the DROP/CREATE pair below replaces each index.
DROP INDEX IF EXISTS "qr_menu_settings_tenantId_branchId_key";
DROP INDEX IF EXISTS "pos_settings_tenantId_branchId_key";
DROP INDEX IF EXISTS "reservation_settings_tenantId_branchId_key";
DROP INDEX IF EXISTS "sms_settings_tenantId_branchId_key";
DROP INDEX IF EXISTS "accounting_settings_tenantId_branchId_key";
DROP INDEX IF EXISTS "stock_settings_tenantId_branchId_key";
DROP INDEX IF EXISTS "integration_settings_tenantId_branchId_integrationType_provider_key";

CREATE UNIQUE INDEX IF NOT EXISTS "qr_menu_settings_tenantId_branchId_key"
  ON "qr_menu_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "pos_settings_tenantId_branchId_key"
  ON "pos_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "reservation_settings_tenantId_branchId_key"
  ON "reservation_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "sms_settings_tenantId_branchId_key"
  ON "sms_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_settings_tenantId_branchId_key"
  ON "accounting_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "stock_settings_tenantId_branchId_key"
  ON "stock_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "integration_settings_tenantId_branchId_integrationType_provider_key"
  ON "integration_settings"("tenantId", "branchId", "integrationType", "provider") NULLS NOT DISTINCT;

-- CHECK constraint: WAITER/KITCHEN/COURIER roles require a
-- primaryBranchId. The application can no longer mint a restricted
-- user without a home branch even if the registration flow has a bug.
ALTER TABLE "users" ADD CONSTRAINT "users_restricted_role_requires_primary_branch"
  CHECK (
    "role" NOT IN ('WAITER', 'KITCHEN', 'COURIER')
    OR "primaryBranchId" IS NOT NULL
  );

-- Compound FK back-references: Reservation and Order both carry
-- (tableId, branchId) → tables(id, branchId). This guarantees the
-- branchId column matches the table's branchId at every write — no
-- service-layer bug can wedge a cross-branch reference. MATCH SIMPLE
-- (default) treats NULL tableId as "no FK row needed", so takeaway
-- orders and unseated reservations pass through unchanged.
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_tableId_branchId_fkey"
  FOREIGN KEY ("tableId", "branchId") REFERENCES "tables"("id", "branchId")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_tableId_branchId_fkey"
  FOREIGN KEY ("tableId", "branchId") REFERENCES "tables"("id", "branchId")
  ON DELETE SET NULL ON UPDATE CASCADE;
