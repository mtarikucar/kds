import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for publicReservationsApi — the unauthenticated booking surface.
 * It spins up its OWN axios instance (no auth interceptor / branch
 * header), so we mock `axios.create` to hand back a controllable client
 * and assert the public endpoints, the tenantId-gated `enabled` flags,
 * and the param/body shapes for slots, lookup and cancel.
 */

// vi.hoisted so the mock fns exist before the source module's top-level
// `axios.create()` call runs at import time (avoids a TDZ ReferenceError).
const { get, post, patch } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));
vi.mock('axios', () => ({
  default: { create: () => ({ get, post, patch }) },
}));

import {
  usePublicReservationSettings,
  usePublicBranches,
  useAvailableSlots,
  useCreatePublicReservation,
  useLookupReservation,
  useCancelPublicReservation,
} from './publicReservationsApi';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('usePublicReservationSettings / usePublicBranches — tenant gate', () => {
  it('does not fetch settings when tenantId is empty', () => {
    const client = makeClient();
    const { result } = renderHook(() => usePublicReservationSettings(''), { wrapper: wrapper(client) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('fetches public settings for a tenant', async () => {
    get.mockResolvedValue({ data: { enabled: true } });
    const client = makeClient();
    const { result } = renderHook(() => usePublicReservationSettings('t-1'), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/public/reservations/t-1/settings');
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['publicReservationSettings', 't-1']);
  });

  it('fetches bookable branches for a tenant', async () => {
    get.mockResolvedValue({ data: [{ id: 'br1', name: 'Main' }] });
    const client = makeClient();
    const { result } = renderHook(() => usePublicBranches('t-1'), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/public/reservations/t-1/branches');
  });
});

describe('useAvailableSlots — param forwarding + date gate', () => {
  it('is disabled until both tenantId and date are present', () => {
    const client = makeClient();
    const { result } = renderHook(() => useAvailableSlots('t-1', ''), { wrapper: wrapper(client) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('forwards date/guestCount/branchId as query params', async () => {
    get.mockResolvedValue({ data: [] });
    const client = makeClient();
    const { result } = renderHook(() => useAvailableSlots('t-1', '2026-06-20', 4, 'br1'), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/public/reservations/t-1/available-slots', {
      params: { date: '2026-06-20', guestCount: 4, branchId: 'br1' },
    });
  });
});

describe('useCreatePublicReservation', () => {
  it('POSTs the booking body to the tenant-scoped endpoint', async () => {
    post.mockResolvedValue({ data: { id: 'res-1' } });
    const client = makeClient();
    const { result } = renderHook(() => useCreatePublicReservation(), { wrapper: wrapper(client) });
    result.current.mutate({ tenantId: 't-1', data: { guestCount: 2 } as any });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith('/public/reservations/t-1', { guestCount: 2 });
    expect(result.current.data).toEqual({ id: 'res-1' });
  });
});

describe('useLookupReservation', () => {
  it('GETs the lookup endpoint with phone + reservationNumber params', async () => {
    get.mockResolvedValue({ data: { id: 'res-2' } });
    const client = makeClient();
    const { result } = renderHook(() => useLookupReservation(), { wrapper: wrapper(client) });
    result.current.mutate({ tenantId: 't-1', phone: '555', reservationNumber: 'R-9' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/public/reservations/t-1/lookup', {
      params: { phone: '555', reservationNumber: 'R-9' },
    });
  });
});

describe('useCancelPublicReservation', () => {
  it('PATCHes the cancel endpoint with the verification body', async () => {
    patch.mockResolvedValue({ data: { id: 'res-3', status: 'CANCELLED' } });
    const client = makeClient();
    const { result } = renderHook(() => useCancelPublicReservation(), { wrapper: wrapper(client) });
    result.current.mutate({ tenantId: 't-1', id: 'res-3', customerPhone: '555', reservationNumber: 'R-3' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patch).toHaveBeenCalledWith('/public/reservations/t-1/res-3/cancel', {
      customerPhone: '555',
      reservationNumber: 'R-3',
    });
  });
});
