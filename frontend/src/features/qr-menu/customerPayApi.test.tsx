import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for customerPayApi — the unauthenticated QR self-pay surface.
 * It calls `axios` directly against an absolute base built from API_URL.
 *  - useSessionPayableItems is gated on sessionId.
 *  - useCreatePayIntent strips sessionId into the URL, leaving the rest
 *    of the request as the POST body.
 *  - useSessionPayStatus invalidates the cached payable-items once the
 *    payment reaches a terminal (SUCCEEDED/FAILED) state.
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));
vi.mock('../../lib/env', () => ({ API_URL: 'https://api.test' }));

import { useSessionPayableItems, useCreatePayIntent, useSessionPayStatus } from './customerPayApi';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('useSessionPayableItems', () => {
  it('does not fetch when there is no session id', () => {
    const client = makeClient();
    const { result } = renderHook(() => useSessionPayableItems(null), { wrapper: wrapper(client) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('GETs the session-scoped payable-items endpoint and keys on sessionId', async () => {
    get.mockResolvedValue({ data: { sessionId: 's-1', orders: [] } });
    const client = makeClient();
    const { result } = renderHook(() => useSessionPayableItems('s-1'), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('https://api.test/customer-orders/sessions/s-1/payable-items');
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['sessionPayableItems', 's-1']);
  });
});

describe('useCreatePayIntent', () => {
  it('strips sessionId into the URL and POSTs the remaining body', async () => {
    post.mockResolvedValue({ data: { merchantOid: 'oid-1', paymentLink: 'https://pay', amount: '50', currency: 'TRY' } });
    const client = makeClient();
    const { result } = renderHook(() => useCreatePayIntent(), { wrapper: wrapper(client) });
    result.current.mutate({ sessionId: 's-1', items: [{ orderItemId: 'oi-1', quantity: 1 }], customerPhone: '555' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith('https://api.test/customer-orders/sessions/s-1/pay-intent', {
      items: [{ orderItemId: 'oi-1', quantity: 1 }],
      customerPhone: '555',
    });
    expect(result.current.data?.merchantOid).toBe('oid-1');
  });
});

describe('useSessionPayStatus — terminal-state cache invalidation', () => {
  it('invalidates payable-items once the payment SUCCEEDED', async () => {
    get.mockResolvedValue({ data: { merchantOid: 'oid-1', status: 'SUCCEEDED', amount: '50' } });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSessionPayStatus('s-1', 'oid-1', true), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('https://api.test/customer-orders/sessions/s-1/pay-status', {
      params: { oid: 'oid-1' },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sessionPayableItems', 's-1'] });
  });

  it('does NOT invalidate while the payment is still PENDING', async () => {
    get.mockResolvedValue({ data: { merchantOid: 'oid-1', status: 'PENDING', amount: '50' } });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSessionPayStatus('s-1', 'oid-1', true), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['sessionPayableItems', 's-1'] });
  });

  it('is disabled when enabled=false even with ids present', () => {
    const client = makeClient();
    const { result } = renderHook(() => useSessionPayStatus('s-1', 'oid-1', false), { wrapper: wrapper(client) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });
});
