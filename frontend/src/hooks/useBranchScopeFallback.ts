import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { useBranchScopeStore } from '../store/branchScopeStore';
import { api } from '../lib/api';
import { branchKeys, type Branch } from '../features/branches/branchesApi';

/**
 * v3.1.x safety net — guarantee the SPA never hard-bricks when the active
 * branch can't be resolved from the login/profile response.
 *
 * `branchScopeStore.hydrateFromUser` resolves `branchId` from
 * `user.primaryBranchId` / `user.allowedBranchIds`. An owner ADMIN/MANAGER
 * predating the v3.0.0 branch system can carry a null `primaryBranchId` and
 * an empty allow-list, so `branchId` stays null — and then the api-client
 * interceptor rejects EVERY branch-scoped request, surfacing as generic
 * "failed" toasts on everything and a blank KDS screen.
 *
 * The backend now resolves a fallback home branch at login/refresh/profile,
 * which heals on the next mount. This closes the remaining gap for an
 * already-loaded session holding a stale persisted `branchId = null` (and for
 * any client running ahead of the backend deploy): fetch the tenant's
 * branches — `/v1/branches` is tenant-wide, so it flies without an
 * X-Branch-Id — and select the first active one.
 *
 * `setBranchId` enforces the allow-list (and no-ops for pinned users), so a
 * narrowed MANAGER can't be pushed onto a branch they aren't entitled to.
 * Pinned roles (WAITER/KITCHEN/COURIER) always carry a non-null
 * primaryBranchId, so they never reach the fetch.
 */
export function useBranchScopeFallback(): void {
  const accessToken = useAuthStore((s) => s.accessToken);
  const branchId = useBranchScopeStore((s) => s.branchId);
  const isPinned = useBranchScopeStore((s) => s.isPinned);

  const needsFallback = !!accessToken && !branchId && !isPinned;

  const { data: branches } = useQuery({
    queryKey: branchKeys.all,
    queryFn: async (): Promise<Branch[]> => {
      const r = await api.get('/v1/branches');
      return r.data;
    },
    enabled: needsFallback,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!needsFallback || !branches || branches.length === 0) return;
    const allowed = useBranchScopeStore.getState().allowedBranchIds;
    // Narrowed users (non-empty allow-list) may only land on a branch they're
    // entitled to; wildcard owners (empty allow-list) can take any branch.
    const pool =
      allowed.length > 0
        ? branches.filter((b) => allowed.includes(b.id))
        : branches;
    const pick = pool.find((b) => b.status === 'active') ?? pool[0];
    if (pick) {
      useBranchScopeStore.getState().setBranchId(pick.id);
    }
  }, [needsFallback, branches]);
}
