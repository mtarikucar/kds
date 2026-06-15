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
  saBankTransferKeys,
  useBankTransferSettings,
  useUpdateBankTransferSettings,
  usePendingBankTransfers,
  useConfirmBankTransfer,
  useRejectBankTransfer,
} from './superadminBankTransferApi';

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

describe('saBankTransferKeys', () => {
  it('builds scoped keys for settings and pending', () => {
    expect(saBankTransferKeys.settings()).toEqual(['sa', 'bank-transfer', 'settings']);
    expect(saBankTransferKeys.pending()).toEqual(['sa', 'bank-transfer', 'pending']);
  });
});

describe('bank-transfer settings hooks', () => {
  it('useBankTransferSettings GETs the settings endpoint', async () => {
    h.get.mockResolvedValue({ data: { id: 's1', enabled: true } });
    renderHook(() => useBankTransferSettings(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/superadmin/bank-transfer/settings'),
    );
  });

  it('useUpdateBankTransferSettings PATCHes, invalidates and toasts success', async () => {
    h.patch.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateBankTransferSettings(), { wrapper });
    await result.current.mutateAsync({ enabled: true, iban: 'TR123' });
    expect(h.patch).toHaveBeenCalledWith('/superadmin/bank-transfer/settings', {
      enabled: true,
      iban: 'TR123',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['sa', 'bank-transfer', 'settings'],
    });
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useUpdateBankTransferSettings surfaces a server error', async () => {
    h.patch.mockRejectedValue({ isAxiosError: true, response: { data: { message: 'bad iban' } } });
    const { result } = renderHook(() => useUpdateBankTransferSettings(), { wrapper });
    await result.current.mutateAsync({ iban: 'x' }).catch(() => undefined);
    expect(h.toastError).toHaveBeenCalledWith('bad iban');
  });
});

describe('bank-transfer pending hooks', () => {
  it('usePendingBankTransfers GETs the pending endpoint', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => usePendingBankTransfers(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/superadmin/bank-transfer/pending'),
    );
  });

  it('useConfirmBankTransfer POSTs confirm, invalidates pending + subscriptions, toasts', async () => {
    h.post.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useConfirmBankTransfer(), { wrapper });
    await result.current.mutateAsync('pay1');
    expect(h.post).toHaveBeenCalledWith('/superadmin/bank-transfer/pay1/confirm');
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);
    expect(keys).toContainEqual(['sa', 'bank-transfer', 'pending']);
    expect(keys).toContainEqual(['superadmin', 'subscriptions']);
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useRejectBankTransfer POSTs reject with the reason and invalidates pending', async () => {
    h.post.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRejectBankTransfer(), { wrapper });
    await result.current.mutateAsync({ paymentId: 'pay2', reason: 'no funds' });
    expect(h.post).toHaveBeenCalledWith('/superadmin/bank-transfer/pay2/reject', {
      reason: 'no funds',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['sa', 'bank-transfer', 'pending'],
    });
    expect(h.toastSuccess).toHaveBeenCalled();
  });
});
