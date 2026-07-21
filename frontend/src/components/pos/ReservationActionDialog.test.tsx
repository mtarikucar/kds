import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * Specs for ReservationActionDialog — the RESERVED-table action modal.
 * The mutation seam is features/reservations/reservationsApi (seat /
 * no-show / cancel hooks own all cache invalidation + toasts); we stub
 * the three hooks and pin the wiring: Seat stays primary and bubbles
 * onSeated, No-Show and Cancel sit behind an inline confirm sub-step,
 * every success path closes the dialog, and NO close path works while
 * a mutation is in flight.
 */

// i18next mocked inline so we assert stable keys.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Modal stub exposes its onClose so the in-flight close-block is testable.
vi.mock('../ui/Modal', () => ({
  default: ({ isOpen, onClose, children, title }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button data-testid="modal-close" onClick={onClose} />
        {children}
      </div>
    ) : null,
}));

const seatMutate = vi.fn();
const noShowMutate = vi.fn();
const cancelMutate = vi.fn();
let seatPending = false;
let noShowPending = false;
let cancelPending = false;
vi.mock('../../features/reservations/reservationsApi', () => ({
  useSeatReservation: () => ({ mutate: seatMutate, isPending: seatPending }),
  useNoShowReservation: () => ({ mutate: noShowMutate, isPending: noShowPending }),
  useCancelReservation: () => ({ mutate: cancelMutate, isPending: cancelPending }),
}));

import ReservationActionDialog from './ReservationActionDialog';

const reservation = {
  id: 'res-1',
  startTime: '19:00',
  endTime: '21:00',
  customerName: 'Ayşe Yılmaz',
  guestCount: 4,
  status: 'CONFIRMED',
  startsAt: '2026-07-22T16:00:00.000Z',
};

function renderDialog(overrides: Partial<{ onClose: () => void; onSeated: () => void }> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onSeated = overrides.onSeated ?? vi.fn();
  render(
    <ReservationActionDialog
      isOpen
      onClose={onClose}
      reservation={reservation}
      tableNumber="M5"
      onSeated={onSeated}
    />,
  );
  return { onClose, onSeated };
}

beforeEach(() => {
  vi.clearAllMocks();
  seatPending = false;
  noShowPending = false;
  cancelPending = false;
});

describe('ReservationActionDialog — default footer', () => {
  it('renders details plus Seat (primary), No-Show, Cancel-reservation and Close actions', () => {
    renderDialog();

    expect(screen.getByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.getByText('19:00 — 21:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'reservationDialog.seatButton' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'reservationDialog.noShowButton' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'reservationDialog.cancelReservationButton' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'reservationDialog.closeButton' })).toBeInTheDocument();
    // No confirm sub-step until an action is picked.
    expect(screen.queryByText('reservationDialog.noShowConfirmPrompt')).not.toBeInTheDocument();
    expect(screen.queryByText('reservationDialog.cancelConfirmPrompt')).not.toBeInTheDocument();
  });

  it('Seat mutates with the reservation id and bubbles onSeated on success (dialog stays parent-controlled)', () => {
    const { onClose, onSeated } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'reservationDialog.seatButton' }));
    expect(seatMutate).toHaveBeenCalledWith('res-1', expect.any(Object));

    seatMutate.mock.calls[0][1].onSuccess();
    expect(onSeated).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); // POSPage closes via its onSeated handler
  });
});

describe('ReservationActionDialog — no-show confirm sub-step', () => {
  it('does not mutate until the inline confirm is accepted, then closes on success', () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'reservationDialog.noShowButton' }));
    expect(noShowMutate).not.toHaveBeenCalled();
    expect(screen.getByText('reservationDialog.noShowConfirmPrompt')).toBeInTheDocument();
    // Footer is replaced — Seat is out of reach mid-confirm.
    expect(screen.queryByRole('button', { name: 'reservationDialog.seatButton' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'reservationDialog.confirmNoShowButton' }));
    expect(noShowMutate).toHaveBeenCalledWith('res-1', expect.any(Object));

    noShowMutate.mock.calls[0][1].onSuccess();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Back returns to the action footer without mutating', () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'reservationDialog.noShowButton' }));
    fireEvent.click(screen.getByRole('button', { name: 'reservationDialog.backButton' }));

    expect(noShowMutate).not.toHaveBeenCalled();
    expect(screen.queryByText('reservationDialog.noShowConfirmPrompt')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'reservationDialog.seatButton' })).toBeInTheDocument();
  });
});

describe('ReservationActionDialog — cancel confirm sub-step', () => {
  it('confirms then mutates and closes on success', () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'reservationDialog.cancelReservationButton' }));
    expect(cancelMutate).not.toHaveBeenCalled();
    expect(screen.getByText('reservationDialog.cancelConfirmPrompt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'reservationDialog.confirmCancelButton' }));
    expect(cancelMutate).toHaveBeenCalledWith('res-1', expect.any(Object));

    cancelMutate.mock.calls[0][1].onSuccess();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ReservationActionDialog — in-flight close blocking', () => {
  it.each([
    ['seat', () => (seatPending = true)],
    ['no-show', () => (noShowPending = true)],
    ['cancel', () => (cancelPending = true)],
  ])('refuses backdrop/Escape closes while the %s PATCH is in flight', (_label, setPending) => {
    setPending();
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByTestId('modal-close'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes normally when nothing is in flight', () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByTestId('modal-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
