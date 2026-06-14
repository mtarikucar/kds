import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for posApi — the POS-settings read/write pair. The update hook
 * PATCHes and invalidates the posSettings cache so the register reflects
 * the new config.
 */

const getMock = vi.fn();
const patchMock = vi.fn();
vi.mock('../../lib/api', () => ({
  default: { get: (...a: unknown[]) => getMock(...a), patch: (...a: unknown[]) => patchMock(...a) },
}));

import { useGetPosSettings, useUpdatePosSettings } from './posApi';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('useGetPosSettings', () => {
  it('GETs /pos-settings under the posSettings key', async () => {
    getMock.mockResolvedValue({ data: { tipEnabled: true } });
    const client = makeClient();
    const { result } = renderHook(() => useGetPosSettings(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/pos-settings');
    expect(result.current.data).toEqual({ tipEnabled: true });
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['posSettings']);
  });
});

describe('useUpdatePosSettings', () => {
  it('PATCHes /pos-settings and invalidates the posSettings cache', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdatePosSettings(), { wrapper: wrapper(client) });
    result.current.mutate({ tipEnabled: false } as any);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchMock).toHaveBeenCalledWith('/pos-settings', { tipEnabled: false });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['posSettings'] });
  });
});
