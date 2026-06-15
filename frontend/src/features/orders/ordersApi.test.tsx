import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for ordersApi — focus on the hooks with real logic over their
 * pass-through siblings:
 *  - useCreatePayment / useSplitBill / usePayByItems generate a
 *    client-side idempotencyKey (crypto.randomUUID) ONLY when the caller
 *    didn't supply one, and strip orderId out of the URL vs the body.
 *  - useCancelOrder hard-codes the CANCELLED status payload.
 *  - useTransferTableOrders interpolates table numbers into its toast.
 *  - the staff query hooks bake branchId into their keys and hit the
 *    right endpoints with the right params.
 */

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    patch: (...a: unknown[]) => patchMock(...a),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock('../../i18n/config', () => ({
  default: { t: (k: string, opts?: any) => (opts ? `${k}:${JSON.stringify(opts)}` : k) },
}));

vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (selector: (s: any) => unknown) => selector({ branchId: 'b-1' }),
}));

import {
  useCreatePayment,
  useSplitBill,
  usePayByItems,
  useCancelOrder,
  useTransferTableOrders,
  usePendingOrders,
  useWaiterRequests,
} from './ordersApi';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Deterministic UUID so we can assert the auto-generated idempotency key.
  vi.stubGlobal('crypto', { randomUUID: () => 'uuid-fixed' });
});

describe('useCreatePayment — idempotency key + URL/body split', () => {
  it('strips orderId into the URL and auto-generates an idempotency key', async () => {
    postMock.mockResolvedValue({ data: { id: 'pay-1' } });
    const client = new QueryClient();
    const { result } = renderHook(() => useCreatePayment(), { wrapper: wrapper(client) });
    result.current.mutate({ orderId: 'o-9', amount: 50, method: 'CASH' } as any);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/orders/o-9/payments', {
      amount: 50,
      method: 'CASH',
      idempotencyKey: 'uuid-fixed',
    });
  });

  it('honours a caller-supplied idempotency key instead of generating one', async () => {
    postMock.mockResolvedValue({ data: { id: 'pay-2' } });
    const client = new QueryClient();
    const { result } = renderHook(() => useCreatePayment(), { wrapper: wrapper(client) });
    result.current.mutate({ orderId: 'o-9', amount: 10, idempotencyKey: 'caller-key' } as any);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/orders/o-9/payments', {
      amount: 10,
      idempotencyKey: 'caller-key',
    });
  });

  it('invalidates orders/payments/tables/customers on success', async () => {
    postMock.mockResolvedValue({ data: {} });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreatePayment(), { wrapper: wrapper(client) });
    result.current.mutate({ orderId: 'o-1', amount: 5 } as any);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['orders'], refetchType: 'all' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['customers'] });
  });
});

describe('useSplitBill', () => {
  it('posts to the split endpoint with a generated batch idempotency key', async () => {
    postMock.mockResolvedValue({ data: { ok: true } });
    const client = new QueryClient();
    const { result } = renderHook(() => useSplitBill(), { wrapper: wrapper(client) });
    result.current.mutate({ orderId: 'o-3', splits: [{ amount: 10 }] } as any);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/orders/o-3/payments/split', {
      splits: [{ amount: 10 }],
      idempotencyKey: 'uuid-fixed',
    });
  });
});

describe('usePayByItems', () => {
  it('posts to the items endpoint and invalidates the order-scoped payableItems key', async () => {
    postMock.mockResolvedValue({ data: {} });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => usePayByItems(), { wrapper: wrapper(client) });
    result.current.mutate({ orderId: 'o-7', items: ['i1'] } as any);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/orders/o-7/payments/items', {
      items: ['i1'],
      idempotencyKey: 'uuid-fixed',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payableItems', 'o-7'] });
  });
});

describe('useCancelOrder', () => {
  it('PATCHes the status endpoint with a hard-coded CANCELLED payload', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = new QueryClient();
    const { result } = renderHook(() => useCancelOrder(), { wrapper: wrapper(client) });
    result.current.mutate('o-5');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchMock).toHaveBeenCalledWith('/orders/o-5/status', { status: 'CANCELLED' });
  });
});

describe('useTransferTableOrders', () => {
  it('interpolates the source/target table numbers into the success toast', async () => {
    postMock.mockResolvedValue({
      data: {
        message: 'moved',
        transferredOrders: [],
        sourceTable: { id: 's', number: '5', newStatus: 'AVAILABLE' },
        targetTable: { id: 't', number: '12', newStatus: 'OCCUPIED' },
      },
    });
    const client = new QueryClient();
    const { result } = renderHook(() => useTransferTableOrders(), { wrapper: wrapper(client) });
    result.current.mutate({ sourceTableId: 's', targetTableId: 't' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/orders/transfer-table', { sourceTableId: 's', targetTableId: 't' });
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('"sourceTable":"5","targetTable":"12"'),
    );
  });

  it('surfaces the server error message on failure', async () => {
    postMock.mockRejectedValue({ isAxiosError: true, response: { data: { message: 'tables busy' } } });
    const client = new QueryClient();
    const { result } = renderHook(() => useTransferTableOrders(), { wrapper: wrapper(client) });
    result.current.mutate({ sourceTableId: 's', targetTableId: 't' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('tables busy');
  });
});

describe('staff query hooks', () => {
  it('usePendingOrders requests orders filtered to PENDING_APPROVAL, keyed by branch', async () => {
    getMock.mockResolvedValue({ data: [] });
    const client = new QueryClient();
    const { result } = renderHook(() => usePendingOrders(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/orders', { params: { status: 'PENDING_APPROVAL' } });
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['orders', 'pending', 'b-1']);
  });

  it('useWaiterRequests hits the tenant-active endpoint with a branch-scoped key', async () => {
    getMock.mockResolvedValue({ data: [] });
    const client = new QueryClient();
    const { result } = renderHook(() => useWaiterRequests(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/customer-orders/waiter-requests/tenant/active');
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['waiterRequests', 'b-1']);
  });
});
