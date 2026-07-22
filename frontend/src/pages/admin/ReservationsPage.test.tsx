import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import i18next from 'i18next';
import enReservations from '../../i18n/locales/en/reservations.json';

/**
 * ReservationsPage overhaul specs. Dates are pinned to 2026-07-22 (only
 * `Date` is faked so react/testing-library timers stay real). The data hooks
 * are house-mocked so `useReservations` returns a DIFFERENT dataset per view
 * tab — keyed off the params the page passes (status+dateFrom = Bekleyenler,
 * dateTo = Yaklaşan, otherwise the Gün query).
 */

const h = vi.hoisted(() => ({
  isLoading: false,
  dayData: undefined as any,
  pendingData: undefined as any,
  upcomingData: undefined as any,
  stats: { total: 0, pending: 0, confirmed: 0, seated: 0 },
  settings: { defaultDuration: 90 },
  pendingCount: 0,
  tables: [] as any[],
  slots: [] as any[],
  availTables: [] as any[],
  confirm: vi.fn(),
  reject: vi.fn(),
  seat: vi.fn(),
  complete: vi.fn(),
  noShow: vi.fn(),
  cancel: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  lastListParams: undefined as any,
}));

vi.mock('../../features/reservations/reservationsApi', () => ({
  useReservations: (params: any) => {
    h.lastListParams = params;
    let data;
    if (params?.status === 'PENDING' && params?.dateFrom) data = h.pendingData;
    else if (params?.dateTo) data = h.upcomingData;
    else data = h.dayData;
    return { data, isLoading: h.isLoading };
  },
  useReservationStats: () => ({ data: h.stats }),
  useReservationSettings: () => ({ data: h.settings }),
  usePendingReservationCount: () => ({ data: { count: h.pendingCount } }),
  useConfirmReservation: () => ({ mutate: h.confirm, isPending: false }),
  useRejectReservation: () => ({ mutate: h.reject, isPending: false }),
  useSeatReservation: () => ({ mutate: h.seat, isPending: false }),
  useCompleteReservation: () => ({ mutate: h.complete, isPending: false }),
  useNoShowReservation: () => ({ mutate: h.noShow, isPending: false }),
  useCancelReservation: () => ({ mutate: h.cancel, isPending: false }),
  useUpdateReservation: () => ({ mutate: h.update, isPending: false }),
  useCreateReservation: () => ({ mutate: h.create, isPending: false }),
}));

vi.mock('../../features/reservations/useReservationsSocket', () => ({
  useReservationsSocket: () => {},
}));

vi.mock('../../features/reservations/publicReservationsApi', () => ({
  useAvailableSlots: () => ({ data: h.slots }),
  useAvailableTables: () => ({ data: h.availTables }),
}));

vi.mock('../../features/tables/tablesApi', () => ({
  useTables: () => ({ data: h.tables }),
}));

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector({ user: { tenantId: 't-1' } }),
}));

vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (selector: (s: any) => unknown) => selector({ branchId: 'b-1' }),
}));

