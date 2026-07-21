import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableStatus, type Table } from '../../types';

/**
 * Specs for TableGrid — the POS floor grid cards. Data seams are
 * tablesApi (tables incl. the upcomingReservation annotation) and
 * ordersApi (per-table notification counts); both are stubbed. What we
 * pin: the amber upcoming-reservation chip (time + guest count, customer
 * name in the title/aria-label) renders ONLY when the annotation is
 * present, and the battle-tested card behavior around it (status badge,
 * notification badges, selection) is untouched.
 */

// i18next mocked inline; interpolating keys are resolved so we can
// assert the chip's actual "HH:mm · Np" payload rather than a bare key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (key === 'tableGrid.reservationChip') {
        return `${opts?.startTime} · ${opts?.guestCount}p`;
      }
      if (key === 'tableGrid.upcomingReservationTitle') {
        return `upcoming:${opts?.customerName}`;
      }
      return key;
    },
  }),
}));

let tablesResult: { data: Table[] | undefined; isLoading: boolean };
vi.mock('../../features/tables/tablesApi', () => ({
  useTables: () => tablesResult,
}));

let pendingOrders: any[] = [];
vi.mock('../../features/orders/ordersApi', () => ({
  usePendingOrders: () => ({ data: pendingOrders }),
  useWaiterRequests: () => ({ data: [] }),
  useBillRequests: () => ({ data: [] }),
}));

import TableGrid from './TableGrid';

const baseTable = (overrides: Partial<Table>): Table =>
  ({
    id: 't-1',
    number: '5',
    capacity: 4,
    status: TableStatus.AVAILABLE,
    ...overrides,
  }) as Table;

beforeEach(() => {
  vi.clearAllMocks();
  pendingOrders = [];
  tablesResult = { data: [], isLoading: false };
});

describe('TableGrid — upcoming-reservation chip', () => {
  it('renders the amber chip with start time + guest count and names the customer in title/aria-label', () => {
    tablesResult.data = [
      baseTable({
        status: TableStatus.RESERVED,
        upcomingReservation: {
          id: 'res-1',
          startTime: '19:00',
          endTime: '21:00',
          customerName: 'Ayşe Yılmaz',
          guestCount: 4,
          status: 'CONFIRMED',
          startsAt: '2026-07-22T16:00:00.000Z',
        },
      }),
    ];
    render(<TableGrid selectedTable={null} onSelectTable={vi.fn()} />);

    const chip = screen.getByText('19:00 · 4p');
    expect(chip).toBeInTheDocument();
    expect(chip.closest('span')).toHaveAttribute('title', 'upcoming:Ayşe Yılmaz');
    expect(chip.closest('span')).toHaveAttribute('aria-label', 'upcoming:Ayşe Yılmaz');
  });

  it('renders no chip when the table has no upcomingReservation', () => {
    tablesResult.data = [baseTable({ upcomingReservation: null })];
    render(<TableGrid selectedTable={null} onSelectTable={vi.fn()} />);

    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});

describe('TableGrid — existing card behavior stays intact', () => {
  it('still renders status badge + capacity and forwards taps to onSelectTable', () => {
    const onSelectTable = vi.fn();
    const table = baseTable({ status: TableStatus.OCCUPIED });
    tablesResult.data = [table];
    render(<TableGrid selectedTable={null} onSelectTable={onSelectTable} />);

    expect(screen.getByText('tableGrid.status.OCCUPIED')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    expect(onSelectTable).toHaveBeenCalledWith(table);
  });

  it('still shows the pending-order notification badge alongside the chip', () => {
    pendingOrders = [{ id: 'o-1', tableId: 't-1' }];
    tablesResult.data = [
      baseTable({
        upcomingReservation: {
          id: 'res-2',
          startTime: '20:30',
          endTime: '22:00',
          customerName: 'Mehmet Kaya',
          guestCount: 2,
          status: 'PENDING',
          startsAt: '2026-07-22T17:30:00.000Z',
        },
      }),
    ];
    render(<TableGrid selectedTable={null} onSelectTable={vi.fn()} />);

    expect(screen.getByText('20:30 · 2p')).toBeInTheDocument();
    expect(screen.getByText(/tableGrid.pendingOrder/)).toBeInTheDocument();
  });
});
