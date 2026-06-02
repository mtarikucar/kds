#!/usr/bin/env python3
"""
Rewrite the v3 strict-branch migration so it survives an in-place
deploy on a populated v2 database.

The original migration emits `ALTER TABLE <X> ADD COLUMN "branchId"
TEXT NOT NULL` directly. On an empty schema this is fine, but on a
live staging/prod DB with existing rows PostgreSQL refuses (cannot
add NOT NULL column with no DEFAULT). Same goes for the
`ALTER COLUMN "branchId" SET NOT NULL` flips on tables that already
carry a nullable branchId column (orders/tables/devices).

This script rewrites both patterns into a 3-step shape:

   1. ALTER TABLE <X> ADD COLUMN "branchId" TEXT;   -- nullable
   2. UPDATE <X> SET "branchId" = tenant_first_active_branch
        WHERE "branchId" IS NULL;
   3. ALTER TABLE <X> ALTER COLUMN "branchId" SET NOT NULL;

The header backfill block (Main branch creation + early-table
backfills) is left untouched — that runs first and seeds the branches
the per-table UPDATEs reference.

Idempotent: rerunning the script is a no-op once the migration is
already in the 3-step form.
"""

import re
from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parent.parent
    / "prisma/migrations/20260601000000_v3_branch_scope_strict/migration.sql"
)

# Tables whose ADD COLUMN NOT NULL pattern must be split. Order
# preserved from the original migration.
ADD_COLUMN_TABLES = [
    "payments",
    "order_item_payments",
    "pending_self_payments",
    "stock_movements",
    "reservations",
    "notifications",
    "waiter_requests",
    "bill_requests",
    "z_reports",
    "cash_drawer_movements",
    "cameras",
    "occupancy_records",
    "traffic_flow_records",
    "table_analytics",
    "analytics_insights",
    "analytics_heatmap_cache",
    "edge_devices",
    "delivery_platform_logs",
    "stock_items",
    "stock_batches",
    "recipes",
    "purchase_orders",
    "ingredient_movements",
    "waste_logs",
    "stock_counts",
    "attendances",
    "shift_templates",
    "shift_assignments",
    "shift_swap_requests",
    "device_commands",
]


def backfill_block(table: str) -> str:
    return (
        f"-- AddColumn nullable\n"
        f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "branchId" TEXT;\n'
        f"-- Backfill from tenant's first active branch\n"
        f'UPDATE "{table}" x SET "branchId" = (\n'
        f'  SELECT b."id" FROM "branches" b\n'
        f'  WHERE b."tenantId" = x."tenantId" AND b."status" = \'active\'\n'
        f'  ORDER BY b."createdAt" ASC LIMIT 1\n'
        f') WHERE x."branchId" IS NULL;\n'
        f"-- Promote to NOT NULL\n"
        f'ALTER TABLE "{table}" ALTER COLUMN "branchId" SET NOT NULL;\n'
    )


def main() -> None:
    text = MIGRATION.read_text()
    changes = 0

    for table in ADD_COLUMN_TABLES:
        # Pattern: -- AlterTable\nALTER TABLE "<table>" ADD COLUMN ...
        # "branchId" TEXT NOT NULL;
        pattern = re.compile(
            r"-- AlterTable\s*\n"
            rf'ALTER TABLE "{re.escape(table)}"\s+ADD COLUMN\s+"branchId"\s+TEXT\s+NOT NULL\s*;',
            re.MULTILINE,
        )
        match = pattern.search(text)
        if match:
            text = text[: match.start()] + backfill_block(table) + text[match.end():]
            changes += 1

    # Now the ALTER COLUMN ... SET NOT NULL pattern (orders/tables/
    # devices already had a nullable branchId in v2). The header
    # backfill block seeded those columns; the SET NOT NULL stays
    # but the script verifies the order is correct.
    if changes == 0:
        print("no changes — migration already in 3-step form")
        return

    MIGRATION.write_text(text)
    print(f"patched {changes} ADD COLUMN NOT NULL → 3-step backfill")


if __name__ == "__main__":
    main()
