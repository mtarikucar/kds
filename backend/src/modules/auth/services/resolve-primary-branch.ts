/**
 * Resolve a usable primary branch for a user.
 *
 * Owner / ADMIN (and MANAGER) accounts created before the v3.0.0 branch
 * system carry a null `primaryBranchId` and no branch assignments — the
 * `20260601000000_v3_branch_scope_strict` migration added the column but
 * (unlike every operational table's `branchId`) never backfilled existing
 * users, and the DB CHECK only forces a non-null `primaryBranchId` for the
 * hard-restricted roles (WAITER/KITCHEN/COURIER).
 *
 * With a null `primaryBranchId` AND an empty `allowedBranchIds`, the SPA's
 * `branchScopeStore.hydrateFromUser` resolves `branchId = null`, and the
 * api-client interceptor then hard-rejects EVERY branch-scoped request
 * client-side ("Branch scope not resolved"). The user sees generic "failed"
 * toasts on everything (login looks broken) and a blank KDS screen.
 *
 * So whenever `primaryBranchId` is null we resolve the tenant's home branch
 * — the oldest active branch, which registration always creates first as
 * "Main" — and surface THAT in the login / refresh / profile response. The
 * BranchGuard already grants owner ADMINs wildcard access, so any active
 * branch they're handed is acceptable; this just gives the SPA a concrete
 * `X-Branch-Id` to send.
 *
 * Returns the existing id untouched when it's already set (no DB hit), and
 * null only when the tenant genuinely has no active branch (a degenerate
 * state nothing client-side can repair).
 */
type BranchFinder = {
  branch: {
    findFirst: (args: {
      where: { tenantId: string; status: string };
      orderBy: { createdAt: "asc" };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

export async function resolvePrimaryBranchId(
  prisma: BranchFinder,
  tenantId: string,
  currentPrimaryBranchId: string | null | undefined,
): Promise<string | null> {
  if (currentPrimaryBranchId) return currentPrimaryBranchId;
  const fallback = await prisma.branch.findFirst({
    where: { tenantId, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return fallback?.id ?? null;
}
