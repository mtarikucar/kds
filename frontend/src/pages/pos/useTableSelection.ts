import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import {
  TableStatus,
  OrderStatus,
  type Table,
  type Order,
  type UpcomingReservationOnTable,
} from '../../types';
import type { POSView, CartItem } from './posTypes';
import { mapOrderItemsToCart } from './posCart';

/**
 * Order/cart fields that a table-selection action resets when starting a
 * fresh order (or that the occupied-load effect populates when continuing an
 * existing one). These live in POSPage; the hook receives the setters so it
 * can drive the same transitions it did inline.
 */
export interface OrderStateActions {
  setCartItems: Dispatch<SetStateAction<CartItem[]>>;
  setDiscount: Dispatch<SetStateAction<number>>;
  setCustomerName: Dispatch<SetStateAction<string>>;
  setOrderNotes: Dispatch<SetStateAction<string>>;
  setCurrentOrderId: Dispatch<SetStateAction<string | null>>;
  setCurrentOrderAmount: Dispatch<SetStateAction<number | null>>;
}

interface UseTableSelectionArgs {
  /**
   * `selectedTable` state stays in POSPage because `useOrders` reads it to
   * build its query (which then feeds `tableOrders` back into this hook) —
   * owning it here would create a hook-boundary data cycle. The hook drives
   * the same transitions via the passed setter.
   */
  selectedTable: Table | null;
  setSelectedTable: Dispatch<SetStateAction<Table | null>>;
  /** Active orders for the selected table (drives the occupied-load effect). */
  tableOrders: Order[] | undefined;
  setCurrentView: Dispatch<SetStateAction<POSView>>;
  order: OrderStateActions;
  t: TFunction;
}

interface UseTableSelectionResult {
  reservationDialog: { table: Table; reservation: UpcomingReservationOnTable } | null;
  setReservationDialog: Dispatch<
    SetStateAction<{ table: Table; reservation: UpcomingReservationOnTable } | null>
  >;
  manualLockDialog: Table | null;
  setManualLockDialog: Dispatch<SetStateAction<Table | null>>;
  handleSelectTable: (table: Table) => void;
  handleReservationSeated: () => void;
  handleManualLockOverride: () => void;
  handleBackToTables: () => void;
  handleTakeawayMode: () => void;
}

/**
 * Table-selection, reservation-seat, and manual-lock-override flow.
 *
 * Extracted verbatim from POSPage. Owns `selectedTable`, the two RESERVED-
 * table dialogs, the skip-post-seat ref, and the occupied-table order-load
 * effect — exactly the state/effects that were inline. Cross-flow cart/order
 * resets are delegated to the passed `order` setters so behavior is identical.
 *
 * Preserved behavior:
 *  - AVAILABLE: toast an upcoming-reservation warning (still proceeds), then
 *    start a fresh order on the order screen.
 *  - OCCUPIED: clear cart and switch to order view; the load effect then
 *    repopulates from the existing PENDING/PREPARING order (or warns if the
 *    table is occupied with zero orders).
 *  - RESERVED: open the reservation dialog when auto-held (upcomingReservation
 *    present), else the manual-lock dialog.
 *  - reservation-seat: optimistic OCCUPIED flip + customerName prefill; sets
 *    the skip ref so the load effect doesn't emit a spurious no-orders warning.
 *  - manual-lock override: optimistic AVAILABLE flip, fresh empty order.
 *  - back: switch to table-selection, cart preserved.
 *  - takeaway: clear table + fresh order on the order screen.
 */
