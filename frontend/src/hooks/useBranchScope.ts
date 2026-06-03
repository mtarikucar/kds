import { useBranchScopeStore } from '../store/branchScopeStore';

/**
 * v3.0.0 — read-only React hook for components that need to know
 * the active branch. The store still owns the mutation surface
 * (`setBranchId`, `clear`, `hydrateFromUser`) so accidental writes
 * from a deep component tree are visible at the call site.
 */
export function useBranchScope(): {
  branchId: string | null;
  allowedBranchIds: string[];
  isPinned: boolean;
} {
  const branchId = useBranchScopeStore((s) => s.branchId);
  const allowedBranchIds = useBranchScopeStore((s) => s.allowedBranchIds);
  const isPinned = useBranchScopeStore((s) => s.isPinned);
  return { branchId, allowedBranchIds, isPinned };
}
