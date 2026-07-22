-- Rollback for fix_extra_branch_grant. Renames the key back to the
-- pre-migration `limit.branches`, preserving `feature.multiLocation`
-- and the original numeric value exactly (mirror of the up). Guarded to
-- the post-up signature (`grants ? 'limit.maxBranches'`) so it only
-- reverts the row this migration actually renamed — a row a fresh
-- install seeded directly with `limit.maxBranches` (via the corrected
-- seed-marketplace.ts, no migration involved) is indistinguishable from
-- one this migration touched, so reverting it re-introduces the exact
-- pre-fix defect. That is the intended, documented behavior of a
-- rollback: undo this migration's effect. Idempotent — a second run,
-- or a run against a row that never had `limit.maxBranches`, is a
-- no-op. Scoped to exactly `code = 'extra_branch'`.
UPDATE "marketplace_addons"
SET grants = jsonb_set(
  grants - 'limit.maxBranches',
  '{limit.branches}',
  grants -> 'limit.maxBranches'
)
WHERE code = 'extra_branch'
  AND grants ? 'limit.maxBranches';
