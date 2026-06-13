import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBranchChangeInvalidation } from './useBranchChangeInvalidation';
import { useBranchScopeStore } from '../store/branchScopeStore';

/**
 * Regression guard for the branch-switch cache wipe. If this effect ever stops
 * firing, an ADMIN/MANAGER who roams to another branch keeps seeing the prior
 * branch's cached orders/tables/etc for the 5-minute staleTime window — a
 * cross-branch data-exposure regression. This test fails if that wiring breaks.
 */
function renderWithClient() {
  const client = new QueryClient();
  const removeSpy = vi.spyOn(client, 'removeQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(() => useBranchChangeInvalidation(), { wrapper });
  return removeSpy;
}

describe('useBranchChangeInvalidation', () => {
  beforeEach(() => {
    useBranchScopeStore.getState().clear();
    localStorage.clear();
  });

  it('wipes the query cache when the active branch changes', () => {
    const removeSpy = renderWithClient();
    expect(removeSpy).not.toHaveBeenCalled();

    act(() => useBranchScopeStore.setState({ branchId: 'b-1' }));
    expect(removeSpy).toHaveBeenCalledTimes(1);

    act(() => useBranchScopeStore.setState({ branchId: 'b-2' }));
    expect(removeSpy).toHaveBeenCalledTimes(2);
  });

  it('does NOT wipe when an unrelated store field changes', () => {
    const removeSpy = renderWithClient();
    act(() => useBranchScopeStore.setState({ branchId: 'b-1' }));
    removeSpy.mockClear();

    // branchId stays the same; only the allow-list / pinned flags change.
    act(() => useBranchScopeStore.setState({ allowedBranchIds: ['b-1', 'b-2'], isPinned: false }));
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('stops listening after unmount (no leaked subscription)', () => {
    const client = new QueryClient();
    const removeSpy = vi.spyOn(client, 'removeQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { unmount } = renderHook(() => useBranchChangeInvalidation(), { wrapper });
    unmount();
    act(() => useBranchScopeStore.setState({ branchId: 'b-9' }));
    expect(removeSpy).not.toHaveBeenCalled();
  });
});
