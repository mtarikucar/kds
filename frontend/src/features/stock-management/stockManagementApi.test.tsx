import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
    patch: (...a: unknown[]) => h.patch(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string | null }) => unknown) =>
    sel({ branchId: 'branch-A' }),
}));

import {
  useStockCategories,
  useStockItems,
  useStockItem,
  useExpiringSoon,
  useCreateStockCategory,
  useUpdateStockItem,
  useDeleteStockItem,
  useReceivePurchaseOrder,
  useCheckRecipeStock,
  usePurchaseOrders,
} from './stockManagementApi';

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

describe('stockManagementApi queries', () => {
  it('useStockCategories GETs the categories endpoint', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useStockCategories(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/stock-management/categories'),
    );
  });

  it('useStockItems forwards filter params', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useStockItems({ search: 'flour' }), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/stock-management/items', {
        params: { search: 'flour' },
      }),
    );
  });

  it('useStockItem is disabled without an id', () => {
    const { result } = renderHook(() => useStockItem(''), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.get).not.toHaveBeenCalled();
  });

  it('useExpiringSoon passes the days window', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useExpiringSoon(7), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith(
        '/stock-management/items/expiring-soon',
        { params: { days: 7 } },
      ),
    );
  });

  it('usePurchaseOrders passes the status filter', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => usePurchaseOrders('draft'), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/stock-management/purchase-orders', {
        params: { status: 'draft' },
      }),
    );
  });
});

describe('stockManagementApi mutations', () => {
  it('useCreateStockCategory POSTs and invalidates the categories list', async () => {
    h.post.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateStockCategory(), { wrapper });
    await result.current.mutateAsync({ name: 'Dairy' });
    expect(h.post).toHaveBeenCalledWith('/stock-management/categories', {
      name: 'Dairy',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stockCategories'] });
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useUpdateStockItem PATCHes by id', async () => {
    h.patch.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useUpdateStockItem(), { wrapper });
    await result.current.mutateAsync({ id: 'i1', data: { name: 'x' } });
    expect(h.patch).toHaveBeenCalledWith('/stock-management/items/i1', {
      name: 'x',
    });
  });

  it('useDeleteStockItem DELETEs by id', async () => {
    h.del.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useDeleteStockItem(), { wrapper });
    await result.current.mutateAsync('i9');
    expect(h.del).toHaveBeenCalledWith('/stock-management/items/i9');
  });

  it('useReceivePurchaseOrder invalidates both POs and stock items', async () => {
    h.post.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useReceivePurchaseOrder(), { wrapper });
    await result.current.mutateAsync({ id: 'po1', data: {} });
    expect(h.post).toHaveBeenCalledWith(
      '/stock-management/purchase-orders/po1/receive',
      {},
    );
    const keys = invalidate.mock.calls.map((c) => (c[0] as any).queryKey[0]);
    expect(keys).toEqual(
      expect.arrayContaining(['purchaseOrders', 'stockItems']),
    );
  });

  it('useCheckRecipeStock POSTs with the quantity param', async () => {
    h.post.mockResolvedValue({ data: { ok: true } });
    const { result } = renderHook(() => useCheckRecipeStock(), { wrapper });
    await result.current.mutateAsync({ id: 'r1', quantity: 3 });
    expect(h.post).toHaveBeenCalledWith(
      '/stock-management/recipes/r1/check-stock',
      null,
      { params: { quantity: 3 } },
    );
  });
});
