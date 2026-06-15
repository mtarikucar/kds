import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Specs for ReservationLookupPage — the public "find my booking" form. We
 * mock the lookup + cancel mutations. Key logic: the search submit passes
 * TRIMMED phone + reservation-number to the lookup, renders the found
 * reservation, falls back to a not-found notice on rejection, only offers
 * cancel for PENDING/CONFIRMED bookings, and the cancel flow merges the
 * server response back into the displayed reservation.
 */

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useParams: () => ({ tenantId: 't-1' }) };
});

vi.mock('react-i18next', () => ({
  // PhoneInput passes a string default as the 2nd t() arg; echo the key for
  // those, JSON-stringify object opts (count interpolation) as before. Also
  // expose i18n.language for PhoneInput's country-list localization.
  useTranslation: () => ({
    t: (k: string, opts?: any) =>
      opts && typeof opts === 'object' ? `${k}:${JSON.stringify(opts)}` : k,
    i18n: { language: 'tr' },
  }),
}));

const lookupAsync = vi.fn();
const cancelAsync = vi.fn();
let cancelPending = false;
vi.mock('../../features/reservations/publicReservationsApi', () => ({
  useLookupReservation: () => ({ mutateAsync: lookupAsync, isPending: false }),
  useCancelPublicReservation: () => ({ mutateAsync: cancelAsync, isPending: cancelPending }),
}));

// utils + parts are exercised with their real impls (already specced); they
// just format the reservation fields for display.
import ReservationLookupPage from './ReservationLookupPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <ReservationLookupPage />
    </MemoryRouter>,
  );
}

const reservation = {
  id: 'r-1',
  reservationNumber: 'RES-9',
  status: 'CONFIRMED',
  reservationDate: '2026-07-01',
  startTime: '2026-07-01T18:00:00.000Z',
  endTime: '2026-07-01T20:00:00.000Z',
  guestCount: 4,
  table: { number: '12', section: 'Patio' },
};

// Phone is now entered through the shared <PhoneInput>: its national-number
// field is the only type=tel input; typing a natural Turkish number emits
// canonical E.164. The reservation number is the type=text input.
const E164 = '+905551234567';
function fillAndSearch(phone = '0555 123 45 67', num = '  RES-9  ') {
  const telInput = document.querySelector('input[type="tel"]') as HTMLInputElement;
  const numInput = document.querySelector('input[type="text"]') as HTMLInputElement;
  fireEvent.change(telInput, { target: { value: phone } });
  fireEvent.change(numInput, { target: { value: num } });
  fireEvent.click(screen.getByText('lookup.search'));
}

beforeEach(() => {
  vi.clearAllMocks();
  cancelPending = false;
});

describe('ReservationLookupPage — search', () => {
  it('passes trimmed phone + reservation number to the lookup and renders the result', async () => {
    lookupAsync.mockResolvedValue(reservation);
    renderPage();
    fillAndSearch();

    await waitFor(() =>
      expect(lookupAsync).toHaveBeenCalledWith({ tenantId: 't-1', phone: E164, reservationNumber: 'RES-9' }),
    );
    await waitFor(() => expect(screen.getByText('RES-9')).toBeInTheDocument());
    // CONFIRMED status badge rendered via the status.* key.
    expect(screen.getByText('status.CONFIRMED')).toBeInTheDocument();
  });

  it('shows the not-found notice when the lookup rejects', async () => {
    lookupAsync.mockRejectedValue(new Error('404'));
    renderPage();
    fillAndSearch();
    await waitFor(() => expect(screen.getByText('lookup.notFound')).toBeInTheDocument());
  });
});

describe('ReservationLookupPage — cancel availability', () => {
  it('offers cancel for a CONFIRMED reservation', async () => {
    lookupAsync.mockResolvedValue(reservation);
    renderPage();
    fillAndSearch();
    await waitFor(() => expect(screen.getByText('lookup.cancel')).toBeInTheDocument());
  });

  it('does NOT offer cancel for a COMPLETED reservation', async () => {
    lookupAsync.mockResolvedValue({ ...reservation, status: 'COMPLETED' });
    renderPage();
    fillAndSearch();
    await waitFor(() => expect(screen.getByText('status.COMPLETED')).toBeInTheDocument());
    expect(screen.queryByText('lookup.cancel')).toBeNull();
  });
});

describe('ReservationLookupPage — cancel flow', () => {
  it('cancels and merges the server response into the displayed reservation', async () => {
    lookupAsync.mockResolvedValue(reservation);
    cancelAsync.mockResolvedValue({ status: 'CANCELLED' });
    renderPage();
    fillAndSearch();

    await waitFor(() => expect(screen.getByText('lookup.cancel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('lookup.cancel'));
    // Confirm dialog -> confirm.
    fireEvent.click(screen.getByText('lookup.confirmCancel'));

    await waitFor(() =>
      expect(cancelAsync).toHaveBeenCalledWith({
        tenantId: 't-1',
        id: 'r-1',
        customerPhone: E164,
        reservationNumber: 'RES-9',
      }),
    );
    await waitFor(() => expect(screen.getByText('status.CANCELLED')).toBeInTheDocument());
  });
});
