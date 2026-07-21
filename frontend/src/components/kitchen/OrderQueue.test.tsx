import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OrderQueue from './OrderQueue';
import { OrderStatus } from '../../types';

// Kitchen i18n bundle isn't loaded in the test setup; echo keys so the urgent
// badge is a stable selector. OrderCard's delivery moderation panel pulls in
// i18n/config, which calls `.use(initReactI18next)` at module load — expose it.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// OrderCard imports sonner for the cancel Undo toast; stub it so nothing
// reaches a real (absent) Toaster.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const NOW = new Date('2026-07-21T12:00:00.000Z');

function orderAgedMinutes(minutes: number, over: Partial<any> = {}): any {
  return {
    id: over.id ?? `o-${minutes}`,
    orderNumber: over.orderNumber ?? '1001',
    status: over.status ?? OrderStatus.PENDING,
    createdAt: new Date(NOW.getTime() - minutes * 60_000).toISOString(),
    orderItems: [{ id: `i-${minutes}`, quantity: 1, product: { name: 'Burger' } }],
    ...over,
  };
}

function renderQueue(status: OrderStatus, orders: any[]) {
  return render(
    <OrderQueue
      title="col-title"
      status={status}
      orders={orders}
      onUpdateStatus={vi.fn()}
    />
  );
}

describe('OrderQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the count badge for the orders matching the column status', () => {
    renderQueue(OrderStatus.PENDING, [
      orderAgedMinutes(1, { id: 'p1' }),
      orderAgedMinutes(2, { id: 'p2' }),
      orderAgedMinutes(3, { id: 'p3' }),
      orderAgedMinutes(4, { id: 'x1', status: OrderStatus.PREPARING }),
    ]);

    // 3 PENDING in the column; the PREPARING order is filtered out.
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders the live wait chip with the column average for a non-empty column', () => {
    // 4 min + 6 min → 5 min average. formatWaitTime pads seconds ('5m 00s'),
    // so this cannot collide with a card's elapsed-time badge ('4m 0s').
    renderQueue(OrderStatus.PENDING, [
      orderAgedMinutes(4, { id: 'p1' }),
      orderAgedMinutes(6, { id: 'p2' }),
    ]);

    expect(screen.getByText('5m 00s')).toBeInTheDocument();
  });

  it('omits the wait chip when the column is empty', () => {
    renderQueue(OrderStatus.READY, [orderAgedMinutes(4, { status: OrderStatus.PENDING })]);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+m \d{2}s$/)).toBeNull();
    expect(screen.queryByText(/^\d+s$/)).toBeNull();
  });

  it('shows the urgent badge only on the PENDING column', () => {
    // 20 min old → critical → urgent.
    renderQueue(OrderStatus.PENDING, [orderAgedMinutes(20)]);
    expect(screen.getByText(/kitchen\.stats\.urgent$/)).toBeInTheDocument();
  });

  it('never shows the urgent badge on non-PENDING columns, even with old orders', () => {
    renderQueue(OrderStatus.PREPARING, [
      orderAgedMinutes(20, { status: OrderStatus.PREPARING }),
    ]);

    expect(screen.queryByText(/kitchen\.stats\.urgent$/)).toBeNull();
  });
});
