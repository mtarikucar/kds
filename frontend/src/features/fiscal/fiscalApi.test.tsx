import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../../lib/api', () => ({
  api: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string | null }) => unknown) =>
    sel({ branchId: 'branch-A' }),
}));

import {
  fiscalKeys,
  useListPendingReceipts,
  useRetryReceipt,
} from './fiscalApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  Object.values(h).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
});

describe('fiscalKeys', () => {
  it('appends the branch id to the pending key and exposes a branch-agnostic prefix', () => {
    expect(fiscalKeys.pending('branch-A')).toEqual([
      'fiscal',
      'pending',
      'branch-A',
    ]);
    expect(fiscalKeys.pendingPrefix).toEqual(['fiscal', 'pending']);
  });
});

describe('fiscalApi hooks', () => {
  it('useListPendingReceipts GETs the pending endpoint', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListPendingReceipts(), { wrapper });
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/v1/fiscal/pending'));
  });

  it('useRetryReceipt toasts success when the receipt is issued', async () => {
    h.post.mockResolvedValue({ data: { status: 'issued', fiscalNo: 'F-1' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRetryReceipt(), { wrapper });
    await result.current.mutateAsync('r1');
    expect(h.post).toHaveBeenCalledWith('/v1/fiscal/receipts/r1/retry');
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: fiscalKeys.pendingPrefix,
    });
    expect(h.toastSuccess).toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('useRetryReceipt toasts an error when the retry still fails', async () => {
    h.post.mockResolvedValue({
      data: { status: 'failed', lastError: 'device offline' },
    });
    const { result } = renderHook(() => useRetryReceipt(), { wrapper });
    await result.current.mutateAsync('r2');
    expect(h.toastError).toHaveBeenCalledWith(
      expect.stringContaining('device offline'),
    );
  });
});
