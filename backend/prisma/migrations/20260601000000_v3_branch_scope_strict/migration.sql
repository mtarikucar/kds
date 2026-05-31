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
-- Cutover model: FRESH DB. The deploy runbook TRUNCATEs every
-- operational table CASCADE before applying this migration, so the
-- NOT NULL ADD COLUMN statements below land cleanly without a
-- backfill step. There is NO backward-compatibility path; v2 token
-- holders get 401 and re-login.

-- DropForeignKey
ALTER TABLE "tables" DROP CONSTRAINT "tables_branchId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_branchId_fkey";

-- DropForeignKey
ALTER TABLE "devices" DROP CONSTRAINT "devices_branchId_fkey";

-- DropIndex
DROP INDEX "qr_menu_settings_tenantId_key";

-- DropIndex
DROP INDEX "pos_settings_tenantId_key";

-- DropIndex
DROP INDEX "reservation_settings_tenantId_key";

-- DropIndex
DROP INDEX "sms_settings_tenantId_key";

-- DropIndex
DROP INDEX "integration_settings_tenantId_integrationType_provider_key";

-- DropIndex
DROP INDEX "stock_settings_tenantId_key";

-- DropIndex
DROP INDEX "accounting_settings_tenantId_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "primaryBranchId" TEXT;

-- AlterTable
ALTER TABLE "tables" ALTER COLUMN "branchId" SET NOT NULL;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "branchId" SET NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "order_item_payments" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "pending_self_payments" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "qr_menu_settings" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "pos_settings" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "reservation_settings" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "sms_settings" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "integration_settings" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "waiter_requests" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "bill_requests" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "z_reports" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "cash_drawer_movements" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "cameras" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "occupancy_records" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "traffic_flow_records" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "table_analytics" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "analytics_insights" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "analytics_heatmap_cache" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "edge_devices" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "delivery_platform_logs" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "stock_batches" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ingredient_movements" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "waste_logs" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "stock_counts" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "stock_settings" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "shift_templates" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "shift_assignments" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "shift_swap_requests" ADD COLUMN     "branchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "devices" ALTER COLUMN "branchId" SET NOT NULL;

-- AlterTable
ALTER TABLE "device_commands" ADD COLUMN     "branchId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "user_branch_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branch_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_branch_assignments_tenantId_branchId_idx" ON "user_branch_assignments"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "user_branch_assignments_userId_branchId_key" ON "user_branch_assignments"("userId", "branchId");

-- CreateIndex
CREATE INDEX "users_tenantId_primaryBranchId_idx" ON "users"("tenantId", "primaryBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "tables_id_branchId_key" ON "tables"("id", "branchId");

-- CreateIndex
CREATE INDEX "payments_tenantId_branchId_idx" ON "payments"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "order_item_payments_tenantId_branchId_idx" ON "order_item_payments"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "pending_self_payments_tenantId_branchId_idx" ON "pending_self_payments"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_branchId_idx" ON "stock_movements"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "qr_menu_settings_tenantId_branchId_key" ON "qr_menu_settings"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_settings_tenantId_branchId_key" ON "pos_settings"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_settings_tenantId_branchId_key" ON "reservation_settings"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "sms_settings_tenantId_branchId_key" ON "sms_settings"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "reservations_tenantId_branchId_idx" ON "reservations"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "integration_settings_tenantId_branchId_idx" ON "integration_settings"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_settings_tenantId_branchId_integrationType_prov_key" ON "integration_settings"("tenantId", "branchId", "integrationType", "provider");

-- CreateIndex
CREATE INDEX "notifications_tenantId_branchId_idx" ON "notifications"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "waiter_requests_tenantId_branchId_idx" ON "waiter_requests"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "bill_requests_tenantId_branchId_idx" ON "bill_requests"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "z_reports_tenantId_branchId_idx" ON "z_reports"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "cash_drawer_movements_tenantId_branchId_idx" ON "cash_drawer_movements"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "cameras_tenantId_branchId_idx" ON "cameras"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "occupancy_records_tenantId_branchId_idx" ON "occupancy_records"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "traffic_flow_records_tenantId_branchId_idx" ON "traffic_flow_records"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "table_analytics_tenantId_branchId_idx" ON "table_analytics"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "analytics_insights_tenantId_branchId_idx" ON "analytics_insights"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "analytics_heatmap_cache_tenantId_branchId_idx" ON "analytics_heatmap_cache"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "edge_devices_tenantId_branchId_idx" ON "edge_devices"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "delivery_platform_logs_tenantId_branchId_idx" ON "delivery_platform_logs"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "stock_items_tenantId_branchId_idx" ON "stock_items"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "stock_batches_tenantId_branchId_idx" ON "stock_batches"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "recipes_tenantId_branchId_idx" ON "recipes"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_branchId_idx" ON "purchase_orders"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "ingredient_movements_tenantId_branchId_idx" ON "ingredient_movements"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "waste_logs_tenantId_branchId_idx" ON "waste_logs"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "stock_counts_tenantId_branchId_idx" ON "stock_counts"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_settings_tenantId_branchId_key" ON "stock_settings"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "attendances_tenantId_branchId_idx" ON "attendances"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "shift_templates_tenantId_branchId_idx" ON "shift_templates"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "shift_assignments_tenantId_branchId_idx" ON "shift_assignments"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "shift_swap_requests_tenantId_branchId_idx" ON "shift_swap_requests"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settings_tenantId_branchId_key" ON "accounting_settings"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "device_commands_tenantId_branchId_idx" ON "device_commands"("tenantId", "branchId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_primaryBranchId_fkey" FOREIGN KEY ("primaryBranchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_payments" ADD CONSTRAINT "order_item_payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_self_payments" ADD CONSTRAINT "pending_self_payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_menu_settings" ADD CONSTRAINT "qr_menu_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_settings" ADD CONSTRAINT "reservation_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_settings" ADD CONSTRAINT "sms_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_settings" ADD CONSTRAINT "integration_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_requests" ADD CONSTRAINT "waiter_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_requests" ADD CONSTRAINT "bill_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "z_reports" ADD CONSTRAINT "z_reports_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_drawer_movements" ADD CONSTRAINT "cash_drawer_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupancy_records" ADD CONSTRAINT "occupancy_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_flow_records" ADD CONSTRAINT "traffic_flow_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_analytics" ADD CONSTRAINT "table_analytics_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_insights" ADD CONSTRAINT "analytics_insights_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_heatmap_cache" ADD CONSTRAINT "analytics_heatmap_cache_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edge_devices" ADD CONSTRAINT "edge_devices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_platform_logs" ADD CONSTRAINT "delivery_platform_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_movements" ADD CONSTRAINT "ingredient_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_settings" ADD CONSTRAINT "stock_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


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

CREATE UNIQUE INDEX "qr_menu_settings_tenantId_branchId_key"
  ON "qr_menu_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "pos_settings_tenantId_branchId_key"
  ON "pos_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "reservation_settings_tenantId_branchId_key"
  ON "reservation_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "sms_settings_tenantId_branchId_key"
  ON "sms_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "accounting_settings_tenantId_branchId_key"
  ON "accounting_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "stock_settings_tenantId_branchId_key"
  ON "stock_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "integration_settings_tenantId_branchId_integrationType_provider_key"
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
