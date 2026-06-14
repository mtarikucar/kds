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

import { branchKeys, useListBranches, useCreateBranch } from './branchesApi';

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

describe('branchesApi', () => {
  it('exposes the canonical branch query key', () => {
    expect(branchKeys.all).toEqual(['branches']);
  });

  it('useListBranches GETs /v1/branches', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListBranches(), { wrapper });
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/v1/branches'));
  });

  it('useCreateBranch POSTs, invalidates and toasts success', async () => {
    h.post.mockResolvedValue({ data: { id: 'b1' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateBranch(), { wrapper });
    await result.current.mutateAsync({ name: 'New branch' });
    expect(h.post).toHaveBeenCalledWith('/v1/branches', { name: 'New branch' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: branchKeys.all });
    expect(h.toastSuccess).toHaveBeenCalledWith('Branch created.');
  });

  it('useCreateBranch surfaces a server error via toast', async () => {
    h.post.mockRejectedValue({ response: { data: { message: 'dup code' } } });
    const { result } = renderHook(() => useCreateBranch(), { wrapper });
    await result.current.mutateAsync({ name: 'x' }).catch(() => undefined);
    expect(h.toastError).toHaveBeenCalledWith('dup code');
  });
});
