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
  // The error classifiers call axios.isAxiosError — keep a faithful stub so
  // they can read status/message off axios-shaped errors in these specs.
  default: {
    create: () => ({ get, post, patch }),
    isAxiosError: (e: unknown) =>
      !!e && typeof e === 'object' && (e as { isAxiosError?: boolean }).isAxiosError === true,
  },
}));

import {
  usePublicReservationSettings,
  usePublicBranches,
  useAvailableSlots,
  useCreatePublicReservation,
  useLookupReservation,
  useCancelPublicReservation,
  classifyCreateReservationError,
  createReservationErrorKey,
  classifyCancelError,
  cancelReservationErrorKey,
  classifyLookupError,
} from './publicReservationsApi';

/** Build an axios-shaped rejection for classifier specs. */
function axiosError(status: number | undefined, message?: string) {
  return {
    isAxiosError: true,
    response: status === undefined ? undefined : { status, data: { message } },
  };
}

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

describe('classifyCreateReservationError — backend message → code', () => {
  it('maps 429 to a non-conflict rate-limited code', () => {
    expect(classifyCreateReservationError(axiosError(429))).toEqual({
      code: 'rateLimited',
      isConflict: false,
    });
  });

  it('maps "already reserved" to a recoverable table-conflict', () => {
    expect(
      classifyCreateReservationError(
        axiosError(400, 'This table is already reserved for the selected time period'),
      ),
    ).toEqual({ code: 'tableTaken', isConflict: true });
  });

  it('maps "fully booked" to a recoverable slot-conflict', () => {
    expect(
      classifyCreateReservationError(axiosError(400, 'This time slot is fully booked')),
    ).toEqual({ code: 'slotFull', isConflict: true });
  });

  it('maps "already have a reservation" to a non-conflict duplicate', () => {
    expect(
      classifyCreateReservationError(
        axiosError(400, 'You already have a reservation for this time slot'),
      ),
    ).toEqual({ code: 'duplicate', isConflict: false });
  });

  it('falls back to generic for unknown messages and non-axios errors', () => {
    expect(classifyCreateReservationError(axiosError(500, 'boom'))).toEqual({
      code: 'generic',
      isConflict: false,
    });
    expect(classifyCreateReservationError(new Error('network'))).toEqual({
      code: 'generic',
      isConflict: false,
    });
  });

  it('maps each code to a public.error* key', () => {
    expect(createReservationErrorKey('tableTaken')).toBe('public.errorTableTaken');
    expect(createReservationErrorKey('slotFull')).toBe('public.errorSlotFull');
    expect(createReservationErrorKey('duplicate')).toBe('public.errorDuplicate');
    expect(createReservationErrorKey('rateLimited')).toBe('public.errorRateLimited');
    expect(createReservationErrorKey('generic')).toBe('public.errorGeneric');
  });
});

describe('classifyCancelError — cancel failure → lookup key', () => {
  it('maps the deadline, disabled, and cannot-cancel messages', () => {
    expect(cancelReservationErrorKey(classifyCancelError(axiosError(400, 'Cancellation deadline has passed')))).toBe(
      'lookup.deadlinePassed',
    );
    expect(cancelReservationErrorKey(classifyCancelError(axiosError(400, 'Cancellation is not allowed')))).toBe(
      'lookup.cancelDisabled',
    );
    expect(
      cancelReservationErrorKey(classifyCancelError(axiosError(400, 'This reservation cannot be cancelled'))),
    ).toBe('lookup.cannotCancel');
  });

  it('maps 429 to the temporary key and unknown to the generic key', () => {
    expect(cancelReservationErrorKey(classifyCancelError(axiosError(429)))).toBe('lookup.tempError');
    expect(cancelReservationErrorKey(classifyCancelError(new Error('x')))).toBe('lookup.cancelError');
  });
});

describe('classifyLookupError — temporary vs not-found', () => {
  it('treats 429 and 5xx as temporary', () => {
    expect(classifyLookupError(axiosError(429))).toBe('temporary');
    expect(classifyLookupError(axiosError(503))).toBe('temporary');
  });

  it('treats 404 / other 4xx as not-found', () => {
    expect(classifyLookupError(axiosError(404, 'Reservation not found'))).toBe('notFound');
    expect(classifyLookupError(axiosError(400))).toBe('notFound');
    // A transport error with no response is a definitive negative here
    // (preserves the page's historical behavior for plain rejections).
    expect(classifyLookupError(new Error('boom'))).toBe('notFound');
  });
});
