/**
 * v3.0.0 — `branchId` scope helpers shared across every service.
 *
 * The mantra:
 *   - Every tenant-scoped operational entity also lives under a
 *     branchId.
 *   - `branchId === null` on a row means "tenant default" for
 *     settings-style entities; for operational entities it means
 *     "legacy single-branch tenant pre-v3" and the service should
 *     either backfill or run in soft-mode.
 *   - `req.branchId` from BranchGuard is the source of truth at
 *     request time. Services receive it as a `string | null`
 *     second positional argument after `tenantId`.
 *
 * This file exports the helpers services use to build `where`
 * clauses without forgetting to mix in branchId.
 */

export type Scope = {
  tenantId: string;
  /** Hard-required for branch-scoped reads; nullable only in soft-
   *  mode (BRANCH_SCOPE_ENFORCED=false) and for settings reads. */
  branchId: string | null;
};

/**
 * Spread into a Prisma `where` clause to enforce branch scope.
 *
 *   await prisma.order.findMany({
 *     where: { ...branchScope(scope), status: 'PAID' },
 *   });
 *
 * If `branchId === null` (soft mode), only tenantId is filtered —
 * legacy behavior. If branchId is set, both filters apply.
 */
export function branchScope(scope: Scope): { tenantId: string; branchId?: string } {
  if (scope.branchId == null) return { tenantId: scope.tenantId };
  return { tenantId: scope.tenantId, branchId: scope.branchId };
}

/**
 * For settings-style entities where `branchId === null` rows are
 * the tenant default. Read order:
 *   1. Find a row with the active branchId — that's the override.
 *   2. If none, find a row with branchId=null — that's the tenant
 *      default.
 *   3. If still none, return null (caller may seed defaults).
 *
 * Generic over the Prisma model delegate to keep the helper a
 * one-liner at the call site:
 *
 *   const pos = await readWithBranchOverride(
 *     prisma.posSettings,
 *     scope,
 *     // selection extension
 *     { select: { enableCustomerSelfPay: true } },
 *   );
 */
export async function readWithBranchOverride<T>(
  delegate: {
    findFirst(args: { where: any; [k: string]: any }): Promise<T | null>;
  },
  scope: Scope,
  extra: { where?: any; [k: string]: any } = {},
): Promise<T | null> {
  // 1. Branch override row.
  if (scope.branchId) {
    const branchRow = await delegate.findFirst({
      ...extra,
      where: { tenantId: scope.tenantId, branchId: scope.branchId, ...(extra.where ?? {}) },
    });
    if (branchRow) return branchRow;
  }
  // 2. Tenant default row.
  return delegate.findFirst({
    ...extra,
    where: { tenantId: scope.tenantId, branchId: null, ...(extra.where ?? {}) },
  });
}
