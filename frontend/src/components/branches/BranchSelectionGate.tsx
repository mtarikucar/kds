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
 *
 * Recovery paths (plan selection, checkout, profile, legal, help, welcome
 * onboarding, and /branch-select itself) stay reachable — otherwise a
 * locked-but-still-multiLocation user (e.g. TRIAL_ENDED) that SubscriptionGate
 * already routed to /subscription/plans would get bounced again here, before
 * they can pay.
 */
const RECOVERY_PREFIXES = [
  '/subscription',
  '/admin/plan',
  '/profile',
  '/legal',
  '/help',
  '/welcome',
  '/branch-select',
];

const BranchSelectionGate = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const isPinned = useBranchScopeStore((s) => s.isPinned);
  const branchChosen = useBranchScopeStore((s) => s.branchChosen);
  const allowedBranchIds = useBranchScopeStore((s) => s.allowedBranchIds);
  const isWildcard = useBranchScopeStore((s) => s.isWildcard);
  const { hasFeature } = useSubscription();
  const { data: branches = [], isLoading } = useListBranches();

  if (isPinned || branchChosen) return <>{children}</>;
  if (!hasFeature('multiLocation')) return <>{children}</>;
  // Don't redirect before the list resolves — avoids a flash-redirect.
  if (isLoading) return <>{children}</>;

  const onRecoveryPath = RECOVERY_PREFIXES.some(
    (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
  );
  if (onRecoveryPath) return <>{children}</>;

  const active = branches.filter((b) => b.status === 'active');
  // Mirrors backend BranchGuard: wildcard (ADMIN + empty allow-list) can
  // roam every active branch; everyone else — including a non-ADMIN
  // with an empty allow-list (a data bug, not intentional all-access) —
  // is restricted to their explicit list.
  const visible = isWildcard
    ? active
    : active.filter((b) => allowedBranchIds.includes(b.id));

  if (visible.length <= 1) return <>{children}</>;

  // Preserve the full URL (query/hash carry tab + filter state on branch-scoped
  // pages) so the selection screen returns the user exactly where they were.
  const from = location.pathname + location.search + location.hash;
  return <Navigate to="/branch-select" state={{ from }} replace />;
};

export default BranchSelectionGate;
