import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }) },
}));

import { useBranchScopeStore } from '../../store/branchScopeStore';
import { useTables, useTable } from './tablesApi';

/**
 * Track-1B defense-in-depth: branch-scoped query keys must bake in the active
 * branchId so a branch-A cache entry can never satisfy a branch-B read. The
 * branch-switch cache wipe (useBranchChangeInvalidation) is the primary guard;
 * this is the documented belt-and-suspenders that keeps per-branch entries
 * distinct even if that single wipe ever regresses. tablesApi is the reference
 * file for the convention applied across the feature query hooks.
 */
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('tablesApi branch-scoped query keys', () => {
  beforeEach(() => {
    useBranchScopeStore.setState({ branchId: null });
    localStorage.clear();
  });

  it('useTables bakes the active branchId into its query key', async () => {
    useBranchScopeStore.setState({ branchId: 'b-1' });
    const client = new QueryClient();
    renderHook(() => useTables(), { wrapper: wrapper(client) });

    await waitFor(() =>
      expect(client.getQueryCache().getAll().length).toBeGreaterThan(0),
    );
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['tables', 'b-1']);
  });

  it('useTable appends branchId after the id (convention: branchId is last)', async () => {
    useBranchScopeStore.setState({ branchId: 'b-1' });
    const client = new QueryClient();
    renderHook(() => useTable('t-9'), { wrapper: wrapper(client) });

    await waitFor(() =>
      expect(client.getQueryCache().getAll().length).toBeGreaterThan(0),
    );
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual([
      'tables',
      't-9',
      'b-1',
    ]);
  });

  it('two branches produce distinct cache entries (no cross-branch collision)', async () => {
    const client = new QueryClient();
    useBranchScopeStore.setState({ branchId: 'b-1' });
    renderHook(() => useTables(), { wrapper: wrapper(client) });
    useBranchScopeStore.setState({ branchId: 'b-2' });
    renderHook(() => useTables(), { wrapper: wrapper(client) });

    await waitFor(() =>
      expect(client.getQueryCache().getAll().length).toBe(2),
    );
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ['tables', 'b-1'],
        ['tables', 'b-2'],
      ]),
    );
  });
});
