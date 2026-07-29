import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';

/**
 * Specs for POSPage — the register orchestrator. Its heavy lifting lives
 * in already-unit-tested helpers (posCart, buildOrderData, posReceipt,
 * useCartPersistence, useTableSelection, usePosTourSync). What's left to
 * pin here is the top-level composition: the table-selection screen
 * renders the tables from useTables, each table button is wired to the
 * useTableSelection-provided handleSelectTable, and the loading spinner
 * shows while tables are in flight. We stub every child component + every
 * data/mutation hook so the page renders in isolation.
 */

// --- child components: lightweight stubs --------------------------------
vi.mock('../../components/pos/MenuPanel', () => ({ default: () => <div data-testid="menu-panel" /> }));
// OrderCart: expose onProgressivePay so the progressive-modal lifecycle spec
// can open the modal the way a cashier does.
vi.mock('../../components/pos/OrderCart', () => ({
  default: ({ onProgressivePay }: any) => (
    <div data-testid="order-cart">
      {onProgressivePay && (
        <button data-testid="open-progressive" onClick={onProgressivePay} />
      )}
    </div>
  ),
}));
// PaymentModal: expose onConfirm so the terminal-flow spec can fire a CARD
// payment (the stub renders regardless of isOpen — POSPage mounts it always).
vi.mock('../../components/pos/PaymentModal', () => ({
  default: ({ onConfirm }: any) => (
    <button
      data-testid="pay-card-confirm"
      onClick={() => onConfirm({ method: 'CARD' })}
    />
  ),
}));
vi.mock('../../components/pos/ProductOptionsModal', () => ({ default: () => null }));
vi.mock('../../components/pos/StickyCartBar', () => ({ default: () => <div data-testid="sticky-cart" /> }));
vi.mock('../../components/pos/CartDrawer', () => ({ default: () => null }));
vi.mock('../../components/pos/NotificationBar', () => ({ default: () => <div data-testid="notif-bar" /> }));
// DeliveryInboxButton: the persistent inbox opener (its own badge/count logic
// is pinned in DeliveryInboxButton.test.tsx — here we only pin the wiring).
vi.mock('../../components/pos/DeliveryInboxButton', () => ({
  default: ({ onOpen }: any) => (
    <button data-testid="delivery-inbox-btn" onClick={onOpen} />
  ),
}));
vi.mock('../../components/pos/AwaitingPaymentSection', () => ({ default: () => null }));
// PendingOrdersPanel: surface isOpen so the inbox-opener spec can assert the
// button actually opens the panel.
vi.mock('../../components/pos/PendingOrdersPanel', () => ({
  default: ({ isOpen }: any) =>
    isOpen ? <div data-testid="pending-orders-panel" /> : null,
}));
vi.mock('../../components/pos/WaiterRequestsPanel', () => ({ default: () => null }));
vi.mock('../../components/pos/BillRequestsPanel', () => ({ default: () => null }));
// TransferTableModal: expose onConfirm so the transfer spec can complete a
// transfer (the modal itself only renders while a table is selected).
vi.mock('../../components/pos/TransferTableModal', () => ({
  default: ({ onConfirm }: any) => (
    <button data-testid="transfer-confirm" onClick={() => onConfirm('tbl-2')} />
  ),
}));
vi.mock('../../components/pos/TableMergeModal', () => ({ default: () => null }));
vi.mock('../../components/pos/BillSplitModal', () => ({ default: () => null }));
// ProgressiveSplitModal: render a marker while open so the lifecycle spec can
// assert POSPage keeps it MOUNTED when the active-order list empties.
vi.mock('../../components/pos/ProgressiveSplitModal', () => ({
  default: ({ isOpen, orders }: any) =>
    isOpen ? (
      <div data-testid="progressive-modal" data-order-count={orders.length} />
    ) : null,
}));
vi.mock('../../components/pos/ReservationActionDialog', () => ({ default: () => null }));
vi.mock('../../components/pos/ManualLockDialog', () => ({ default: () => null }));
// TerminalChargeModal: surface the charge state POSPage passes down (status +
// chargeId) and the retry/cancel wires, so the poll-failure/retry specs can
// assert the ERROR state KEEPS the chargeId and Retry cancels before restarting.
vi.mock('../../components/pos/TerminalChargeModal', () => ({
  default: ({ charge, onRetry, onCancel }: any) =>
    charge ? (
      <div
        data-testid="terminal-modal"
        data-status={charge.status}
        data-charge-id={charge.chargeId ?? ''}
      >
        <button data-testid="terminal-retry" onClick={onRetry} />
        <button data-testid="terminal-cancel" onClick={onCancel} />
      </div>
    ) : null,
}));
vi.mock('../../components/ui/Spinner', () => ({ default: () => <div data-testid="spinner" /> }));
// Heavy Konva live map — stub it (jsdom has no canvas, and its import chain
// pulls i18n/config which this test's react-i18next mock doesn't initialize).
vi.mock('../../features/floor-plan/components/LiveFloorMap', () => ({ default: () => <div data-testid="live-floor-map" /> }));

