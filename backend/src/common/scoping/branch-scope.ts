/**
 * v3.0.0 strict branch-scope primitives.
 *
 * Every branch-scoped service method takes a `BranchScope` as its
 * first positional argument. The shape is intentionally minimal: only
 * the four fields that matter for authorization decisions and
 * predicate building. Controllers receive it from `@CurrentScope()`
 * which extracts the value BranchGuard attached to `req.scope`.
 *
 * The companion helpers below are the SINGLE canonical way to build
 * Prisma `where` clauses and to read settings. Anywhere else in the
 * codebase manually spreading `{ tenantId, branchId }` is the place
 * the next audit will flag — use these instead.
 */

import { UserRole } from "../constants/roles.enum";

/**
 * The authorization context for every branch-scoped request.
 *
 * - `tenantId`: provided by TenantGuard, always present.
 * - `branchId`: resolved by BranchGuard (header → JWT activeBranchId →
 *   primaryBranchId), always present for branch-scoped routes.
 *   Routes that legitimately need to operate above the branch axis
 *   must use `@SkipBranchScope()` and receive `@CurrentUser()` instead.
 * - `userId`: the acting user. Audit-log writes always read this off
 *   the scope rather than the service signature.
 * - `role`: the acting user's role. Service-layer authorization
 *   refinements (e.g. "MANAGER cannot delete fiscal records") branch
 *   on this; BranchGuard already validated the role can target this
 *   branch.
 */
export interface BranchScope {
  tenantId: string;
  branchId: string;
  userId: string;
  role: UserRole | string;
}

/**
 * Spread into a Prisma `where` clause to enforce branch scope.
 *
 *   await prisma.order.findMany({
 *     where: { ...branchScope(scope), status: 'PAID' },
 *   });
 *
 * This is the only place where the (tenantId, branchId) compound
 * predicate is built. If a service skips this helper and writes the
 * fields directly, the next refactor that drops one of them silently
 * breaks isolation — the lint rule
 * `service-uses-branchScope-helper` catches that.
 */
export function branchScope(scope: BranchScope): {
  tenantId: string;
  branchId: string;
} {
  return { tenantId: scope.tenantId, branchId: scope.branchId };
}

/**
 * Read a settings row using the override pattern.
 *
 *   1. Look for a row keyed (tenantId, branchId) — the per-branch
 *      override.
 *   2. Fall back to the tenant-default row (tenantId, null).
 *   3. If neither exists, return null and let the caller seed.
 *
 *   const pos = await loadBranchSettings(prisma.posSettings, scope);
 *
 * v3.0.1 — findFirst instead of findUnique. Prisma rejects
 * `findUnique({ tenantId_branchId: { branchId: null } })` at runtime
 * because the generated client treats compound-unique NULL fields as
 * a hard "must not be null" boundary, regardless of the underlying
 * @@unique declaration. findFirst applies the same predicate via a
 * standard WHERE evaluation, which Postgres handles correctly via the
 * compound index. Cost is identical to findUnique (same index scan)
 * but Prisma client validation no longer trips.
 *
 * The delegate type is the minimal slice of a Prisma model delegate
 * we need; this avoids dragging in the generated Prisma types just
 * to type a helper.
 */
export async function loadBranchSettings<T>(
  delegate: {
    findFirst(args: { where: any; [k: string]: any }): Promise<T | null>;
  },
  scope: BranchScope,
  extra: { select?: any; include?: any } = {},
): Promise<T | null> {
  const overrideRow = await delegate.findFirst({
    ...extra,
    where: {
      tenantId: scope.tenantId,
      branchId: scope.branchId,
    },
  });
  if (overrideRow) return overrideRow;
  return delegate.findFirst({
    ...extra,
    where: {
      tenantId: scope.tenantId,
      branchId: null,
    },
  });
}
