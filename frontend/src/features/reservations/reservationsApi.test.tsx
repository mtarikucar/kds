import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for reservationsApi. The lifecycle mutations all share a
 * distinctive pattern worth pinning: their onError ALSO invalidates
 * ['reservations'] + ['tables'] (conflict-class refetch — another
 * terminal may have moved the row), which a plain CRUD wrapper wouldn't.
 * We assert both the success-path table-state invalidation and the
 * error-path refetch.
 */

const getMock = vi.fn();
const patchMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => getMock(...a),
    patch: (...a: unknown[]) => patchMock(...a),
    delete: (...a: unknown[]) => deleteMock(...a),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (selector: (s: any) => unknown) => selector({ branchId: 'b-3' }),
}));

import {
  useReservations,
  useSeatReservation,
  useConfirmReservation,
  useRejectReservation,
  useDeleteReservation,
} from './reservationsApi';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('useReservations', () => {
  it('forwards filter params and bakes them + branch into the key', async () => {
    getMock.mockResolvedValue({ data: { data: [], meta: {} } });
    const client = makeClient();
    const params = { date: '2026-06-14', status: 'CONFIRMED' };
    const { result } = renderHook(() => useReservations(params), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/reservations', { params });
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['reservations', params, 'b-3']);
  });
});

describe('useSeatReservation — table-state coupling', () => {
  it('on success invalidates reservations, stats AND tables (table flips OCCUPIED)', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSeatReservation(), { wrapper: wrapper(client) });
    result.current.mutate('r-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchMock).toHaveBeenCalledWith('/reservations/r-1/seat');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reservations'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reservationStats'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tables'] });
  });

  it('on error performs the conflict-class refetch of reservations + tables', async () => {
    patchMock.mockRejectedValue({ response: { status: 409, data: { message: 'already seated' } } });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSeatReservation(), { wrapper: wrapper(client) });
    result.current.mutate('r-1');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reservations'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tables'] });
  });
});

describe('useConfirmReservation / useRejectReservation', () => {
  it('confirm PATCHes the confirm endpoint and refreshes the floor plan', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useConfirmReservation(), { wrapper: wrapper(client) });
    result.current.mutate('r-2');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchMock).toHaveBeenCalledWith('/reservations/r-2/confirm');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tables'] });
  });

  it('reject forwards the rejectionReason body', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const { result } = renderHook(() => useRejectReservation(), { wrapper: wrapper(client) });
    result.current.mutate({ id: 'r-3', rejectionReason: 'fully booked' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchMock).toHaveBeenCalledWith('/reservations/r-3/reject', { rejectionReason: 'fully booked' });
  });
});

describe('useDeleteReservation', () => {
  it('DELETEs and invalidates reservations + stats (no table coupling)', async () => {
    deleteMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteReservation(), { wrapper: wrapper(client) });
    result.current.mutate('r-4');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteMock).toHaveBeenCalledWith('/reservations/r-4');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reservations'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reservationStats'] });
  });
});