// Payment terminal: controllable (defaults to inert in beforeEach — no active
// terminal → manual-card flow, no useQuery so the test needs no
// QueryClientProvider). The terminal-flow describe flips it active and drives
// the start/poll/cancel fns. isTerminalDone mirrors the real predicate.
let activeTerminalResult: any;
const startTerminalChargeMock = vi.fn();
const pollTerminalChargeMock = vi.fn();
const cancelTerminalChargeMock = vi.fn();
vi.mock('../../features/payment-terminal/paymentTerminalApi', () => ({
  useActiveTerminal: () => activeTerminalResult,
  startTerminalCharge: (...a: unknown[]) => startTerminalChargeMock(...a),
  pollTerminalCharge: (...a: unknown[]) => pollTerminalChargeMock(...a),
  cancelTerminalCharge: (...a: unknown[]) => cancelTerminalChargeMock(...a),
  isTerminalDone: (s: string) =>
    s === 'RECORDED' || s === 'DECLINED' || s === 'TIMEOUT' || s === 'ERROR' || s === 'CANCELLED',
}));

// --- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

// --- feature hooks: inert defaults --------------------------------------
let tablesResult: any;
// Transfer resolves synchronously so the transfer spec can drive the
// onSuccess reset path (view back to table-selection).
const transferTableOrdersMock = vi.fn(
  (_vars: any, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
);
vi.mock('../../features/orders/ordersApi', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    useCreateOrder: mutation,
    useUpdateOrder: mutation,
    useOrders: () => ({ data: [], isLoading: false }),
    useTransferTableOrders: () => ({
      mutate: transferTableOrdersMock,
      isPending: false,
    }),
    useSplitBill: mutation,
    useGroupBillSummary: () => ({ data: null }),
    useCreatePayment: mutation,
    usePendingOrders: () => ({ data: [] }),
    useWaiterRequests: () => ({ data: [] }),
    useBillRequests: () => ({ data: [] }),
  };
});
vi.mock('../../features/tables/tablesApi', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    useTables: () => tablesResult,
    useUpdateTableStatus: mutation,
    useMergeTables: mutation,
    useUnmergeTable: mutation,
    useUnmergeAll: mutation,
  };
});
vi.mock('../../features/pos/posApi', () => ({
  useGetPosSettings: () => ({ data: { enableTablelessMode: false } }),
}));
vi.mock('../../features/pos/usePosSocket', () => ({ usePosSocket: () => ({ isConnected: true }) }));

// --- local hooks ---------------------------------------------------------
vi.mock('./useCartPersistence', () => ({
  useCartPersistence: () => ({ cartItems: [], setCartItems: vi.fn() }),
}));
vi.mock('./usePosTourSync', () => ({ usePosTourSync: () => {} }));

const handleSelectTable = vi.fn();
// Capture the args POSPage hands to useTableSelection — they carry the page's
// state setters (setCurrentOrderId/-Amount), which the terminal-flow spec uses
// to put the page into a payable state without driving the whole cart UI.
let tableSelectionArgs: any;
vi.mock('./useTableSelection', () => ({
  useTableSelection: (args: any) => {
    tableSelectionArgs = args;
    return {
      handleSelectTable,
      handleReservationSeated: vi.fn(),
      handleManualLockOverride: vi.fn(),
      handleBackToTables: vi.fn(),
      handleTakeawayMode: vi.fn(),
    };
  },
}));

