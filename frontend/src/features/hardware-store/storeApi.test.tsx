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

import {
  formatMoney,
  SALE_MODE_DISCLAIMER_TR,
  storeKeys,
  hardwareOrderKeys,
  useListProducts,
  useCategories,
  useGetProductBySku,
  useRequestQuote,
  useQuoteCart,
  useConfirmCheckout,
  useCreateCheckoutIntent,
  useListHardwareOrders,
  useGetHardwareOrder,
} from './storeApi';

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

describe('formatMoney', () => {
  it('renders cents as a TRY currency string', () => {
    const out = formatMoney(123456, 'TRY');
    expect(out).toContain('₺');
    expect(out).toContain('1.234,56');
  });

  it('honors a different currency', () => {
    const out = formatMoney(5000, 'USD');
    // tr-TR locale still drives grouping/decimal separators.
    expect(out).toContain('50,00');
  });
});

describe('SALE_MODE_DISCLAIMER_TR', () => {
  it('has no disclaimer for direct sale and copy for restricted tiers', () => {
    expect(SALE_MODE_DISCLAIMER_TR.DIRECT_SALE).toBeNull();
    expect(SALE_MODE_DISCLAIMER_TR.QUOTE_ONLY).toMatch(/teklif/i);
    expect(SALE_MODE_DISCLAIMER_TR.PARTNER_REDIRECT).toMatch(/banka/i);
    expect(SALE_MODE_DISCLAIMER_TR.RECOMMENDED_ONLY).toMatch(/önerilen/i);
  });
});

describe('store query keys', () => {
  it('scopes product + order keys', () => {
    expect(storeKeys.products('printer')).toEqual([
      'hardware-store',
      'products',
      'printer',
    ]);
    expect(hardwareOrderKeys.list('shipped')).toEqual([
      'hardware-orders',
      'list',
      'shipped',
    ]);
    expect(hardwareOrderKeys.detail('o1')).toEqual([
      'hardware-orders',
      'detail',
      'o1',
    ]);
  });
});

describe('storeApi queries', () => {
  it('useListProducts forwards a category filter', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListProducts('printer'), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/v1/catalog/products', {
        params: { category: 'printer' },
      }),
    );
  });

  it('useCategories GETs the categories endpoint', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useCategories(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/v1/catalog/categories'),
    );
  });

  it('useGetProductBySku is disabled without a sku', () => {
    const { result } = renderHook(() => useGetProductBySku(undefined), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.get).not.toHaveBeenCalled();
  });

  it('useGetProductBySku URL-encodes the sku', async () => {
    h.get.mockResolvedValue({ data: {} });
    renderHook(() => useGetProductBySku('a b/c'), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith(
        '/v1/catalog/products/sku/a%20b%2Fc',
      ),
    );
  });

  it('useListHardwareOrders forwards a status filter', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListHardwareOrders('shipped'), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/v1/hardware-orders', {
        params: { status: 'shipped' },
      }),
    );
  });

  it('useGetHardwareOrder is disabled without an id', () => {
    const { result } = renderHook(() => useGetHardwareOrder(undefined), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('storeApi mutations', () => {
  it('useRequestQuote POSTs the quote-request endpoint', async () => {
    h.post.mockResolvedValue({ data: { ok: true } });
    const { result } = renderHook(() => useRequestQuote(), { wrapper });
    await result.current.mutateAsync({ sku: 's1', contactPerson: 'Ada' });
    expect(h.post).toHaveBeenCalledWith('/v1/catalog/quote-request', {
      sku: 's1',
      contactPerson: 'Ada',
    });
  });

  it('useQuoteCart POSTs the checkout quote endpoint', async () => {
    h.post.mockResolvedValue({ data: { totalCents: 0, lines: [] } });
    const { result } = renderHook(() => useQuoteCart(), { wrapper });
    await result.current.mutateAsync({ items: [] });
    expect(h.post).toHaveBeenCalledWith('/v1/checkout/quote', { items: [] });
  });

  it('useConfirmCheckout POSTs confirm and invalidates the affected surfaces', async () => {
    h.post.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useConfirmCheckout(), { wrapper });
    await result.current.mutateAsync({
      cart: { items: [] },
      paymentRef: 'pr1',
    });
    expect(h.post).toHaveBeenCalledWith('/v1/checkout/confirm', {
      cart: { items: [] },
      paymentRef: 'pr1',
    });
    // targeted invalidation — not a full cache nuke
    const keys = invalidate.mock.calls.map((c) => (c[0] as any).queryKey[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        'subscriptions',
        'entitlements',
        'devices',
        'hardware-orders',
        'marketplace',
      ]),
    );
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useCreateCheckoutIntent POSTs the intent endpoint', async () => {
    h.post.mockResolvedValue({ data: { paymentRef: 'p' } });
    const { result } = renderHook(() => useCreateCheckoutIntent(), { wrapper });
    await result.current.mutateAsync({
      cart: { items: [] },
      buyer: { email: 'a@b.c', name: 'A', phone: '1' },
    });
    expect(h.post).toHaveBeenCalledWith(
      '/v1/checkout/intent',
      expect.objectContaining({ cart: { items: [] } }),
    );
  });

  it('useConfirmCheckout surfaces a server error', async () => {
    h.post.mockRejectedValue({ response: { data: { message: 'declined' } } });
    const { result } = renderHook(() => useConfirmCheckout(), { wrapper });
    await result.current
      .mutateAsync({ cart: { items: [] }, paymentRef: 'x' })
      .catch(() => undefined);
    expect(h.toastError).toHaveBeenCalledWith('declined');
  });
});
