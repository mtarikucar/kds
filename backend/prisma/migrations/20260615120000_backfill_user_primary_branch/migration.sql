-- Backfill users.primaryBranchId for accounts that predate the v3.0.0 branch
-- system.
--
-- The 20260601000000_v3_branch_scope_strict migration ADDED the
-- users.primaryBranchId column but — unlike every operational table's
-- branchId — never backfilled existing rows, and the CHECK constraint only
-- forces a non-null primaryBranchId for the hard-restricted roles
-- (WAITER/KITCHEN/COURIER). So a pre-migration owner ADMIN/MANAGER ends up
-- with primaryBranchId = NULL and no UserBranchAssignment rows.
--
-- Impact (the bug this repairs): with primaryBranchId NULL and
-- allowedBranchIds [], the SPA's branchScopeStore.hydrateFromUser resolves
-- branchId = null, and the api-client interceptor then rejects EVERY
-- branch-scoped request client-side ("Branch scope not resolved"). The user
-- sees generic "failed" toasts on everything (login appears broken) and a
-- blank KDS screen, despite being on a high plan.
--
-- Fix: anchor each still-null user to their tenant's home branch — the
-- oldest active branch, which registration always creates first as "Main".
-- token.service + getProfile also resolve this fallback at request time
-- (belt-and-suspenders for any row this misses or any later regression);
-- this migration makes the repair permanent in one pass.
--
-- Idempotent: only touches rows where primaryBranchId IS NULL, and only sets
-- it to an existing active branch of the SAME tenant (FK- and
-- CHECK-constraint safe). Re-running is a no-op.
UPDATE "users" AS u
SET "primaryBranchId" = sub.branch_id
FROM (
  SELECT DISTINCT ON (b."tenantId")
    b."tenantId" AS tenant_id,
    b."id"       AS branch_id
  FROM "branches" b
  WHERE b."status" = 'active'
  ORDER BY b."tenantId", b."createdAt" ASC
) AS sub
WHERE u."primaryBranchId" IS NULL
  AND u."tenantId" = sub.tenant_id;
