import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KitchenDisplayPage from './KitchenDisplayPage';
import { OrderStatus } from '../../types';

// Kitchen i18n bundle isn't loaded in the test setup; echo keys so action
// labels are stable selectors (kitchen.actions.startPreparing, etc.).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // The KDS order card now renders the delivery moderation panel, whose
  // action-hooks file imports i18n/config (the codebase norm), which calls
  // `.use(initReactI18next)` at module load — so this mock must expose it too.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// --- orders/kds api hooks (the real data + mutation layer) ---
const ordersData: any[] = [];
const updateOrderStatus = vi.fn();
const cancelOrder = vi.fn();
const refetch = vi.fn();

vi.mock('../../features/orders/ordersApi', () => ({
  useOrders: () => ({ data: ordersData, refetch, isLoading: false }),
  useUpdateOrderStatus: () => ({ mutate: updateOrderStatus }),
  useCancelKdsOrder: () => ({ mutate: cancelOrder }),
}));

// Socket: assert the connected flag flows to the stats header without a
// real ws connection.
vi.mock('../../features/kds/useKitchenSocket', () => ({
  useKitchenSocket: () => ({ isConnected: true }),
}));

// OrderCard fires a sonner Undo toast after a confirmed cancel; capture it
// so the toast doesn't reach a real (absent) Toaster.
const toastFn = vi.fn();
const toastWarning = vi.fn();
const toastDismiss = vi.fn();
vi.mock('sonner', () => ({
  toast: Object.assign((...a: unknown[]) => toastFn(...a), {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    // deep-review FM5: OrderCard dismisses a pending Undo toast on unmount and
    // KitchenDisplayPage warns when a deferred cancel commits on a no-longer
    // PENDING order — stub both so the toast never reaches a real Toaster.
    warning: (...a: unknown[]) => toastWarning(...a),
    dismiss: (...a: unknown[]) => toastDismiss(...a),
  }),
}));

// Stats header is a presentational child with its own time logic — stub it
// to a probe that surfaces the order count + connection status.
vi.mock('../../components/kitchen/KitchenStatsHeader', () => ({
  default: ({ orders, isConnected, onRefresh }: any) => (
    <div data-testid="stats-header">
      count:{orders.length}:conn:{String(isConnected)}
      <button onClick={onRefresh}>refresh-probe</button>
    </div>
  ),
}));

function makeOrder(over: Partial<any>): any {
  return {
    id: over.id ?? 'o1',
    orderNumber: over.orderNumber ?? '1001',
    status: over.status ?? OrderStatus.PENDING,
    createdAt: over.createdAt ?? new Date().toISOString(),
    orderItems: over.orderItems ?? [
      { id: 'i1', quantity: 2, product: { name: 'Burger' } },
    ],
    ...over,
  };
}

