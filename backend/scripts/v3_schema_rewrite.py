#!/usr/bin/env python3
"""
v3.0.0 strict multi-branch schema rewrite.

Surgical pass on schema.prisma that:
  1. Adds `branchId String` (NOT NULL) + `branch Branch @relation(...)` +
     compound `@@index([tenantId, branchId])` to every operational model in
     OPERATIONAL_MODELS that doesn't already have one.
  2. Promotes Order/Table/Device branchId from nullable+SetNull to NOT
     NULL+Restrict (audit invariant: branch archive forces explicit
     re-attribution before delete).
  3. Adds Table compound unique `@@unique([id, branchId])` so
     Reservation/Order can carry compound FK back referencing the same
     (id, branchId) pair.
  4. Settings tables (7): adds `branchId String?` + compound
     `@@unique([tenantId, branchId])` replacing legacy `tenantId @unique`.
  5. User: adds `primaryBranchId String?` + `primaryBranch Branch?`
     relation + role-conditional CHECK constraint hint comment.
  6. Inserts a brand-new `UserBranchAssignment` model.
  7. Expands Branch with inverse list relations for every new branchId.
  8. Expands Tenant with inverse for UserBranchAssignment.

Strict v3.0.0 — no soft-mode shims. Run from backend/ as:
    python3 scripts/v3_schema_rewrite.py
The original file is rewritten in place; verify with
`npx prisma validate` and `git diff prisma/schema.prisma`.
"""

import re
import sys
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "prisma" / "schema.prisma"

# Operational models that must carry branchId NOT NULL + FK Restrict.
# Order/Table/Device handled separately (they already carry a nullable
# branchId from prior migrations and need promotion to NOT NULL).
OPERATIONAL_NEW_BRANCHID = [
    "DeviceCommand",
    "Payment",
    "OrderItemPayment",
    "PendingSelfPayment",
    "WaiterRequest",
    "BillRequest",
    "StockItem",
    "StockBatch",
    "IngredientMovement",
    "WasteLog",
    "StockMovement",
    "StockCount",
    "PurchaseOrder",
    "Recipe",
    "Reservation",
    "ZReport",
    "CashDrawerMovement",
    "Attendance",
    "ShiftTemplate",
    "ShiftAssignment",
    "ShiftSwapRequest",
    "Camera",
    "OccupancyRecord",
    "TrafficFlowRecord",
    "TableAnalytics",
    "AnalyticsInsight",
    "AnalyticsHeatmapCache",
    "EdgeDevice",
    "Notification",
    "DeliveryPlatformLog",
]

# Settings models: nullable branchId (override pattern) + compound unique.
SETTINGS_MODELS = [
    "PosSettings",
    "QrMenuSettings",
    "ReservationSettings",
    "SmsSettings",
    "AccountingSettings",
    "StockSettings",
    # IntegrationSettings handled separately — 4-tuple unique.
]

# Inverse relations to insert into Branch (list form).
BRANCH_INVERSES = [
    ("deviceCommands", "DeviceCommand"),
    ("payments", "Payment"),
    ("orderItemPayments", "OrderItemPayment"),
    ("pendingSelfPayments", "PendingSelfPayment"),
    ("waiterRequests", "WaiterRequest"),
    ("billRequests", "BillRequest"),
    ("stockItems", "StockItem"),
    ("stockBatches", "StockBatch"),
    ("ingredientMovements", "IngredientMovement"),
    ("wasteLogs", "WasteLog"),
    ("stockMovements", "StockMovement"),
    ("stockCounts", "StockCount"),
    ("purchaseOrders", "PurchaseOrder"),
    ("recipes", "Recipe"),
    ("reservations", "Reservation"),
    ("zReports", "ZReport"),
    ("cashDrawerMovements", "CashDrawerMovement"),
    ("attendances", "Attendance"),
    ("shiftTemplates", "ShiftTemplate"),
    ("shiftAssignments", "ShiftAssignment"),
    ("shiftSwapRequests", "ShiftSwapRequest"),
    ("cameras", "Camera"),
    ("occupancyRecords", "OccupancyRecord"),
    ("trafficFlowRecords", "TrafficFlowRecord"),
    ("tableAnalytics", "TableAnalytics"),
    ("analyticsInsights", "AnalyticsInsight"),
    ("analyticsHeatmapCache", "AnalyticsHeatmapCache"),
    ("edgeDevices", "EdgeDevice"),
    ("notifications", "Notification"),
    ("deliveryPlatformLogs", "DeliveryPlatformLog"),
    ("posSettings", "PosSettings"),
    ("qrMenuSettings", "QrMenuSettings"),
    ("reservationSettings", "ReservationSettings"),
    ("smsSettings", "SmsSettings"),
    ("accountingSettings", "AccountingSettings"),
    ("stockSettings", "StockSettings"),
    ("integrationSettings", "IntegrationSettings"),
    # `primaryUsers` carries the explicit relation name on the User side
    # because User has two FKs to Branch via different fields (only one
    # today, but Prisma still requires the name to match the User-side
    # @relation("UserPrimaryBranch") annotation).
    ("primaryUsers", "User", "UserPrimaryBranch"),
    ("userAssignments", "UserBranchAssignment", None),
]


