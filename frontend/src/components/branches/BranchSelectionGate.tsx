import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { useListBranches } from '../../features/branches/branchesApi';
import { useSubscription } from '../../contexts/SubscriptionContext';

/**
 * First-entry branch selection gate (2026-07-22).
 *
 * A device with no EXPLICIT prior branch selection (branchScopeStore.
 * branchChosen — auto-seeded primaryBranchId does not count, and legacy
 * persisted snapshots migrate as already-chosen) gets routed to the
 * full-screen /branch-select once, when the user can actually roam
 * between multiple active branches. Everyone else — pinned roles,
 * single-branch tenants, tenants without multiLocation, devices with a
 * cached choice — never sees it.
 *
 * Mounted in Layout inside ProfileCompletionGate → SubscriptionGate, so
 * account completion and the plan lock win first. /branch-select itself
 * renders outside Layout, so this cannot loop.
 */
const BranchSelectionGate = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const isPinned = useBranchScopeStore((s) => s.isPinned);
  const branchChosen = useBranchScopeStore((s) => s.branchChosen);
  const allowedBranchIds = useBranchScopeStore((s) => s.allowedBranchIds);
  const { hasFeature } = useSubscription();
  const { data: branches = [], isLoading } = useListBranches();

  if (isPinned || branchChosen) return <>{children}</>;
  if (!hasFeature('multiLocation')) return <>{children}</>;
  // Don't redirect before the list resolves — avoids a flash-redirect.
  if (isLoading) return <>{children}</>;

  const active = branches.filter((b) => b.status === 'active');
  const visible =
    allowedBranchIds.length > 0
      ? active.filter((b) => allowedBranchIds.includes(b.id))
      : active;

  if (visible.length <= 1) return <>{children}</>;

  // Preserve the full URL (query/hash carry tab + filter state on branch-scoped
  // pages) so the selection screen returns the user exactly where they were.
  const from = location.pathname + location.search + location.hash;
  return <Navigate to="/branch-select" state={{ from }} replace />;
};

export default BranchSelectionGate;
