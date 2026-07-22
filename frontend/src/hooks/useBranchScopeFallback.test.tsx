import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBranchScopeFallback } from './useBranchScopeFallback';
import { useBranchScopeStore } from '../store/branchScopeStore';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
}));

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const BRANCHES = [
  { id: 'b-archived', tenantId: 't1', name: 'Old', code: null, timezone: 'UTC', address: null, status: 'archived', createdAt: '2024-01-01' },
  { id: 'b-active', tenantId: 't1', name: 'Main', code: null, timezone: 'UTC', address: null, status: 'active', createdAt: '2024-02-01' },
  { id: 'b-active-2', tenantId: 't1', name: 'Second', code: null, timezone: 'UTC', address: null, status: 'active', createdAt: '2024-03-01' },
];

describe('useBranchScopeFallback', () => {
  beforeEach(() => {
    useBranchScopeStore.getState().clear();
    useAuthStore.setState({ accessToken: null, user: null } as any);
    localStorage.clear();
    mockedGet.mockReset();
  });

  it('auto-selects the first active branch when authenticated with an unresolved branchId', async () => {
    mockedGet.mockResolvedValue({ data: BRANCHES });
    useAuthStore.setState({ accessToken: 'tok' } as any);
    // ADMIN owner: not pinned, no prior branch, wildcard allow-list.
    useBranchScopeStore.setState({
      branchId: null,
      isPinned: false,
      allowedBranchIds: [],
      isWildcard: true,
    });

    renderHook(() => useBranchScopeFallback(), { wrapper });

    await waitFor(() =>
      expect(useBranchScopeStore.getState().branchId).toBe('b-active'),
    );
    expect(mockedGet).toHaveBeenCalledWith('/v1/branches');
  });

  it('does nothing when branchId is already resolved', async () => {
    mockedGet.mockResolvedValue({ data: BRANCHES });
    useAuthStore.setState({ accessToken: 'tok' } as any);
    useBranchScopeStore.setState({ branchId: 'b-active-2', isPinned: false, allowedBranchIds: [] });

    renderHook(() => useBranchScopeFallback(), { wrapper });

    // give any effect a tick; branchId must not be overwritten
    await new Promise((r) => setTimeout(r, 20));
    expect(useBranchScopeStore.getState().branchId).toBe('b-active-2');
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('does nothing when not authenticated', async () => {
    mockedGet.mockResolvedValue({ data: BRANCHES });
    useBranchScopeStore.setState({ branchId: null, isPinned: false, allowedBranchIds: [] });

    renderHook(() => useBranchScopeFallback(), { wrapper });

    await new Promise((r) => setTimeout(r, 20));
    expect(useBranchScopeStore.getState().branchId).toBeNull();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('respects a non-empty allow-list (picks an allowed branch, not just the first active)', async () => {
    mockedGet.mockResolvedValue({ data: BRANCHES });
    useAuthStore.setState({ accessToken: 'tok' } as any);
    // MANAGER-style: allowed only to the second active branch.
    useBranchScopeStore.setState({ branchId: null, isPinned: false, allowedBranchIds: ['b-active-2'] });

    renderHook(() => useBranchScopeFallback(), { wrapper });

    await waitFor(() =>
      expect(useBranchScopeStore.getState().branchId).toBe('b-active-2'),
    );
  });

  // Backend BranchGuard's wildcard rule is ADMIN-only. A non-wildcard user
  // (e.g. MANAGER) with an empty allow-list is a data bug, not intentional
  // all-access — the candidate pool must stay empty, not silently default
  // to "any branch" (which setBranchId would then refuse anyway, leaving
  // branchId stuck null with no diagnostic).
  it('picks nothing for a non-wildcard user with an empty allow-list (data bug)', async () => {
    mockedGet.mockResolvedValue({ data: BRANCHES });
    useAuthStore.setState({ accessToken: 'tok' } as any);
    useBranchScopeStore.setState({
      branchId: null,
      isPinned: false,
      allowedBranchIds: [],
      isWildcard: false,
    });

    renderHook(() => useBranchScopeFallback(), { wrapper });

    await new Promise((r) => setTimeout(r, 20));
    expect(useBranchScopeStore.getState().branchId).toBeNull();
  });

  it('does not fetch for a pinned (WAITER/KITCHEN/COURIER) user', async () => {
    mockedGet.mockResolvedValue({ data: BRANCHES });
    useAuthStore.setState({ accessToken: 'tok' } as any);
    useBranchScopeStore.setState({ branchId: null, isPinned: true, allowedBranchIds: [] });

    renderHook(() => useBranchScopeFallback(), { wrapper });

    await new Promise((r) => setTimeout(r, 20));
    expect(mockedGet).not.toHaveBeenCalled();
    expect(useBranchScopeStore.getState().branchId).toBeNull();
  });
});
