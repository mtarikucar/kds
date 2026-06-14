import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for planApi — useGetUsageSnapshot reads the usage snapshot under a
 * stable key. planApi imports the NAMED `api` export, so the mock exposes
 * both named + default to be safe.
 */

const getMock = vi.fn();
vi.mock('../../lib/api', () => ({
  api: { get: (...a: unknown[]) => getMock(...a) },
  default: { get: (...a: unknown[]) => getMock(...a) },
}));

import { planKeys, useGetUsageSnapshot } from './planApi';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('planKeys', () => {
  it('exposes a stable usage-snapshot key', () => {
    expect(planKeys.usageSnapshot()).toEqual(['plan', 'usage-snapshot']);
  });
});

describe('useGetUsageSnapshot', () => {
  it('GETs the snapshot endpoint and returns the body under the snapshot key', async () => {
    const snapshot = {
      users: { current: 3, max: 10 },
      branches: { current: 1, max: -1 },
      tables: { current: 5, max: 20 },
      products: { current: 12, max: 100 },
      monthlyOrders: { current: 40, max: 1000 },
      computedAt: '2026-06-14T00:00:00.000Z',
    };
    getMock.mockResolvedValue({ data: snapshot });
    const client = makeClient();
    const { result } = renderHook(() => useGetUsageSnapshot(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/subscriptions/usage/snapshot');
    expect(result.current.data).toEqual(snapshot);
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['plan', 'usage-snapshot']);
  });
});
