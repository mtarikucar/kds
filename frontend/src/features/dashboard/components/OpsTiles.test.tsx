import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KitchenQueueTile, ApprovalsTile, CallsTile, ReservationsTile } from './OpsTiles';

vi.mock('../../orders/ordersApi', () => ({
  useOrders: (...args: unknown[]) => {
    globalThis.__useOrdersArgs = args;
    return globalThis.__orders;
  },
  usePendingOrders: () => globalThis.__pending,
  useWaiterRequests: () => globalThis.__waiterReqs,
  useBillRequests: () => globalThis.__billReqs,
}));
vi.mock('../../reservations/reservationsApi', () => ({
  useReservationStats: () => globalThis.__resStats,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => globalThis.__features.includes(k) }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && ('waiter' in opts || 'confirmed' in opts)
        ? `${k}:${JSON.stringify(opts)}`
        : k,
  }),
}));

declare global {
  /* eslint-disable no-var */
  var __orders: any;
  var __useOrdersArgs: any;
  var __pending: any;
  var __waiterReqs: any;
  var __billReqs: any;
  var __resStats: any;
  var __features: string[];
  /* eslint-enable no-var */
}

const renderIn = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('KitchenQueueTile', () => {
  it('shows per-status counts and polls every 30s', () => {
    globalThis.__orders = {
      data: [{ status: 'PENDING' }, { status: 'PENDING' }, { status: 'PREPARING' }, { status: 'READY' }],
      isLoading: false,
      isError: false,
    };
    renderIn(<KitchenQueueTile />);
    expect(screen.getByText('4')).toBeInTheDocument(); // total in queue
    expect(screen.getByText(/2 dashboard\.pending/)).toBeInTheDocument();
    expect(globalThis.__useOrdersArgs[0]).toEqual({ status: 'PENDING,PREPARING,READY' });
    expect(globalThis.__useOrdersArgs[1]).toMatchObject({ refetchInterval: 30_000 });
    expect(screen.getByTestId('ops-tile')).toHaveAttribute('href', '/kitchen');
  });

  it('renders nothing on error', () => {
    globalThis.__orders = { data: undefined, isLoading: false, isError: true };
    const { container } = renderIn(<KitchenQueueTile />);
    expect(container.firstChild?.firstChild ?? null).toBeNull();
  });
});

describe('ApprovalsTile', () => {
  it('links to /pos and uses alert tone when approvals wait', () => {
    globalThis.__pending = { data: [{ id: 'o1' }], isLoading: false, isError: false };
    renderIn(<ApprovalsTile />);
    const tile = screen.getByTestId('ops-tile');
    expect(tile).toHaveAttribute('href', '/pos');
    expect(tile.className).toContain('border-amber-300');
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});

describe('CallsTile', () => {
  it('sums waiter and bill requests', () => {
    globalThis.__waiterReqs = { data: [{ id: 'w1' }], isLoading: false, isError: false };
    globalThis.__billReqs = { data: [{ id: 'b1' }, { id: 'b2' }], isLoading: false, isError: false };
    renderIn(<CallsTile />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/"waiter":1/)).toBeInTheDocument();
    expect(screen.getByText(/"bill":2/)).toBeInTheDocument();
  });
});

describe('ReservationsTile', () => {
  it('renders nothing without the reservationSystem feature', () => {
    globalThis.__features = [];
    const { container } = renderIn(<ReservationsTile />);
    expect(container.firstChild?.firstChild ?? null).toBeNull();
  });

  it('shows confirmed+pending when entitled', () => {
    globalThis.__features = ['reservationSystem'];
    globalThis.__resStats = {
      data: { total: 6, pending: 2, confirmed: 4, seated: 0, completed: 0, cancelled: 0, noShow: 0, rejected: 0 },
      isLoading: false,
      isError: false,
    };
    renderIn(<ReservationsTile />);
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText(/"confirmed":4/)).toBeInTheDocument();
    expect(screen.getByTestId('ops-tile')).toHaveAttribute('href', '/admin/reservations');
  });
});
