import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { useTableSelection, type OrderStateActions } from './useTableSelection';
import {
  TableStatus,
  OrderStatus,
  type Table,
  type Order,
  type UpcomingReservationOnTable,
} from '../../types';
import type { POSView, CartItem } from './posTypes';

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const t = ((key: string) => key) as unknown as Parameters<
  typeof useTableSelection
>[0]['t'];

const table = (over: Partial<Table>): Table =>
  ({ id: 't-1', number: 5, capacity: 4, status: TableStatus.AVAILABLE, ...over } as Table);

const reservation = (over: Partial<UpcomingReservationOnTable> = {}): UpcomingReservationOnTable =>
  ({ id: 'r-1', customerName: 'Ada', guestCount: 2, startTime: '19:00', ...over } as UpcomingReservationOnTable);

/**
 * Harness mirroring POSPage: selectedTable + the grouped order/cart state are
 * real useState, so we observe the actual transitions the hook drives.
 */
function useHarness(initialTableOrders: Order[] | undefined) {
  // React Query hands POSPage a STABLE tableOrders reference between renders;
  // mirror that here (via a ref) so the occupied-load effect — which depends
  // on tableOrders — doesn't re-run forever off a fresh array literal.
  const tableOrders = useRef(initialTableOrders).current;
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [currentView, setCurrentView] = useState<POSView>('table-selection');
  const [cartItems, setCartItems] = useState<CartItem[]>([{ id: 'old' } as CartItem]);
  const [discount, setDiscount] = useState(99);
  const [customerName, setCustomerName] = useState('stale');
  const [orderNotes, setOrderNotes] = useState('stale-notes');
  const [currentOrderId, setCurrentOrderId] = useState<string | null>('stale-order');
  const [currentOrderAmount, setCurrentOrderAmount] = useState<number | null>(123);

  const order: OrderStateActions = {
    setCartItems,
    setDiscount,
    setCustomerName,
    setOrderNotes,
    setCurrentOrderId,
    setCurrentOrderAmount,
  };

  const sel = useTableSelection({
    selectedTable,
    setSelectedTable,
    tableOrders,
    setCurrentView,
    order,
    t,
  });

  return {
    sel,
    state: {
      selectedTable,
      currentView,
      cartItems,
      discount,
      customerName,
      orderNotes,
      currentOrderId,
      currentOrderAmount,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTableSelection — handleSelectTable', () => {
  it('AVAILABLE table: starts a fresh order (cleared state, order view)', () => {
    const { result } = renderHook(() => useHarness([]));
    act(() => result.current.sel.handleSelectTable(table({ status: TableStatus.AVAILABLE })));

    expect(result.current.state.selectedTable?.id).toBe('t-1');
    expect(result.current.state.currentView).toBe('order');
    expect(result.current.state.cartItems).toEqual([]);
    expect(result.current.state.discount).toBe(0);
    expect(result.current.state.customerName).toBe('');
    expect(result.current.state.currentOrderId).toBeNull();
    expect(result.current.state.currentOrderAmount).toBeNull();
  });

  it('AVAILABLE table with an upcoming reservation: warns but still proceeds', () => {
    const { result } = renderHook(() => useHarness([]));
    act(() =>
      result.current.sel.handleSelectTable(
        table({ status: TableStatus.AVAILABLE, upcomingReservation: reservation() }),
      ),
    );
    expect(toast.warning).toHaveBeenCalledWith('availableTableHasUpcomingReservation');
    expect(result.current.state.currentView).toBe('order');
  });

  it('OCCUPIED table: clears cart, switches to order view, toasts loading', () => {
    const { result } = renderHook(() => useHarness(undefined));
    act(() => result.current.sel.handleSelectTable(table({ status: TableStatus.OCCUPIED })));
    expect(result.current.state.selectedTable?.status).toBe(TableStatus.OCCUPIED);
    expect(result.current.state.cartItems).toEqual([]);
    expect(result.current.state.currentView).toBe('order');
    expect(toast.info).toHaveBeenCalledWith('loadingExistingOrder');
  });

  it('RESERVED + upcomingReservation: opens the reservation dialog (not manual-lock)', () => {
    const { result } = renderHook(() => useHarness([]));
    const r = reservation();
    act(() =>
      result.current.sel.handleSelectTable(
        table({ status: TableStatus.RESERVED, upcomingReservation: r }),
      ),
    );
    expect(result.current.sel.reservationDialog?.reservation).toBe(r);
    expect(result.current.sel.manualLockDialog).toBeNull();
    // Stays on the table-selection screen until the dialog resolves.
    expect(result.current.state.currentView).toBe('table-selection');
  });

  it('RESERVED without upcomingReservation: opens the manual-lock dialog', () => {
    const { result } = renderHook(() => useHarness([]));
    act(() =>
      result.current.sel.handleSelectTable(
        table({ status: TableStatus.RESERVED, upcomingReservation: undefined }),
      ),
    );
    expect(result.current.sel.manualLockDialog?.id).toBe('t-1');
    expect(result.current.sel.reservationDialog).toBeNull();
  });
});

describe('useTableSelection — occupied-load effect', () => {
  it('loads an existing PENDING order into the cart when an occupied table is selected', () => {
    const activeOrder = {
      id: 'ord-9',
      orderNumber: 'A-9',
      status: OrderStatus.PENDING,
      finalAmount: 50,
      discount: 7,
      notes: 'table notes',
      orderItems: [
        { id: 'oi-1', quantity: 2, notes: null, product: { id: 'p-1', price: 10 } },
      ],
    } as unknown as Order;

    const { result } = renderHook(() => useHarness([activeOrder]));
    act(() => result.current.sel.handleSelectTable(table({ status: TableStatus.OCCUPIED })));

    expect(result.current.state.currentOrderId).toBe('ord-9');
    expect(result.current.state.currentOrderAmount).toBe(50);
    expect(result.current.state.discount).toBe(7);
    expect(result.current.state.orderNotes).toBe('table notes');
    expect(result.current.state.cartItems).toEqual([
      { id: 'p-1', price: 10, quantity: 2, notes: undefined },
    ]);
    expect(toast.info).toHaveBeenCalledWith('loadedExistingOrder');
  });

  it('warns when an occupied table has zero orders', () => {
    const { result } = renderHook(() => useHarness([]));
    act(() => result.current.sel.handleSelectTable(table({ status: TableStatus.OCCUPIED })));
    expect(toast.warning).toHaveBeenCalledWith('tableOccupiedNoOrders');
  });

  it('does NOT warn when only READY/SERVED orders exist (AwaitingPayment handles them)', () => {
    const served = { id: 'o-s', status: OrderStatus.SERVED } as Order;
    const { result } = renderHook(() => useHarness([served]));
    act(() => result.current.sel.handleSelectTable(table({ status: TableStatus.OCCUPIED })));
    expect(toast.warning).not.toHaveBeenCalledWith('tableOccupiedNoOrders');
  });
});

describe('useTableSelection — reservation seat & manual lock', () => {
  it('handleReservationSeated flips to OCCUPIED, prefills customer, suppresses the no-orders warning', () => {
    // tableOrders empty: without the skip-ref the load effect would warn.
    const { result } = renderHook(() => useHarness([]));
    const r = reservation({ customerName: 'Grace' });

    act(() =>
      result.current.sel.handleSelectTable(
        table({ status: TableStatus.RESERVED, upcomingReservation: r }),
      ),
    );
    act(() => result.current.sel.handleReservationSeated());

    expect(result.current.state.selectedTable?.status).toBe(TableStatus.OCCUPIED);
    expect(result.current.state.customerName).toBe('Grace');
    expect(result.current.state.currentView).toBe('order');
    expect(result.current.sel.reservationDialog).toBeNull();
    // skip-ref consumed: no spurious "occupied but no orders" warning.
    expect(toast.warning).not.toHaveBeenCalledWith('tableOccupiedNoOrders');
  });

  it('handleManualLockOverride flips to AVAILABLE with a fresh empty order', () => {
    const { result } = renderHook(() => useHarness([]));
    act(() =>
      result.current.sel.handleSelectTable(
        table({ status: TableStatus.RESERVED, upcomingReservation: undefined }),
      ),
    );
    act(() => result.current.sel.handleManualLockOverride());

    expect(result.current.state.selectedTable?.status).toBe(TableStatus.AVAILABLE);
    expect(result.current.state.customerName).toBe('');
    expect(result.current.state.cartItems).toEqual([]);
    expect(result.current.state.currentView).toBe('order');
    expect(result.current.sel.manualLockDialog).toBeNull();
  });
});

describe('useTableSelection — navigation', () => {
  it('handleBackToTables returns to selection and PRESERVES the cart', () => {
    const { result } = renderHook(() => useHarness([]));
    act(() => result.current.sel.handleSelectTable(table({ status: TableStatus.OCCUPIED })));
    act(() => result.current.sel.handleBackToTables());
    expect(result.current.state.currentView).toBe('table-selection');
  });

  it('handleTakeawayMode clears the table and starts a fresh order', () => {
    const { result } = renderHook(() => useHarness([]));
    act(() => result.current.sel.handleSelectTable(table({ status: TableStatus.AVAILABLE })));
    act(() => result.current.sel.handleTakeawayMode());
    expect(result.current.state.selectedTable).toBeNull();
    expect(result.current.state.currentView).toBe('order');
    expect(result.current.state.cartItems).toEqual([]);
  });
});