export function useTableSelection({
  selectedTable,
  setSelectedTable,
  tableOrders,
  setCurrentView,
  order,
  t,
}: UseTableSelectionArgs): UseTableSelectionResult {
  const [reservationDialog, setReservationDialog] = useState<{
    table: Table;
    reservation: UpcomingReservationOnTable;
  } | null>(null);

  const [manualLockDialog, setManualLockDialog] = useState<Table | null>(null);

  // Set right before flipping selectedTable → OCCUPIED via the seat path.
  // The OCCUPIED effect uses it to suppress the "occupied but no orders"
  // warning that would otherwise fire for a just-seated reservation.
  const skipPostSeatOrderEffectRef = useRef(false);

  const {
    setCartItems,
    setDiscount,
    setCustomerName,
    setOrderNotes,
    setCurrentOrderId,
    setCurrentOrderAmount,
  } = order;

  // Load existing orders when an occupied table is selected.
  useEffect(() => {
    if (skipPostSeatOrderEffectRef.current) {
      // Arrived here via the reservation-seat path. The seat flow already
      // cleared cart/customer state and the just-seated table has no orders
      // by definition — the "occupied but no orders" warning would mislead.
      skipPostSeatOrderEffectRef.current = false;
      return;
    }
    if (selectedTable?.status === TableStatus.OCCUPIED && tableOrders) {
      // Find the most recent editable order (only PENDING or PREPARING).
      // READY/SERVED orders should not be continued — a new order is created.
      const activeOrder = tableOrders.find(
        (o) =>
          o.status === OrderStatus.PENDING || o.status === OrderStatus.PREPARING,
      );

      if (activeOrder) {
        setCurrentOrderId(activeOrder.id);
        setCurrentOrderAmount(Number(activeOrder.finalAmount));

        const existingItems = mapOrderItemsToCart(activeOrder);

        setCartItems(existingItems);
        setDiscount(activeOrder.discount || 0);
        setCustomerName('');
        setOrderNotes(activeOrder.notes || '');

        toast.info(
          t('loadedExistingOrder', {
            orderNumber: activeOrder.orderNumber,
            count: existingItems.length,
          }),
        );
      } else if (tableOrders.length === 0) {
        // Marked occupied but no orders at all — unusual.
        toast.warning(t('tableOccupiedNoOrders'));
      }
      // Only READY/SERVED orders: no warning — AwaitingPaymentSection handles them.
    }
  }, [
    selectedTable,
    tableOrders,
    t,
    setCartItems,
    setDiscount,
    setCustomerName,
    setOrderNotes,
    setCurrentOrderId,
    setCurrentOrderAmount,
  ]);

  const handleSelectTable = (table: Table) => {
    if (table.status === TableStatus.AVAILABLE) {
      // Informational warning when the table has a reservation coming up in
      // the next ~2h. We still let the waiter proceed; the backend's overlap
      // guard hard-blocks checkout within 30 minutes of the booking.
      if (table.upcomingReservation) {
        const r = table.upcomingReservation;
        toast.warning(
          t('availableTableHasUpcomingReservation', {
            startTime: r.startTime,
            customerName: r.customerName,
            guestCount: r.guestCount,
          }),
        );
      }
      setSelectedTable(table);
      setCartItems([]);
      setDiscount(0);
      setCustomerName('');
      setOrderNotes('');
      setCurrentOrderId(null);
      setCurrentOrderAmount(null);
      setCurrentView('order');
    } else if (table.status === TableStatus.OCCUPIED) {
      setSelectedTable(table);
      // Clear cart first — the load effect will populate existing orders.
      setCartItems([]);
      setDiscount(0);
      setCustomerName('');
      setOrderNotes('');
      setCurrentView('order');
      toast.info(t('loadingExistingOrder'));
    } else {
      // RESERVED. Auto-held (upcomingReservation present) → reservation
      // dialog; manually RESERVED by admin → manual-lock override dialog.
      if (table.upcomingReservation) {
        setReservationDialog({ table, reservation: table.upcomingReservation });
      } else {
        setManualLockDialog(table);
      }
    }
  };

  const handleReservationSeated = useCallback(() => {
    const justSeated = reservationDialog;
    setReservationDialog(null);
    if (!justSeated) return;
    skipPostSeatOrderEffectRef.current = true;
    setSelectedTable({ ...justSeated.table, status: TableStatus.OCCUPIED });
    setCartItems([]);
    setDiscount(0);
    setCustomerName(justSeated.reservation.customerName);
    setOrderNotes('');
    setCurrentOrderId(null);
    setCurrentOrderAmount(null);
    setCurrentView('order');
  }, [
    reservationDialog,
    setCartItems,
    setDiscount,
    setCustomerName,
    setOrderNotes,
    setCurrentOrderId,
    setCurrentOrderAmount,
    setCurrentView,
  ]);

  const handleManualLockOverride = useCallback(() => {
    const justUnlocked = manualLockDialog;
    setManualLockDialog(null);
    if (!justUnlocked) return;
    setSelectedTable({ ...justUnlocked, status: TableStatus.AVAILABLE });
    setCartItems([]);
    setDiscount(0);
    setCustomerName('');
    setOrderNotes('');
    setCurrentOrderId(null);
    setCurrentOrderAmount(null);
    setCurrentView('order');
  }, [
    manualLockDialog,
    setCartItems,
    setDiscount,
    setCustomerName,
    setOrderNotes,
    setCurrentOrderId,
    setCurrentOrderAmount,
    setCurrentView,
  ]);

  // Back to table selection — cart is preserved.
  const handleBackToTables = () => {
    setCurrentView('table-selection');
  };

  // Takeaway mode — no table needed, fresh order.
  const handleTakeawayMode = () => {
    setSelectedTable(null);
    setCartItems([]);
    setDiscount(0);
    setCustomerName('');
    setOrderNotes('');
    setCurrentOrderId(null);
    setCurrentOrderAmount(null);
    setCurrentView('order');
  };

  return {
    reservationDialog,
    setReservationDialog,
    manualLockDialog,
    setManualLockDialog,
    handleSelectTable,
    handleReservationSeated,
    handleManualLockOverride,
    handleBackToTables,
    handleTakeawayMode,
  };
}
