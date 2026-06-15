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
vi.mock('./superAdminApi', () => ({
  superAdminApi: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
    patch: (...a: unknown[]) => h.patch(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import {
  saMarketplaceKeys,
  useSaListAddOns,
  useSaCreateAddOn,
  useSaUpdateAddOn,
  useSaArchiveAddOn,
  useSaListProducts,
  useSaCreateProduct,
  useSaReceiveStock,
} from './superadminMarketplaceApi';

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

describe('saMarketplaceKeys', () => {
  it('builds scoped keys for addons and products', () => {
    expect(saMarketplaceKeys.addons('published', 'software')).toEqual([
      'sa',
      'addons',
      'published',
      'software',
    ]);
    expect(saMarketplaceKeys.products('draft', 'printer')).toEqual([
      'sa',
      'products',
      'draft',
      'printer',
    ]);
  });
});

describe('marketplace add-on hooks', () => {
  it('useSaListAddOns GETs the addons endpoint with filters', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useSaListAddOns({ status: 'published' }), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith(
        '/v1/superadmin/marketplace/addons',
        { params: { status: 'published' } },
      ),
    );
  });

  it('useSaCreateAddOn POSTs, invalidates and toasts success', async () => {
    h.post.mockResolvedValue({ data: { id: 'a1' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSaCreateAddOn(), { wrapper });
    await result.current.mutateAsync({ code: 'x', name: 'X' } as never);
    expect(h.post).toHaveBeenCalledWith(
      '/v1/superadmin/marketplace/addons',
      expect.objectContaining({ code: 'x' }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sa', 'addons'] });
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useSaCreateAddOn surfaces a server error', async () => {
    h.post.mockRejectedValue({ isAxiosError: true, response: { data: { message: 'dup code' } } });
    const { result } = renderHook(() => useSaCreateAddOn(), { wrapper });
    await result.current.mutateAsync({ code: 'x' } as never).catch(() => undefined);
    expect(h.toastError).toHaveBeenCalledWith('dup code');
  });

  it('useSaUpdateAddOn PATCHes by id with the rest of the body', async () => {
    h.patch.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSaUpdateAddOn(), { wrapper });
    await result.current.mutateAsync({ id: 'a1', name: 'New' } as never);
    expect(h.patch).toHaveBeenCalledWith(
      '/v1/superadmin/marketplace/addons/a1',
      { name: 'New' },
    );
  });

  it('useSaArchiveAddOn DELETEs by id', async () => {
    h.del.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSaArchiveAddOn(), { wrapper });
    await result.current.mutateAsync('a9');
    expect(h.del).toHaveBeenCalledWith(
      '/v1/superadmin/marketplace/addons/a9',
    );
  });
});

describe('marketplace catalog hooks', () => {
  it('useSaListProducts GETs the catalog products endpoint', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useSaListProducts({ category: 'printer' }), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith(
        '/v1/superadmin/catalog/products',
        { params: { category: 'printer' } },
      ),
    );
  });

  it('useSaCreateProduct POSTs and invalidates the products cache', async () => {
    h.post.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSaCreateProduct(), { wrapper });
    await result.current.mutateAsync({ sku: 'SKU1' } as never);
    expect(h.post).toHaveBeenCalledWith(
      '/v1/superadmin/catalog/products',
      expect.objectContaining({ sku: 'SKU1' }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sa', 'products'] });
  });

  it('useSaReceiveStock POSTs qty + serials to the stock endpoint', async () => {
    h.post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSaReceiveStock(), { wrapper });
    await result.current.mutateAsync({ id: 'p1', qty: 5, serials: ['s1'] });
    expect(h.post).toHaveBeenCalledWith(
      '/v1/superadmin/catalog/products/p1/stock',
      { qty: 5, serials: ['s1'] },
    );
  });
});
