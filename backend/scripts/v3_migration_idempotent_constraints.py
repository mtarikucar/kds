#!/usr/bin/env python3
"""Wrap each `ALTER TABLE ... ADD CONSTRAINT ...;` line in the v3
strict-branch migration in a PL/pgSQL DO block so re-applying the
migration on a partially-migrated database is a no-op.

PostgreSQL's `ALTER TABLE ... ADD CONSTRAINT` has no IF NOT EXISTS
modifier, so the EXCEPTION block is the canonical idiom. Same shape
as the other idempotent constraint blocks already used by Prisma's
own generated migrations elsewhere in this codebase.
"""

import re
from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parent.parent
    / "prisma/migrations/20260601000000_v3_branch_scope_strict/migration.sql"
)

pattern = re.compile(
    r"^(ALTER TABLE [^\n]*ADD CONSTRAINT [^\n]*);[ \t]*$",
    re.MULTILINE,
)


def main() -> None:
    text = MIGRATION.read_text()
    count = 0

    def wrap(match: re.Match) -> str:
        nonlocal count
        stmt = match.group(1)
        count += 1
        return f"DO $$ BEGIN {stmt}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"

    new = pattern.sub(wrap, text)
    MIGRATION.write_text(new)
    print(f"wrapped {count} ADD CONSTRAINT statements")


if __name__ == "__main__":
    main()