describe('KitchenDisplayPage', () => {
  beforeEach(() => {
    ordersData.length = 0;
    updateOrderStatus.mockClear();
    cancelOrder.mockClear();
    refetch.mockClear();
    toastFn.mockClear();
    toastWarning.mockClear();
    toastDismiss.mockClear();
  });

  it('renders order data into the stats header and the pending column card', () => {
    ordersData.push(
      makeOrder({ id: 'p1', orderNumber: '1001', status: OrderStatus.PENDING }),
    );

    render(<KitchenDisplayPage />);

    expect(screen.getByTestId('stats-header')).toHaveTextContent(
      'count:1:conn:true',
    );
    // Order number renders in the desktop pending column.
    expect(screen.getAllByText('#1001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Burger').length).toBeGreaterThan(0);
  });

  it('advances a PENDING order to PREPARING with the exact mutation shape', () => {
    ordersData.push(
      makeOrder({ id: 'pend-1', orderNumber: '1001', status: OrderStatus.PENDING }),
    );

    render(<KitchenDisplayPage />);

    // The desktop grid + mobile list both render the action; grab the
    // first "start preparing" button.
    const startButtons = screen.getAllByRole('button', {
      name: 'kitchen.actions.startPreparing',
    });
    fireEvent.click(startButtons[0]);

    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    const [vars] = updateOrderStatus.mock.calls[0];
    expect(vars).toEqual({
      id: 'pend-1',
      data: { status: OrderStatus.PREPARING },
    });
  });

  it('advances a PREPARING order to READY', () => {
    ordersData.push(
      makeOrder({ id: 'prep-1', orderNumber: '2002', status: OrderStatus.PREPARING }),
    );

    render(<KitchenDisplayPage />);

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'kitchen.actions.markReady',
      })[0],
    );

    const [vars] = updateOrderStatus.mock.calls[0];
    expect(vars).toEqual({
      id: 'prep-1',
      data: { status: OrderStatus.READY },
    });
  });

  it('advances a READY order to SERVED', () => {
    ordersData.push(
      makeOrder({ id: 'ready-1', orderNumber: '3003', status: OrderStatus.READY }),
    );

    render(<KitchenDisplayPage />);

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'kitchen.actions.markServed',
      })[0],
    );

    const [vars] = updateOrderStatus.mock.calls[0];
    expect(vars).toEqual({
      id: 'ready-1',
      data: { status: OrderStatus.SERVED },
    });
  });

  it('defers the kds cancel behind an Undo window and only commits on toast timeout', () => {
    ordersData.push(
      makeOrder({ id: 'pend-9', orderNumber: '4004', status: OrderStatus.PENDING }),
    );

    render(<KitchenDisplayPage />);

    // Open the first card's "more options" dropdown, then arm the cancel.
    const moreButtons = screen.getAllByRole('button', {
      name: 'kitchen.moreOptions',
    });
    fireEvent.click(moreButtons[0]);

    const cancelItem = screen.getByText('kitchen.cancelOrder');
    fireEvent.click(cancelItem);

    // Arming the cancel does NOT yet fire the mutation — confirmation first.
    expect(cancelOrder).not.toHaveBeenCalled();

    // Confirm "Evet" → shows the Undo toast but does NOT send the cancel yet
    // (CANCELLED is terminal server-side; the only safe undo is to defer).
    fireEvent.click(screen.getAllByText('kitchen.confirmYes')[0]);
    expect(toastFn).toHaveBeenCalledTimes(1);
    expect(cancelOrder).not.toHaveBeenCalled();

    // The toast naturally timing out (no Undo) commits the cancel.
    const opts = toastFn.mock.calls[0][1] as { onAutoClose: () => void };
    opts.onAutoClose();
    expect(cancelOrder).toHaveBeenCalledTimes(1);
    expect(cancelOrder.mock.calls[0][0]).toBe('pend-9');
    // Cancel must NOT fire a status update (no CANCELLED→PENDING flip).
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it('does NOT commit a deferred cancel if the order is no longer PENDING at commit time (deep-review FM5)', () => {
    const order = makeOrder({ id: 'pend-stale', orderNumber: '6006', status: OrderStatus.PENDING });
    ordersData.push(order);

    render(<KitchenDisplayPage />);

    fireEvent.click(screen.getAllByRole('button', { name: 'kitchen.moreOptions' })[0]);
    fireEvent.click(screen.getByText('kitchen.cancelOrder'));
    fireEvent.click(screen.getAllByText('kitchen.confirmYes')[0]);
    expect(toastFn).toHaveBeenCalledTimes(1);

    // Another station advances the order during the Undo window: the cache
    // (same live ordersData reference returned by useOrders) flips off PENDING.
    order.status = OrderStatus.PREPARING;

    // The toast times out and tries to commit — the parent's status gate must
    // bail (no cancel, a warning instead) so work-in-progress isn't voided.
    const opts = toastFn.mock.calls[0][1] as { onAutoClose: () => void };
    opts.onAutoClose();

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it('aborts the cancel when "Geri al" (undo) is tapped before the window elapses', () => {
    ordersData.push(
      makeOrder({ id: 'pend-9', orderNumber: '4004', status: OrderStatus.PENDING }),
    );

    render(<KitchenDisplayPage />);

    fireEvent.click(screen.getAllByRole('button', { name: 'kitchen.moreOptions' })[0]);
    fireEvent.click(screen.getByText('kitchen.cancelOrder'));
    fireEvent.click(screen.getAllByText('kitchen.confirmYes')[0]);

    // Tap Undo, then let the toast close → cancel must never be sent.
    const opts = toastFn.mock.calls[0][1] as {
      action: { onClick: () => void };
      onAutoClose: () => void;
    };
    opts.action.onClick();
    opts.onAutoClose();
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it('aborts a cancel when the confirm step is declined', () => {
    ordersData.push(
      makeOrder({ id: 'pend-7', orderNumber: '5005', status: OrderStatus.PENDING }),
    );

    render(<KitchenDisplayPage />);

    fireEvent.click(
      screen.getAllByRole('button', { name: 'kitchen.moreOptions' })[0],
    );
    fireEvent.click(screen.getByText('kitchen.cancelOrder'));
    // Decline with "Hayır".
    fireEvent.click(screen.getAllByText('kitchen.confirmNo')[0]);

    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('calls refetch when the stats header refresh is invoked', () => {
    render(<KitchenDisplayPage />);
    // Empty state: no orders → count:0, no crash.
    expect(screen.getByTestId('stats-header')).toHaveTextContent('count:0');

    fireEvent.click(screen.getByText('refresh-probe'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