vi.mock('../../hooks/useResponsive', () => ({ useResponsive: () => ({ isDesktop: true }) }));
// POSPage now calls useFormatCurrency at top level (header total pill). The
// real hook reads i18n.language via useLocale, which the bare react-i18next
// mock above doesn't provide — stub it to a simple formatter.
vi.mock('../../hooks/useFormatCurrency', () => ({ useFormatCurrency: () => (n: number) => `₺${n}` }));
vi.mock('../../lib/tauri', () => ({ isTauri: () => false, HardwareService: {} }));
vi.mock('../../store/uiStore', () => ({ useUiStore: { getState: () => ({}) } }));

import POSPage from './POSPage';

beforeEach(() => {
  vi.clearAllMocks();
  activeTerminalResult = { data: { active: false } };
  tablesResult = {
    data: [
      { id: 'tbl-1', number: '1', status: 'AVAILABLE' },
      { id: 'tbl-2', number: '2', status: 'OCCUPIED' },
    ],
    isLoading: false,
  };
});

describe('POSPage — table selection screen', () => {
  it('renders the table-selection header and the notification bar', () => {
    render(<POSPage />);
    expect(screen.getByText('tableSelection.title')).toBeInTheDocument();
    expect(screen.getByTestId('notif-bar')).toBeInTheDocument();
  });

  it('renders a button per table from useTables', () => {
    render(<POSPage />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('wires a table button click to handleSelectTable with that table', () => {
    render(<POSPage />);
    fireEvent.click(screen.getByText('1').closest('button')!);
    expect(handleSelectTable).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tbl-1', number: '1' }),
    );
  });

  it('shows the spinner while tables are loading', () => {
    tablesResult = { data: undefined, isLoading: true };
    render(<POSPage />);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });
});

/** Drive the page into the order view with a selected table (the state the
 *  transfer/progressive flows start from), via the setters POSPage hands to
 *  the mocked useTableSelection. */
const enterOrderViewWithTable = () => {
  act(() => {
    tableSelectionArgs.setSelectedTable({
      id: 'tbl-1',
      number: '1',
      status: 'OCCUPIED',
      capacity: 4,
    });
    tableSelectionArgs.setCurrentView('order');
  });
};

describe('POSPage — persistent delivery inbox opener', () => {
  it('renders on the table-selection screen (even with zero notifications)', () => {
    render(<POSPage />);
    expect(screen.getByTestId('delivery-inbox-btn')).toBeInTheDocument();
  });

  it('renders on the order screen too', () => {
    render(<POSPage />);
    enterOrderViewWithTable();
    expect(screen.getByTestId('delivery-inbox-btn')).toBeInTheDocument();
  });

  it('opens the pending/delivery orders panel on click', () => {
    render(<POSPage />);
    expect(screen.queryByTestId('pending-orders-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delivery-inbox-btn'));
    expect(screen.getByTestId('pending-orders-panel')).toBeInTheDocument();
  });
});

describe('POSPage — table transfer', () => {
  it('returns to the table-selection view after a successful transfer', () => {
    render(<POSPage />);
    enterOrderViewWithTable();
    expect(screen.queryByText('tableSelection.title')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('transfer-confirm'));

    expect(transferTableOrdersMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceTableId: 'tbl-1', targetTableId: 'tbl-2' }),
      expect.anything(),
    );
    // Pre-fix: stayed on 'order' with no table — a "Takeaway order" header
    // whose Create is blocked by the no-table guard.
    expect(screen.getByText('tableSelection.title')).toBeInTheDocument();
  });
});

describe('POSPage — progressive split modal lifecycle', () => {
  it('keeps the OPEN modal mounted while the active-order list is empty (fullyPaid reachable)', () => {
    render(<POSPage />);
    enterOrderViewWithTable();

    // useOrders is mocked to an empty list — exactly the state after the
    // last order flips PAID and drops out of the status-filtered refetch.
    fireEvent.click(screen.getByTestId('open-progressive'));

    // Pre-fix: POSPage returned null here, unmounting the open modal the
    // moment the list emptied, so its fullyPaid confirmation never showed.
    const modal = screen.getByTestId('progressive-modal');
    expect(modal).toBeInTheDocument();
    expect(modal.dataset.orderCount).toBe('0');
  });
});