// Feature gate is server-enforced; render children directly in tests.
vi.mock('../../components/subscriptions/FeatureGate', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ReservationsPage from './ReservationsPage';

function res(overrides: Record<string, unknown>) {
  return {
    id: 'r',
    reservationNumber: '1000',
    date: '2026-07-22T00:00:00.000Z',
    startTime: '19:00',
    endTime: '20:30',
    guestCount: 2,
    status: 'CONFIRMED',
    customerName: 'Guest',
    customerPhone: '111',
    tenantId: 't-1',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  if (!i18next.hasResourceBundle('en', 'reservations')) {
    i18next.addResourceBundle('en', 'reservations', enReservations, true, true);
  }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-22T10:00:00Z'));
  h.isLoading = false;
  h.dayData = undefined;
  h.pendingData = undefined;
  h.upcomingData = undefined;
  h.pendingCount = 0;
  h.tables = [];
  h.slots = [];
  h.availTables = [];
  h.confirm.mockReset();
  h.reject.mockReset();
  h.create.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReservationsPage — Gün (day) view', () => {
  it('defaults to today and renders the day list', () => {
    h.dayData = {
      data: [res({ id: 'd1', customerName: 'Day Guest', status: 'CONFIRMED' })],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    };
    render(<ReservationsPage />);

    // Gün tab is the default; the native date picker sits on today (UTC).
    const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-07-22');
    expect(h.lastListParams).toMatchObject({ date: '2026-07-22' });
    expect(screen.getByText('Day Guest')).toBeInTheDocument();
  });
});

describe('ReservationsPage — Bekleyenler (pending) view', () => {
  beforeEach(() => {
    h.pendingCount = 2;
    // Server returns date asc, startTime asc → already soonest-first.
    h.pendingData = {
      data: [
        res({ id: 'p1', customerName: 'Soonest', status: 'PENDING', date: '2026-07-22T00:00:00.000Z', startTime: '12:00' }),
        res({ id: 'p2', customerName: 'Later', status: 'PENDING', date: '2026-07-25T00:00:00.000Z', startTime: '20:00' }),
      ],
      meta: { total: 2, page: 1, limit: 20, totalPages: 1 },
    };
  });

  it('lists cross-date pending soonest-first and queries dateFrom=today,status=PENDING', () => {
    render(<ReservationsPage />);
    fireEvent.click(screen.getByTestId('viewtab-pending'));

    expect(h.lastListParams).toMatchObject({ dateFrom: '2026-07-22', status: 'PENDING' });

    const rows = screen.getAllByTestId('pending-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Soonest')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Later')).toBeInTheDocument();
  });

  it('one-tap Onayla confirms that reservation', () => {
    render(<ReservationsPage />);
    fireEvent.click(screen.getByTestId('viewtab-pending'));

    const rows = screen.getAllByTestId('pending-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Confirm' }));
    expect(h.confirm).toHaveBeenCalledWith('p1');
  });

  it('Reddet collects a reason and sends it as rejectionReason', () => {
    render(<ReservationsPage />);
    fireEvent.click(screen.getByTestId('viewtab-pending'));

    const rows = screen.getAllByTestId('pending-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Reject' }));

    // Reject modal opens with a reason field.
    const reason = screen.getByPlaceholderText('Write a reason to share with the guest...');
    fireEvent.change(reason, { target: { value: 'fully booked' } });
    fireEvent.click(screen.getByTestId('reject-submit'));

    expect(h.reject).toHaveBeenCalledTimes(1);
    expect(h.reject.mock.calls[0][0]).toEqual({ id: 'p1', rejectionReason: 'fully booked' });
  });
});

describe('ReservationsPage — Yeni Rezervasyon (create) modal', () => {
  it('submits a staff-create PHONE payload', () => {
    h.dayData = { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
    render(<ReservationsPage />);

    fireEvent.click(screen.getByTestId('new-reservation-btn'));
    const dialog = screen.getByRole('dialog');

    // Switch the time field to manual entry, then fill the required fields.
    fireEvent.click(within(dialog).getByText('Enter time manually'));
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '19:00' } });
    fireEvent.change(within(dialog).getByLabelText('Full Name'), { target: { value: 'Phone Guest' } });
    fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '555' } });

    fireEvent.click(screen.getByTestId('create-submit'));

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0]).toMatchObject({
      source: 'PHONE',
      date: '2026-07-22',
      startTime: '19:00',
      endTime: '20:30',
      guestCount: 2,
      customerName: 'Phone Guest',
      customerPhone: '555',
    });
  });

  it('blocks a PHONE create with no contact details', () => {
    h.dayData = { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
    render(<ReservationsPage />);

    fireEvent.click(screen.getByTestId('new-reservation-btn'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Enter time manually'));
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '19:00' } });
    fireEvent.change(within(dialog).getByLabelText('Full Name'), { target: { value: 'No Contact' } });

    fireEvent.click(screen.getByTestId('create-submit'));

    expect(h.create).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId('create-error')).toHaveTextContent(
      'A phone or email is required for a phone reservation',
    );
  });
});
