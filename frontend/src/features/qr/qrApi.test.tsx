import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for qrApi — query keys are branch-scoped and the settings
 * mutations invalidate the qr-settings cache while surfacing the
 * server error message on failure.
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

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (selector: (s: any) => unknown) => selector({ branchId: 'b-7' }),
}));

import { useQrSettings, useQrCodes, useUpdateQrSettings, useDeleteQrSettings } from './qrApi';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('useQrSettings / useQrCodes — branch-scoped keys', () => {
  it('useQrSettings keys on branchId', async () => {
    getMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const { result } = renderHook(() => useQrSettings(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/qr/settings');
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['qr-settings', 'b-7']);
  });

  it('useQrCodes keys on branchId and hits /qr/codes', async () => {
    getMock.mockResolvedValue({ data: { qrCodes: [] } });
    const client = makeClient();
    const { result } = renderHook(() => useQrCodes(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/qr/codes');
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['qr-codes', 'b-7']);
  });
});

describe('useUpdateQrSettings', () => {
  it('PATCHes /qr/settings and invalidates the qr-settings cache', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateQrSettings(), { wrapper: wrapper(client) });
    result.current.mutate({ themeColor: '#fff' } as any);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchMock).toHaveBeenCalledWith('/qr/settings', { themeColor: '#fff' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['qr-settings'] });
  });

  it('surfaces the server error message on failure', async () => {
    patchMock.mockRejectedValue({ response: { data: { message: 'invalid color' } } });
    const client = makeClient();
    const { result } = renderHook(() => useUpdateQrSettings(), { wrapper: wrapper(client) });
    result.current.mutate({ themeColor: 'bad' } as any);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('invalid color');
  });
});

describe('useDeleteQrSettings', () => {
  it('DELETEs /qr/settings and invalidates the cache', async () => {
    deleteMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteQrSettings(), { wrapper: wrapper(client) });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteMock).toHaveBeenCalledWith('/qr/settings');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['qr-settings'] });
  });
});
