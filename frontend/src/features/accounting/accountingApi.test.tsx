import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
    patch: (...a: unknown[]) => h.patch(...a),
  },
}));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string | null }) => unknown) =>
    sel({ branchId: 'branch-A' }),
}));

import {
  useGetAccountingSettings,
  useUpdateAccountingSettings,
  useTestAccountingConnection,
  useGetSalesInvoices,
  useInvoice,
  useCreateInvoiceFromOrder,
  useSyncInvoice,
  useCancelInvoice,
} from './accountingApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  h.patch.mockReset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
});

describe('accountingApi', () => {
  it('useGetAccountingSettings GETs the settings endpoint', async () => {
    h.get.mockResolvedValue({ data: { id: 'a1' } });
    const { result } = renderHook(() => useGetAccountingSettings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.get).toHaveBeenCalledWith('/accounting-settings');
  });

  it('useUpdateAccountingSettings PATCHes and invalidates', async () => {
    h.patch.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateAccountingSettings(), {
      wrapper,
    });
    await result.current.mutateAsync({ provider: 'x' } as never);
    expect(h.patch).toHaveBeenCalledWith('/accounting-settings', {
      provider: 'x',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['accountingSettings'],
    });
  });

  it('useTestAccountingConnection POSTs the test endpoint', async () => {
    h.post.mockResolvedValue({ data: { success: true } });
    const { result } = renderHook(() => useTestAccountingConnection(), {
      wrapper,
    });
    const res = await result.current.mutateAsync();
    expect(h.post).toHaveBeenCalledWith('/accounting-settings/test-connection');
    expect(res.success).toBe(true);
  });

  it('useGetSalesInvoices forwards params', async () => {
    h.get.mockResolvedValue({ data: { items: [], total: 0 } });
    renderHook(() => useGetSalesInvoices({ page: 2 }), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/sales-invoices', {
        params: { page: 2 },
      }),
    );
  });

  it('useInvoice GETs the invoice by id and stays idle without one', async () => {
    h.get.mockResolvedValue({ data: { id: 'inv-9', items: [] } });
    const { result } = renderHook(() => useInvoice('inv-9'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.get).toHaveBeenCalledWith('/sales-invoices/inv-9');

    h.get.mockClear();
    renderHook(() => useInvoice(null), { wrapper });
    expect(h.get).not.toHaveBeenCalled();
  });

  it('useCreateInvoiceFromOrder POSTs from-order with the body and invalidates the list', async () => {
    h.post.mockResolvedValue({ data: { id: 'inv-new' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateInvoiceFromOrder(), { wrapper });
    const created = await result.current.mutateAsync({
      orderId: 'order-1',
      customerTaxId: '1234567890',
      customerTaxOffice: 'Kadıköy',
      customerName: 'Acme A.Ş.',
    });
    expect(h.post).toHaveBeenCalledWith('/sales-invoices/from-order/order-1', {
      customerTaxId: '1234567890',
      customerTaxOffice: 'Kadıköy',
      customerName: 'Acme A.Ş.',
    });
    expect(created.id).toBe('inv-new');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['salesInvoices'] });
  });

  it('useSyncInvoice POSTs the sync endpoint by id and returns the re-read invoice', async () => {
    h.post.mockResolvedValue({ data: { id: 'inv-1', syncedAt: null, syncError: null } });
    const { result } = renderHook(() => useSyncInvoice(), { wrapper });
    const updated = await result.current.mutateAsync('inv-1');
    expect(h.post).toHaveBeenCalledWith('/sales-invoices/inv-1/sync');
    // Callers gate the success toast on syncedAt — a no-op sync (NONE
    // provider) must come back untouched, not "successful".
    expect(updated.syncedAt).toBeNull();
  });

  it('useCancelInvoice PATCHes the cancel endpoint by id', async () => {
    h.patch.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useCancelInvoice(), { wrapper });
    await result.current.mutateAsync('inv-2');
    expect(h.patch).toHaveBeenCalledWith('/sales-invoices/inv-2/cancel');
  });
});
