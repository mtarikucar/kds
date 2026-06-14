import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for subscriptionsApi — the hooks here have real coalescing /
 * unwrapping / branching logic that a bare CRUD pass-through wouldn't:
 *  - useGetCurrentSubscription / useGetScheduledDowngrade swallow a 404
 *    into `null` but rethrow other errors.
 *  - useGetTenantInvoices unwraps the backend's {items|data|array} shapes.
 *  - useChangePlan emits different toasts (downgrade vs upgrade-needs-pay)
 *    and invalidates effective-features on EVERY branch (v2.8.91).
 *  - the mutations invalidate the right query keys via subscriptionKeys.
 */

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    patch: (...a: unknown[]) => patchMock(...a),
    delete: (...a: unknown[]) => deleteMock(...a),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
  },
}));

vi.mock('../../i18n/config', () => ({
  default: { t: (k: string, opts?: any) => (opts ? `${k}:${JSON.stringify(opts)}` : k) },
}));

import {
  subscriptionKeys,
  useGetCurrentSubscription,
  useGetScheduledDowngrade,
  useGetTenantInvoices,
  useChangePlan,
  useCancelScheduledDowngrade,
} from './subscriptionsApi';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('subscriptionKeys', () => {
  it('builds hierarchical, stable keys', () => {
    expect(subscriptionKeys.effectiveFeatures()).toEqual(['subscriptions', 'effective-features']);
    expect(subscriptionKeys.detail('s1')).toEqual(['subscriptions', 'detail', 's1']);
    expect(subscriptionKeys.scheduledDowngrade('s1')).toEqual(['subscriptions', 'scheduled-downgrade', 's1']);
  });
});

describe('useGetCurrentSubscription — 404 coalescing', () => {
  it('returns null when the backend 404s (no active subscription)', async () => {
    getMock.mockRejectedValue({ response: { status: 404 } });
    const client = makeClient();
    const { result } = renderHook(() => useGetCurrentSubscription(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('rethrows non-404 errors instead of masking them as null', async () => {
    getMock.mockRejectedValue({ response: { status: 500 } });
    const client = makeClient();
    const { result } = renderHook(() => useGetCurrentSubscription(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('useGetScheduledDowngrade — 404 coalescing + enabled gate', () => {
  it('returns null on 404', async () => {
    getMock.mockRejectedValue({ response: { status: 404 } });
    const client = makeClient();
    const { result } = renderHook(() => useGetScheduledDowngrade('s1'), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('does not fetch when subscriptionId is empty', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useGetScheduledDowngrade(''), { wrapper: wrapper(client) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe('useGetTenantInvoices — response unwrapping', () => {
  it('unwraps the paginated {items} envelope', async () => {
    getMock.mockResolvedValue({ data: { items: [{ id: 'i1' }], meta: {} } });
    const client = makeClient();
    const { result } = renderHook(() => useGetTenantInvoices(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'i1' }]);
  });

  it('passes through a bare array', async () => {
    getMock.mockResolvedValue({ data: [{ id: 'i2' }] });
    const client = makeClient();
    const { result } = renderHook(() => useGetTenantInvoices(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'i2' }]);
  });

  it('unwraps the {data:[...]} envelope', async () => {
    getMock.mockResolvedValue({ data: { data: [{ id: 'i3' }] } });
    const client = makeClient();
    const { result } = renderHook(() => useGetTenantInvoices(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'i3' }]);
  });

  it('falls back to an empty array for an unrecognised shape', async () => {
    getMock.mockResolvedValue({ data: { weird: true } });
    const client = makeClient();
    const { result } = renderHook(() => useGetTenantInvoices(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useChangePlan — branch-specific side effects', () => {
  it('downgrade: schedules toast with formatted date + invalidates effective-features and scheduled-downgrade', async () => {
    postMock.mockResolvedValue({
      data: { type: 'downgrade', scheduledFor: '2026-07-01T00:00:00.000Z' },
    });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useChangePlan(), { wrapper: wrapper(client) });
    result.current.mutate({ id: 's1', data: { planId: 'p2' } as any });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/subscriptions/s1/change-plan', { planId: 'p2' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['subscriptions', 'effective-features'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['subscriptions', 'scheduled-downgrade', 's1'] });
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('common:notifications.downgradeScheduled'));
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('upgrade requiring payment: shows redirect info toast, no downgrade invalidation', async () => {
    postMock.mockResolvedValue({ data: { type: 'upgrade', requiresPayment: true } });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useChangePlan(), { wrapper: wrapper(client) });
    result.current.mutate({ id: 's1', data: { planId: 'p3' } as any });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toastInfo).toHaveBeenCalledWith('common:notifications.redirectingToPayment');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['subscriptions', 'effective-features'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ['subscriptions', 'scheduled-downgrade', 's1'],
    });
  });
});

describe('useCancelScheduledDowngrade', () => {
  it('DELETEs and invalidates the scheduled-downgrade + current keys', async () => {
    deleteMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCancelScheduledDowngrade(), { wrapper: wrapper(client) });
    result.current.mutate('s1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteMock).toHaveBeenCalledWith('/subscriptions/s1/scheduled-downgrade');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['subscriptions', 'scheduled-downgrade', 's1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['subscriptions', 'current'] });
  });
});
