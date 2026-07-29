import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import type { Category } from '../../types';

/**
 * Specs for menuApi's reorder mutations — the only hooks here with real
 * logic beyond pass-through CRUD. Both hooks now issue a SINGLE atomic
 * batch PATCH (/menu/{categories,products}/reorder with { orderedIds })
 * instead of the old non-atomic per-row fan-out. useReorderCategories does
 * an optimistic cache rewrite in onMutate (remap each category's
 * displayOrder to its index in the new id order, leaving unknown ids
 * untouched) and rolls the snapshot back on error; useReorderProducts
 * invalidates on success AND on error. We deep-mock the axios-ish `api`
 * and the toast, and assert the exact PATCH payload + cache transitions.
 */

const patchMock = vi.fn();
vi.mock('../../lib/api', () => ({
  default: { patch: (...args: unknown[]) => patchMock(...args) },
}));

const toastErrorMock = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastErrorMock(...a) } }));

vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));

import { useBranchScopeStore } from '../../store/branchScopeStore';
import { useReorderCategories, useReorderProducts } from './menuApi';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function cat(id: string, displayOrder: number): Category {
  return {
    id,
    name: id,
    displayOrder,
    tenantId: 't1',
  } as Category;
}

beforeEach(() => {
  vi.clearAllMocks();
  useBranchScopeStore.setState({ branchId: 'b-1' });
});

describe('useReorderCategories — mutationFn payloads', () => {
  it('sends ONE atomic batch PATCH with the full ordered id list', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = new QueryClient();
    const { result } = renderHook(() => useReorderCategories(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync(['c3', 'c1', 'c2']);
    });

    // Single batch call — NOT a per-category fan-out (that shape was
    // non-atomic: a partial failure left a half-applied order server-side).
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith('/menu/categories/reorder', {
      orderedIds: ['c3', 'c1', 'c2'],
    });
  });
});

describe('useReorderCategories — optimistic cache rewrite', () => {
  it('remaps displayOrder by new index in the branch-keyed cache, leaving unknown ids untouched', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = new QueryClient();
    const key = ['categories', 'b-1'];
    // Seed the exact branch-keyed list useCategories() would populate.
    client.setQueryData(key, [cat('c1', 0), cat('c2', 1), cat('c3', 2), cat('cX', 3)]);

    const { result } = renderHook(() => useReorderCategories(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      // Reorder a SUBSET — cX is not in the ordered list and must keep its order.
      await result.current.mutateAsync(['c3', 'c1', 'c2']);
    });

    const after = client.getQueryData<Category[]>(key)!;
    const byId = Object.fromEntries(after.map((c) => [c.id, c.displayOrder]));
    expect(byId).toEqual({ c3: 0, c1: 1, c2: 2, cX: 3 });
  });

  it('writes the optimistic order to the SAME branch the read registered (no cross-branch leak)', async () => {
    patchMock.mockResolvedValue({ data: {} });
    useBranchScopeStore.setState({ branchId: 'b-2' });
    const client = new QueryClient();
    client.setQueryData(['categories', 'b-2'], [cat('c1', 0), cat('c2', 1)]);
    client.setQueryData(['categories', 'b-1'], [cat('c1', 0), cat('c2', 1)]);

    const { result } = renderHook(() => useReorderCategories(), {
      wrapper: wrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync(['c2', 'c1']);
    });

    // b-2 (active) rewritten; b-1 untouched.
    const b2 = client.getQueryData<Category[]>(['categories', 'b-2'])!;
    const b1 = client.getQueryData<Category[]>(['categories', 'b-1'])!;
    expect(b2.find((c) => c.id === 'c2')!.displayOrder).toBe(0);
    expect(b1.find((c) => c.id === 'c2')!.displayOrder).toBe(1);
  });
});

describe('useReorderCategories — error rollback', () => {
  it('restores the previous snapshot and surfaces a toast when a PATCH rejects', async () => {
    patchMock.mockRejectedValue({ isAxiosError: true, response: { data: { message: 'boom' } } });
    const client = new QueryClient();
    const key = ['categories', 'b-1'];
    const original = [cat('c1', 0), cat('c2', 1)];
    client.setQueryData(key, original);

    const { result } = renderHook(() => useReorderCategories(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync(['c2', 'c1']).catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Cache rolled back to the original displayOrder mapping.
    const after = client.getQueryData<Category[]>(key)!;
    expect(after.find((c) => c.id === 'c2')!.displayOrder).toBe(1);
    expect(after.find((c) => c.id === 'c1')!.displayOrder).toBe(0);
    expect(toastErrorMock).toHaveBeenCalledWith('boom');
  });

  it('invalidates the branch-keyed categories query on error (converge on server order)', async () => {
    patchMock.mockRejectedValue({ isAxiosError: true, response: { data: { message: 'boom' } } });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(['categories', 'b-1'], [cat('c1', 0), cat('c2', 1)]);

    const { result } = renderHook(() => useReorderCategories(), {
      wrapper: wrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync(['c2', 'c1']).catch(() => undefined);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['categories', 'b-1'] });
  });
});

describe('useReorderProducts — single batch call + invalidation', () => {
  it('sends ONE atomic batch PATCH and invalidates products on success', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useReorderProducts(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync(['p2', 'p3', 'p1']);
    });

    // Single batch call — NOT a per-product fan-out (that shape was
    // non-atomic: a partial failure left a half-applied order server-side).
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith('/menu/products/reorder', {
      orderedIds: ['p2', 'p3', 'p1'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['products'] });
  });

  it('surfaces a toast and still invalidates products on error', async () => {
    patchMock.mockRejectedValue({ isAxiosError: true, response: { data: { message: 'nope' } } });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useReorderProducts(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync(['p1', 'p2']).catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorMock).toHaveBeenCalledWith('nope');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['products'] });
  });
});
