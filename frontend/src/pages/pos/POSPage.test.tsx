import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
vi.mock('../../components/pos/OrderCart', () => ({ default: () => <div data-testid="order-cart" /> }));
vi.mock('../../components/pos/PaymentModal', () => ({ default: () => <div data-testid="payment-modal" /> }));
vi.mock('../../components/pos/ProductOptionsModal', () => ({ default: () => null }));
vi.mock('../../components/pos/StickyCartBar', () => ({ default: () => <div data-testid="sticky-cart" /> }));
vi.mock('../../components/pos/CartDrawer', () => ({ default: () => null }));
vi.mock('../../components/pos/NotificationBar', () => ({ default: () => <div data-testid="notif-bar" /> }));
vi.mock('../../components/pos/AwaitingPaymentSection', () => ({ default: () => null }));
vi.mock('../../components/pos/PendingOrdersPanel', () => ({ default: () => null }));
vi.mock('../../components/pos/WaiterRequestsPanel', () => ({ default: () => null }));
vi.mock('../../components/pos/BillRequestsPanel', () => ({ default: () => null }));
vi.mock('../../components/pos/TransferTableModal', () => ({ default: () => null }));
vi.mock('../../components/pos/TableMergeModal', () => ({ default: () => null }));
vi.mock('../../components/pos/BillSplitModal', () => ({ default: () => null }));
vi.mock('../../components/pos/ProgressiveSplitModal', () => ({ default: () => null }));
vi.mock('../../components/pos/ReservationActionDialog', () => ({ default: () => null }));
vi.mock('../../components/pos/ManualLockDialog', () => ({ default: () => null }));
vi.mock('../../components/ui/Spinner', () => ({ default: () => <div data-testid="spinner" /> }));
// Heavy Konva live map — stub it (jsdom has no canvas, and its import chain
// pulls i18n/config which this test's react-i18next mock doesn't initialize).
vi.mock('../../features/floor-plan/components/LiveFloorMap', () => ({ default: () => <div data-testid="live-floor-map" /> }));

// --- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

// --- feature hooks: inert defaults --------------------------------------
let tablesResult: any;
vi.mock('../../features/orders/ordersApi', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    useCreateOrder: mutation,
    useUpdateOrder: mutation,
    useOrders: () => ({ data: [], isLoading: false }),
    useTransferTableOrders: mutation,
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
vi.mock('./useTableSelection', () => ({
  useTableSelection: () => ({
    handleSelectTable,
    handleReservationSeated: vi.fn(),
    handleManualLockOverride: vi.fn(),
    handleBackToTables: vi.fn(),
    handleTakeawayMode: vi.fn(),
  }),
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