/**
 * Integrated card-terminal flow (money path). Pins the double-charge guards:
 * a mid-poll failure must KEEP the chargeId (so the still-live PENDING charge
 * stays cancellable), and Retry must cancel the prior charge BEFORE opening a
 * new one (a retry runs with a fresh idempotency key, so an un-cancelled prior
 * charge could settle alongside the new one).
 */
describe('POSPage — terminal charge retry safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    activeTerminalResult = { data: { active: true, simulator: true } };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Render, put the page into a payable state, fire a CARD payment whose
   *  START returns PENDING chg-1, then fail the first poll → ERROR state. */
  const driveToPollFailure = async () => {
    startTerminalChargeMock.mockResolvedValue({
      chargeId: 'chg-1',
      status: 'PENDING',
      error: null,
      orderId: 'o1',
      amount: 100,
    });
    pollTerminalChargeMock.mockRejectedValue({
      response: { data: { message: 'network blew up mid-poll' } },
    });
    render(<POSPage />);
    act(() => {
      tableSelectionArgs.order.setCurrentOrderId('o1');
      tableSelectionArgs.order.setCurrentOrderAmount(100);
    });
    fireEvent.click(screen.getByTestId('pay-card-confirm'));
    // Flush the START promise, then advance past the 2s poll delay so the
    // first (rejecting) poll runs and the catch path executes.
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
  };

  it('a mid-poll failure keeps the chargeId in the ERROR state (Cancel stays possible)', async () => {
    await driveToPollFailure();
    const modal = screen.getByTestId('terminal-modal');
    expect(modal.dataset.status).toBe('ERROR');
    expect(modal.dataset.chargeId).toBe('chg-1'); // pre-fix: '' (discarded)
    expect(startTerminalChargeMock).toHaveBeenCalledTimes(1);
  });

  it('Retry cancels the prior live charge BEFORE starting a new one', async () => {
    await driveToPollFailure();
    cancelTerminalChargeMock.mockResolvedValue({ status: 'CANCELLED' });
    startTerminalChargeMock.mockClear();
    startTerminalChargeMock.mockResolvedValue({
      chargeId: 'chg-2',
      status: 'DECLINED',
      error: 'declined',
      orderId: 'o1',
      amount: 100,
    });
    fireEvent.click(screen.getByTestId('terminal-retry'));
    await act(async () => {});
    expect(cancelTerminalChargeMock).toHaveBeenCalledWith('o1', 'chg-1');
    expect(startTerminalChargeMock).toHaveBeenCalledTimes(1);
    expect(cancelTerminalChargeMock.mock.invocationCallOrder[0]).toBeLessThan(
      startTerminalChargeMock.mock.invocationCallOrder[0],
    );
    // The new attempt settled DECLINED and is on screen with ITS id.
    const modal = screen.getByTestId('terminal-modal');
    expect(modal.dataset.status).toBe('DECLINED');
    expect(modal.dataset.chargeId).toBe('chg-2');
  });

  it('Retry still starts (with a warning toast) when cancelling the prior charge fails', async () => {
    await driveToPollFailure();
    cancelTerminalChargeMock.mockRejectedValue(new Error('bridge offline'));
    startTerminalChargeMock.mockClear();
    startTerminalChargeMock.mockResolvedValue({
      chargeId: 'chg-3',
      status: 'DECLINED',
      error: 'declined',
      orderId: 'o1',
      amount: 100,
    });
    fireEvent.click(screen.getByTestId('terminal-retry'));
    await act(async () => {});
    expect(cancelTerminalChargeMock).toHaveBeenCalledWith('o1', 'chg-1');
    expect(toast.warning).toHaveBeenCalled();
    // The retry proceeds — the backend START guard is the hard stop for a
    // still-live duplicate (it 409s), surfaced through the same ERROR path.
    expect(startTerminalChargeMock).toHaveBeenCalledTimes(1);
  });
});
