#!/usr/bin/env python3
"""
Convert legacy `where: { tenantId }` calls to the v3 compound
`where: { tenantId_branchId: { tenantId, branchId: null } }` form for
settings table accessors.

The replacement is safe ONLY for these settings models:
  PosSettings, QrMenuSettings, ReservationSettings, SmsSettings,
  IntegrationSettings, AccountingSettings, StockSettings.

It looks for the immediately-preceding Prisma delegate name on the
same line or one line above and only rewrites when that delegate is
one of the settings models above. Other models with a `where: { tenantId
}` shape (e.g. `tenant.findUnique({ where: { id: tenantId } })`)
are left alone because they don't have a compound key.
"""

import re
import sys
from pathlib import Path

SETTINGS_DELEGATES = {
    "posSettings",
    "qrMenuSettings",
    "reservationSettings",
    "smsSettings",
    "integrationSettings",
    "accountingSettings",
    "stockSettings",
}

# Match: `<delegate>.<method>({ ... where: { tenantId } ... })`
#
# We match in two passes:
#   1. Find the `<delegate>.<method>(` opener and remember its position.
#   2. Within the parenthesized block, replace
#      `where: { tenantId }` → `where: { tenantId_branchId: { tenantId, branchId: null } }`.
#
# Single-line variant (the common case in legacy services):
#   `tx.posSettings.findUnique({ where: { tenantId } })`

SINGLE_LINE_RE = re.compile(
    r"((?:\bawait\s+)?(?:this\.prisma|prisma|tx|db|client)\."
    r"(?P<delegate>" + "|".join(SETTINGS_DELEGATES) + r")"
    r"\.(?P<method>findUnique|update|upsert|delete)\(\{[^{}]*?\bwhere:\s*\{\s*tenantId\s*\}[^{}]*?\}\))",
    re.DOTALL,
)

# Multi-line block: a Prisma call where the where clause sits on its
# own indented line.
MULTI_LINE_RE = re.compile(
    r"(?P<prefix>(?:this\.prisma|prisma|tx|db|client)\."
    r"(?P<delegate>" + "|".join(SETTINGS_DELEGATES) + r")"
    r"\.(?P<method>findUnique|update|upsert|delete)\s*\(\s*\{)"
    r"(?P<body>(?:[^()]|\([^()]*\))*?)"
    r"(\bwhere:\s*\{\s*tenantId\s*\})",
    re.DOTALL,
)


def patch(text: str) -> tuple[str, int]:
    replacements = 0

    def sub_multi(m: re.Match) -> str:
        nonlocal replacements
        replacements += 1
        return (
            m.group("prefix")
            + m.group("body")
            + "where: { tenantId_branchId: { tenantId, branchId: null } }"
        )

    text = MULTI_LINE_RE.sub(sub_multi, text)
    return text, replacements


def main():
    if len(sys.argv) < 2:
        print(f"usage: {sys.argv[0]} <file> [<file>...]", file=sys.stderr)
        sys.exit(1)

    total = 0
    for path_str in sys.argv[1:]:
        path = Path(path_str)
        before = path.read_text()
        after, n = patch(before)
        if n == 0:
            continue
        path.write_text(after)
        print(f"{path}: {n} replacement(s)")
        total += n

    print(f"total: {total} replacement(s) across {len(sys.argv) - 1} file(s)")


if __name__ == "__main__":
    main()
