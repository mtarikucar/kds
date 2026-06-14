import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBranchScopeStore } from '../store/branchScopeStore';

/**
 * v3.0.0 isolation guard — when the active branch changes, drop every cached
 * TanStack Query so the previous branch's data can't surface within the
 * staleTime window. (WebSocket rooms are switched separately by the
 * `switchBranch` emit in lib/socket.ts.)
 *
 * Mount once near the app root, under the QueryClientProvider. Extracted from
 * an inline App effect so the isolation boundary is unit-testable in isolation.
 */
export function useBranchChangeInvalidation(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    return useBranchScopeStore.subscribe((state, prev) => {
      if (state.branchId !== prev.branchId) {
        queryClient.removeQueries();
      }
    });
  }, [queryClient]);
}