def split_models(text: str):
    """Yield (name, start_offset, end_offset) for each top-level model.

    Counts braces to find the matching close, so nested types in fields
    (none in Prisma, but defensive) don't trip us.
    """
    pattern = re.compile(r"^model\s+(\w+)\s+\{", re.MULTILINE)
    for match in pattern.finditer(text):
        name = match.group(1)
        start = match.start()
        depth = 0
        i = match.end() - 1  # the opening brace
        while i < len(text):
            ch = text[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    yield name, start, i + 1
                    break
            i += 1


def find_model(text: str, name: str):
    for n, s, e in split_models(text):
        if n == name:
            return s, e
    raise ValueError(f"model {name} not found")


def model_body(text: str, name: str) -> str:
    s, e = find_model(text, name)
    return text[s:e]


def replace_model(text: str, name: str, new_body: str) -> str:
    s, e = find_model(text, name)
    return text[:s] + new_body + text[e:]


# ---------------------------------------------------------------------------
# Per-pattern transformers.
# ---------------------------------------------------------------------------

def insert_branchid_block(body: str, *, nullable: bool, on_delete: str) -> str:
    """Insert a v3.0.0 branchId block right before the model's closing
    `@@map(...)` line. If the model already has a branchId field, this
    function is a no-op (caller decides when to call).
    """
    if re.search(r"^\s*branchId\s+String", body, re.MULTILINE):
        return body
    suffix = "?" if nullable else ""
    rel_suffix = "?" if nullable else ""
    block = (
        f"\n  // v3.0.0 — branch scope.\n"
        f"  branchId String{suffix}\n"
        f"  branch   Branch{rel_suffix} @relation(fields: [branchId], references: [id], onDelete: {on_delete})\n"
    )
    # Insert immediately before the @@map line.
    return re.sub(
        r"(\n\s*@@map\()",
        lambda m: block + "\n" + ensure_branch_index(body) + m.group(1),
        body,
        count=1,
    )


def ensure_branch_index(body: str) -> str:
    # Helper: caller already injected the block; we want the index line
    # too. But since insert_branchid_block prepends, we return just the
    # index snippet — the regex above already merged it.
    return "  @@index([tenantId, branchId])"


def add_branchid(body: str, *, nullable: bool, on_delete: str) -> str:
    """Add branchId + relation + compound index before @@map."""
    if re.search(r"^\s*branchId\s+String", body, re.MULTILINE):
        # Already has one — caller is expected to promote separately.
        return body
    suffix = "?" if nullable else ""
    rel_q = "?" if nullable else ""
    insertion = (
        "  // v3.0.0 — branch scope.\n"
        f"  branchId String{suffix}\n"
        f"  branch   Branch{rel_q} @relation(fields: [branchId], references: [id], onDelete: {on_delete})\n"
        "\n"
        "  @@index([tenantId, branchId])\n"
    )
    # Insert just before @@map(... line. Two newlines around.
    new_body, n = re.subn(
        r"(\n)(\s*@@map\()",
        r"\n" + insertion + r"\1\2",
        body,
        count=1,
    )
    if n == 0:
        raise ValueError("no @@map(...) anchor in model body")
    return new_body


def promote_existing_branchid(body: str, *, on_delete: str) -> str:
    """For Order/Table/Device which currently carry `branchId String?` +
    `SetNull`. Promote to NOT NULL + given on_delete.
    """
    body = re.sub(
        r"(branchId\s+String)\?",
        r"\1",
        body,
        count=1,
    )
    body = re.sub(
        r"(branch\s+Branch)\?(\s+@relation\(fields:\s*\[branchId\],\s*references:\s*\[id\],\s*onDelete:\s*)SetNull",
        r"\1\2" + on_delete,
        body,
        count=1,
    )
    return body


def settings_unique_swap(body: str) -> str:
    """Settings tables: remove legacy `tenantId String @unique` qualifier
    and ensure a compound `@@unique([tenantId, branchId])` line exists.
    Strips the redundant `@@index([tenantId, branchId])` line that
    `add_branchid` emits — the unique constraint already serves as its
    own index, and Prisma rejects duplicate (tenantId, branchId) entries
    on the same model.
    """
    body = re.sub(r"(tenantId\s+String)\s+@unique\b", r"\1", body)
    # Drop the @@index that add_branchid inserted; @@unique replaces it.
    body = re.sub(
        r"\n\s*@@index\(\[tenantId, branchId\]\)\n",
        "\n",
        body,
        count=1,
    )
    if "@@unique([tenantId, branchId])" not in body:
        body = re.sub(
            r"(\n\s*@@map\()",
            "\n  @@unique([tenantId, branchId])\\1",
            body,
            count=1,
        )
    return body


def integration_settings_swap(body: str) -> str:
    """IntegrationSettings keeps its 3-tuple business unique but now
    gains branchId as the 4th column."""
    body = re.sub(
        r"@@unique\(\[tenantId,\s*integrationType,\s*provider\]\)",
        "@@unique([tenantId, branchId, integrationType, provider])",
        body,
    )
    return body


# ---------------------------------------------------------------------------
# Branch inverse relations.
# ---------------------------------------------------------------------------

def insert_branch_inverses(branch_body: str) -> str:
    # Build inverse lines. Each line is `  <fieldName> <Model>[]`, with
    # an optional `@relation("<name>")` suffix when the User side uses a
    # named relation (e.g. UserPrimaryBranch).
    lines = []
    for entry in BRANCH_INVERSES:
        if len(entry) == 3:
            field, model, rel = entry
        else:
            field, model = entry
            rel = None
        suffix = f' @relation("{rel}")' if rel else ""
        lines.append(f"  {field} {model}[]{suffix}")
    block = (
        "\n  // v3.0.0 — strict branch-scope inverse relations.\n"
        + "\n".join(lines)
        + "\n"
    )

    # Insert before @@unique([tenantId, code]) (which precedes @@index/@@map).
    new_body, n = re.subn(
        r"(\n\s*@@unique\(\[tenantId, code\]\))",
        block + r"\1",
        branch_body,
        count=1,
    )
    if n == 0:
        raise ValueError("Branch @@unique anchor not found")
    return new_body


# ---------------------------------------------------------------------------
# User model: add primaryBranchId + branchAssignments inverse.
# ---------------------------------------------------------------------------

def edit_user(user_body: str) -> str:
    # Add primaryBranchId field after tokenVersion field block.
    if "primaryBranchId" not in user_body:
        insertion = (
            "\n  // v3.0.0 — home branch. CHECK constraint at the DB layer\n"
            "  // enforces that WAITER/KITCHEN/COURIER cannot exist with a\n"
            "  // null primaryBranchId; nullable in the column itself so\n"
            "  // ADMIN owner accounts that legitimately roam may stay\n"
            "  // unanchored. Restrict on delete: archiving a branch must\n"
            "  // not orphan a user — ops reassigns first.\n"
            "  primaryBranchId String?\n"
            "  primaryBranch   Branch? @relation(\"UserPrimaryBranch\", fields: [primaryBranchId], references: [id], onDelete: Restrict)\n"
            "\n"
        )
        user_body = re.sub(
            r"(\n\s*tenantId\s+String\n\s*tenant\s+Tenant\s+@relation[^\n]*\n)",
            r"\1" + insertion,
            user_body,
            count=1,
        )

    # Add the inverse relation for UserBranchAssignment near the end.
    if "branchAssignments" not in user_body:
        insertion = (
            "\n  // v3.0.0 — m:n allow-list of branches the user may roam.\n"
            "  // BranchGuard consults this on every request for\n"
            "  // ADMIN/MANAGER roles.\n"
            "  branchAssignments        UserBranchAssignment[]\n"
            "  grantedBranchAssignments UserBranchAssignment[] @relation(\"UserBranchAssignmentGrantor\")\n"
        )
        user_body = re.sub(
            r"(\n\s*@@index\(\[tenantId\]\))",
            insertion + r"\1",
            user_body,
            count=1,
        )

    # Add compound index for branch lookups.
    if "@@index([tenantId, primaryBranchId])" not in user_body:
        user_body = re.sub(
            r"(\n\s*@@index\(\[tenantId\]\))",
            r"\1\n  @@index([tenantId, primaryBranchId])",
            user_body,
            count=1,
        )

    return user_body


USER_BRANCH_ASSIGNMENT_MODEL = """\

// v3.0.0 — m:n user↔branch allow-list.
//
// BranchGuard reads this table on every authenticated request to decide
// whether an ADMIN/MANAGER may target the resolved branchId. Encodes:
//   - ADMIN with zero rows = wildcard tenant access (owner accounts).
//   - MANAGER must have an explicit row for every branch they roam.
//   - WAITER/KITCHEN/COURIER never have rows here — they are pinned
//     to primaryBranchId by both the CHECK constraint and BranchGuard.
//
// Cascade-delete with either side: removing a branch or a user purges
// the assignment automatically. assignedById uses SetNull so the audit
// trail of past grants survives the grantor's account removal.
model UserBranchAssignment {
  id String @id @default(uuid())

  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  branchId String
  branch   Branch @relation(fields: [branchId], references: [id], onDelete: Cascade)

  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  assignedById String?
  assignedBy   User?   @relation("UserBranchAssignmentGrantor", fields: [assignedById], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())

  @@unique([userId, branchId])
  @@index([tenantId, branchId])
  @@map("user_branch_assignments")
}
"""


def insert_user_branch_assignment_model(text: str) -> str:
    if "model UserBranchAssignment {" in text:
        return text
    # Insert right after the User model's closing brace.
    s, e = find_model(text, "User")
    return text[:e] + "\n" + USER_BRANCH_ASSIGNMENT_MODEL + text[e:]


def insert_tenant_inverse(tenant_body: str) -> str:
    if "userBranchAssignments" in tenant_body:
        return tenant_body
    insertion = (
        "\n  // v3.0.0 — m:n user↔branch allow-list (BranchGuard reads it).\n"
        "  userBranchAssignments UserBranchAssignment[]\n"
    )
    return re.sub(
        r"(\n\s*@@index\(\[currentPlanId\]\))",
        insertion + r"\1",
        tenant_body,
        count=1,
    )


# Table needs a compound (id, branchId) unique so Reservation/Order can
# build a compound FK back to it. Prisma exposes this via @@unique.
def add_table_compound_unique(body: str) -> str:
    if "@@unique([id, branchId])" in body:
        return body
    return re.sub(
        r"(\n\s*@@map\(\"tables\"\))",
        "\n  // v3.0.0 — compound unique enables (tableId, branchId) FK\n"
        "  // back-references from Reservation/Order so a row can never\n"
        "  // point at a table from a different branch at the DB layer.\n"
        "  @@unique([id, branchId])\\1",
        body,
        count=1,
    )


# ---------------------------------------------------------------------------
# Settings inverse relations on Tenant: convert each 1:1 to 1:n.
# ---------------------------------------------------------------------------

def settings_relations_to_list(tenant_body: str) -> str:
    pairs = [
        ("qrMenuSettings", "QrMenuSettings"),
        ("posSettings", "PosSettings"),
        ("reservationSettings", "ReservationSettings"),
        ("smsSettings", "SmsSettings"),
        ("accountingSettings", "AccountingSettings"),
        ("stockSettings", "StockSettings"),
    ]
    for field, model in pairs:
        # Match `<field>  <Model>?` (with optional whitespace) and replace
        # with `<field>  <Model>[]`.
        tenant_body = re.sub(
            rf"^(\s*{re.escape(field)}\s+){re.escape(model)}\?",
            rf"\g<1>{model}[]",
            tenant_body,
            count=1,
            flags=re.MULTILINE,
        )
    return tenant_body


# ---------------------------------------------------------------------------
# Pipeline.
# ---------------------------------------------------------------------------

def main():
    text = SCHEMA.read_text()

    # Pass 1: operational models that need a fresh NOT NULL branchId.
    for name in OPERATIONAL_NEW_BRANCHID:
        body = model_body(text, name)
        new_body = add_branchid(body, nullable=False, on_delete="Restrict")
        text = replace_model(text, name, new_body)

    # Pass 2: promote existing nullable branchId on Order/Table/Device.
    for name in ["Order", "Table", "Device"]:
        body = model_body(text, name)
        new_body = promote_existing_branchid(body, on_delete="Restrict")
        text = replace_model(text, name, new_body)

    # Table compound unique.
    body = model_body(text, "Table")
    text = replace_model(text, "Table", add_table_compound_unique(body))

    # Pass 3: settings tables.
    for name in SETTINGS_MODELS:
        body = model_body(text, name)
        new_body = add_branchid(body, nullable=True, on_delete="Restrict")
        new_body = settings_unique_swap(new_body)
        text = replace_model(text, name, new_body)

    # IntegrationSettings: nullable branchId + 4-tuple unique.
    body = model_body(text, "IntegrationSettings")
    new_body = add_branchid(body, nullable=True, on_delete="Restrict")
    new_body = integration_settings_swap(new_body)
    text = replace_model(text, "IntegrationSettings", new_body)

    # Pass 4: User model.
    body = model_body(text, "User")
    text = replace_model(text, "User", edit_user(body))

    # Pass 5: insert UserBranchAssignment model.
    text = insert_user_branch_assignment_model(text)

    # Pass 6: Branch inverse relations.
    body = model_body(text, "Branch")
    text = replace_model(text, "Branch", insert_branch_inverses(body))

    # Pass 7: Tenant inverse (UserBranchAssignment + settings 1:n).
    body = model_body(text, "Tenant")
    body = insert_tenant_inverse(body)
    body = settings_relations_to_list(body)
    text = replace_model(text, "Tenant", body)

    SCHEMA.write_text(text)
    print(f"Wrote {SCHEMA}")


if __name__ == "__main__":
    main()
