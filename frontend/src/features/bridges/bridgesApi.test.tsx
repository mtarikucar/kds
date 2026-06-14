import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../../lib/api', () => ({
  api: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import {
  bridgeKeys,
  useListBridges,
  useCreateBridge,
  useRetireBridge,
} from './bridgesApi';

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

describe('bridgesApi', () => {
  it('useListBridges passes a branchId filter as params', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListBridges('branch-A'), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/v1/bridges', {
        params: { branchId: 'branch-A' },
      }),
    );
  });

  it('useListBridges sends empty params when no branch given', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListBridges(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/v1/bridges', { params: {} }),
    );
  });

  it('useCreateBridge POSTs, invalidates and toasts the token warning', async () => {
    h.post.mockResolvedValue({ data: { id: 'b1', provisioningToken: 'tok' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateBridge(), { wrapper });
    await result.current.mutateAsync({ branchId: 'branch-A' });
    expect(h.post).toHaveBeenCalledWith('/v1/bridges', { branchId: 'branch-A' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: bridgeKeys.all });
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useCreateBridge surfaces server errors', async () => {
    h.post.mockRejectedValue({ response: { data: { message: 'no quota' } } });
    const { result } = renderHook(() => useCreateBridge(), { wrapper });
    await result.current.mutateAsync({ branchId: 'b' }).catch(() => undefined);
    expect(h.toastError).toHaveBeenCalledWith('no quota');
  });

  it('useRetireBridge DELETEs by id and invalidates', async () => {
    h.del.mockResolvedValue({ data: undefined });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRetireBridge(), { wrapper });
    await result.current.mutateAsync('b9');
    expect(h.del).toHaveBeenCalledWith('/v1/bridges/b9');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: bridgeKeys.all });
  });
});
