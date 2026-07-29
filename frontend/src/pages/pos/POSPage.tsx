import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ShoppingBag, ArrowRight, Users, Clock, User, Receipt, LayoutGrid, Map as MapIcon, CalendarClock } from 'lucide-react';
import LiveFloorMap from '../../features/floor-plan/components/LiveFloorMap';
import MenuPanel from '../../components/pos/MenuPanel';
import OrderCart from '../../components/pos/OrderCart';
import PaymentModal from '../../components/pos/PaymentModal';
import ProductOptionsModal, { SelectedModifier } from '../../components/pos/ProductOptionsModal';
import StickyCartBar from '../../components/pos/StickyCartBar';
import CartDrawer from '../../components/pos/CartDrawer';
import DeliveryInboxButton from '../../components/pos/DeliveryInboxButton';
import NotificationBar from '../../components/pos/NotificationBar';
import AwaitingPaymentSection from '../../components/pos/AwaitingPaymentSection';
import PendingOrdersPanel from '../../components/pos/PendingOrdersPanel';
import WaiterRequestsPanel from '../../components/pos/WaiterRequestsPanel';
import BillRequestsPanel from '../../components/pos/BillRequestsPanel';
import { useCreateOrder, useUpdateOrder, useOrders, useTransferTableOrders, useSplitBill, useGroupBillSummary } from '../../features/orders/ordersApi';
import { useCreatePayment, usePendingOrders, useWaiterRequests, useBillRequests } from '../../features/orders/ordersApi';
import TransferTableModal from '../../components/pos/TransferTableModal';
import TableMergeModal from '../../components/pos/TableMergeModal';
import BillSplitModal from '../../components/pos/BillSplitModal';
import ProgressiveSplitModal from '../../components/pos/ProgressiveSplitModal';
import ReservationActionDialog from '../../components/pos/ReservationActionDialog';
import ManualLockDialog from '../../components/pos/ManualLockDialog';
import { useTables, useUpdateTableStatus, useMergeTables, useUnmergeTable, useUnmergeAll } from '../../features/tables/tablesApi';
import { useGetPosSettings } from '../../features/pos/posApi';
import { usePosSocket } from '../../features/pos/usePosSocket';
import { Product, Table, TableStatus, OrderStatus, SplitType, SplitPaymentEntry, Payment, ComboSelectionInput } from '../../types';
import { useResponsive, BREAKPOINTS } from '../../hooks/useResponsive';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import Spinner from '../../components/ui/Spinner';
import { HardwareService, isTauri } from '../../lib/tauri';
import { useUiStore } from '../../store/uiStore';
import {
  calculateSubtotal,
  canProceedToPayment as computeCanProceedToPayment,
  paymentBlockedReason as computePaymentBlockedReason,
  resolvePaymentTarget,
  hasRemainingUnpaidOrders,
  mergeCartItem,
  normalizeCartLines,
  orderRemainingDue,
  removeLine,
  stepProductLine,
  updateLineQuantity,
} from './posCart';
import { useCartPersistence } from './useCartPersistence';
import { usePosTourSync } from './usePosTourSync';
import { runReceiptSideEffects } from './posReceipt';
import { buildOrderData } from './buildOrderData';
import { useTableSelection } from './useTableSelection';
import type { POSView, CartItem } from './posTypes';
import TerminalChargeModal from '../../components/pos/TerminalChargeModal';
import {
  useActiveTerminal,
  startTerminalCharge,
  pollTerminalCharge,
  cancelTerminalCharge,
  isTerminalDone,
  type TerminalChargeView,
} from '../../features/payment-terminal/paymentTerminalApi';

const POSPage = () => {
  const { t } = useTranslation('pos');
  const formatPrice = useFormatCurrency();

  // View state: table-selection or order
  const [currentView, setCurrentView] = useState<POSView>('table-selection');
  // Table-selection layout: classic grid, or the live 2D floor map.
  const [tableViewMode, setTableViewMode] = useState<'grid' | 'map'>('grid');

  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  // Cart persisted in localStorage so an accidental tab close / refresh
  // doesn't wipe an in-progress order. The per-user key shape
  // (`pos_cart::<tenantId>::<userId>`, v2.8.97), the 12h TTL, and the
  // legacy-key migration all live in useCartPersistence (unit-tested).
  // normalizeCartLines backfills lineId on carts persisted pre-line-identity.
  const { cartItems, setCartItems } = useCartPersistence<CartItem>(normalizeCartLines);
  const [discount, setDiscount] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [currentOrderAmount, setCurrentOrderAmount] = useState<number | null>(null);
  // deep-review FH2: tracks whether the cart/discount/notes diverged from the
  // persisted order since it was last created/updated. While dirty, the
  // two-step "Proceed to Payment" path must re-persist (and re-price) instead
  // of charging the stale server amount. Set on every bill-affecting mutation
  // (below), cleared on every successful create/update + on order clear/reset.
  const [cartDirtySinceOrder, setCartDirtySinceOrder] = useState(false);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [payingOrderAmount, setPayingOrderAmount] = useState<number | null>(null);
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const [isPendingOrdersPanelOpen, setIsPendingOrdersPanelOpen] = useState(false);
  const [isWaiterRequestsPanelOpen, setIsWaiterRequestsPanelOpen] = useState(false);
  const [isBillRequestsPanelOpen, setIsBillRequestsPanelOpen] = useState(false);
  const [isProductOptionsModalOpen, setIsProductOptionsModalOpen] = useState(false);
  const [productForOptions, setProductForOptions] = useState<Product | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isBillSplitModalOpen, setIsBillSplitModalOpen] = useState(false);
  const [isProgressiveModalOpen, setIsProgressiveModalOpen] = useState(false);

  // Integrated card terminal: when this branch drives a terminal, a CARD
  // payment is charged on-device (the manual-card flow is untouched otherwise).
  // `terminalCharge` is the on-screen attempt — null when no charge is active.
  // It carries the original `target` so Retry can re-run and Cancel knows the
  // order. `chargeId` is set once the START has returned (needed for cancel).
  const { data: activeTerminal } = useActiveTerminal();
  const [terminalCharge, setTerminalCharge] = useState<{
    status: TerminalChargeView['status'];
    error: string | null;
    chargeId: string | null;
    target: { orderId: string; amount: number; wasExistingOrderPayment: boolean };
  } | null>(null);

  // Responsive hook. `width` lets us pick the POS split threshold independently
  // of the shared `isDesktop` (>=1024) flag: landscape tablets (>=768/md) now
  // get the side-by-side menu+cart layout instead of falling back to the mobile
  // drawer. Phones (<768) keep the drawer. `width` may be undefined under the
  // POSPage unit test (which stubs useResponsive); we fall back to isDesktop.
  const { isDesktop, width } = useResponsive();
  const useSideBySideLayout =
    typeof width === 'number' ? width >= BREAKPOINTS.md : isDesktop;

  // A device rotating/resizing from the drawer band (<md) into the
  // side-by-side band (>=md) would otherwise leave the cart drawer open WHILE
  // the side panel also renders the cart — two carts plus a stuck body
  // scroll-lock. Close the drawer whenever the side-by-side layout activates.
  useEffect(() => {
    if (useSideBySideLayout && isCartDrawerOpen) setIsCartDrawerOpen(false);
  }, [useSideBySideLayout, isCartDrawerOpen]);

  // deep-review FH2: whenever the active order identity changes — a new order
  // is created/loaded (e.g. selecting an OCCUPIED table) or the order is
  // cleared — the cart is freshly synced to the server, so it is no longer
  // dirty. This also prevents a stale `true` from a prior table carrying over
  // when the cashier switches tables (the table-selection reset lives in
  // useTableSelection, which has no handle on this flag).
  useEffect(() => {
    setCartDirtySinceOrder(false);
  }, [currentOrderId]);

  // Socket.IO for real-time updates
  usePosSocket();

  // Fetch POS settings
  const { data: posSettings } = useGetPosSettings();

  // Fetch tables and notifications for table selection screen
  const { data: tables, isLoading: isLoadingTables } = useTables();
  const { data: pendingOrders = [] } = usePendingOrders();
  const { data: waiterRequests = [] } = useWaiterRequests();
  const { data: billRequests = [] } = useBillRequests();

  // Get notifications for a specific table
  const getTableNotifications = useCallback((tableId: string) => {
    const orders = pendingOrders.filter(order => order.tableId === tableId).length;
    const waiter = waiterRequests.filter(req => req.tableId === tableId).length;
    const bill = billRequests.filter(req => req.tableId === tableId).length;
    return { orders, waiter, bill };
  }, [pendingOrders, waiterRequests, billRequests]);

  const { mutate: createOrder, isPending: isCreatingOrder } = useCreateOrder();
  const { mutate: updateOrder, isPending: isUpdatingOrder } = useUpdateOrder();
  const { mutate: createPayment, isPending: isCreatingPayment } = useCreatePayment();
  const { mutate: updateTableStatus } = useUpdateTableStatus();
  const { mutate: transferTableOrders, isPending: isTransferring } = useTransferTableOrders();
  const { mutate: mergeTables, isPending: isMerging } = useMergeTables();
  const { mutate: unmergeTable, isPending: isUnmergingTable } = useUnmergeTable();
  const { mutate: unmergeAll, isPending: isUnmergingAll } = useUnmergeAll();
  const { mutate: splitBill, isPending: isSplitting } = useSplitBill();

  // Determine if tableless mode is enabled
  const isTablelessMode = posSettings?.enableTablelessMode ?? false;
  const isTwoStepCheckout = posSettings?.enableTwoStepCheckout ?? false;

  // Auto-enable takeaway mode when tableless mode is active
  useEffect(() => {
    if (isTablelessMode) {
      setSelectedTable(null);
      setCurrentView('order');
    }
  }, [isTablelessMode]);

  // Onboarding tour preview: force into 'order' view (takeaway shape) while
  // tour steps targeting menu-panel/order-cart are active, then restore the
  // previous view. Logic lives in usePosTourSync.
  usePosTourSync(currentView, setCurrentView, setSelectedTable);

  // Fetch active orders for selected table (exclude pending approval, paid, and cancelled)
  const { data: tableOrders, refetch: refetchOrders } = useOrders(
    selectedTable
      ? {
          tableId: selectedTable.id,
          status: [
            OrderStatus.PENDING,
            OrderStatus.PREPARING,
            OrderStatus.READY,
            OrderStatus.SERVED,
          ].join(','),
        }
      : undefined
  );

  // Filter READY or SERVED orders awaiting payment
  const readyOrServedOrders = tableOrders?.filter(
    (order) => order.status === OrderStatus.SERVED || order.status === OrderStatus.READY
  ) || [];

  // When the selected table is part of a merged group, pull the
  // group-wide order list so the progressive-payment tab strip can
  // surface every table's open orders, not just the one we clicked.
  // Hook fires only when groupId is non-null (handled by enabled:!!).
  const { data: groupSummary } = useGroupBillSummary(selectedTable?.groupId ?? null);

  // Find the current order for payment eligibility check
  const currentOrder = useMemo(() => {
    if (!currentOrderId || !tableOrders) return null;
    return tableOrders.find((o) => o.id === currentOrderId) || null;
  }, [currentOrderId, tableOrders]);

  // Live payable amounts. `currentOrderAmount`/`payingOrderAmount` are
  // snapshots captured when the order was created/loaded or when "collect
  // payment" was tapped; a socket-driven `tableOrders` refetch (another
  // cashier adding items, a QR top-up) never re-synced them, so the modal
  // could charge a stale-low total — the backend accepts any amount ≤
  // remaining and records a silent PARTIAL payment. Resolve against the
  // freshest server row at render, falling back to the snapshot only while
  // the live row isn't loaded. The live amount is the REMAINING due
  // (finalAmount − COMPLETED payments), not the gross total: after a
  // partial/progressive payment the backend rejects anything above the
  // remainder, so charging finalAmount would dead-end the settle-up.
  const liveCurrentOrderAmount = currentOrder
    ? orderRemainingDue(currentOrder)
    : currentOrderAmount;
  const livePayingOrderAmount = useMemo(() => {
    if (!payingOrderId) return payingOrderAmount;
    const live = tableOrders?.find((o) => o.id === payingOrderId);
    return live ? orderRemainingDue(live) : payingOrderAmount;
  }, [payingOrderId, payingOrderAmount, tableOrders]);

  // Payment eligibility calculation for two-step checkout. The gate logic
  // (order-type + dine-in requireServed) is the pure computeCanProceedToPayment
  // in posCart.ts; kept inside a useMemo so referential identity is unchanged.
  const canProceedToPayment = useMemo(
    () =>
      computeCanProceedToPayment({
        currentOrderId,
        currentOrder,
        requireServedForDineInPayment: !!posSettings?.requireServedForDineInPayment,
      }),
    [currentOrderId, currentOrder, posSettings?.requireServedForDineInPayment],
  );

  // Reason why payment is blocked (for user feedback)
  const paymentBlockedReason = useMemo(
    () =>
      computePaymentBlockedReason({
        currentOrderId,
        currentOrder,
        requireServedForDineInPayment: !!posSettings?.requireServedForDineInPayment,
      }),
    [currentOrderId, currentOrder, posSettings?.requireServedForDineInPayment],
  );

  // Table-selection / reservation-seat / manual-lock-override flow + the
  // occupied-table order-load effect. `selectedTable` state stays here (above,
  // feeding useOrders); the hook drives it via setSelectedTable. The grouped
  // `order` setters are the cart/order fields a selection action resets.
  const {
    reservationDialog,
    setReservationDialog,
    manualLockDialog,
    setManualLockDialog,
    handleSelectTable,
    handleReservationSeated,
    handleManualLockOverride,
    handleBackToTables,
    handleTakeawayMode,
  } = useTableSelection({
    selectedTable,
    setSelectedTable,
    tableOrders,
    setCurrentView,
    order: {
      setCartItems,
      setDiscount,
      setCustomerName,
      setOrderNotes,
      setCurrentOrderId,
      setCurrentOrderAmount,
    },
    t,
  });

  const handleAddItem = (product: Product) => {
    // In tableless mode, table selection is optional
    if (!isTablelessMode && !selectedTable) {
  toast.error(t('selectTableFirst'));
      return;
    }

    // Check if product has required modifiers
    const hasRequiredModifiers = product.modifierGroups?.some(
      group => group.isRequired || group.minSelections > 0
    );

    // A combo must open the options modal so the cashier picks each slot; a
    // blind add can't collect the required component selections.
    if (product.productType === 'COMBO' || hasRequiredModifiers) {
      // Open options modal for modifier / combo selection
      setProductForOptions(product);
      setIsProductOptionsModalOpen(true);
      return;
    }

    // No required modifiers - add directly to cart
    addItemToCart(product, 1, []);
  };

  // deep-review FH2: flag the cart as diverged from the persisted order. No-op
  // when no order exists yet (the first create captures the current cart). Used
  // to force a re-persist before the two-step payment modal opens.
  const markCartDirty = useCallback(() => {
    if (currentOrderId) setCartDirtySinceOrder(true);
  }, [currentOrderId]);

  const addItemToCart = (
    product: Product,
    quantity: number,
    modifiers: SelectedModifier[],
    comboSelections?: ComboSelectionInput[],
  ) => {
    // Dedup/merge rule (same product + same modifier set + same combo picks →
    // increment) lives in posCart.mergeCartItem (unit-tested).
    setCartItems((prev) =>
      mergeCartItem(prev, product, quantity, modifiers, comboSelections),
    );
    markCartDirty();
  };

  const handleAddItemWithModifiers = (
    product: Product,
    quantity: number,
    modifiers: SelectedModifier[],
    comboSelections?: ComboSelectionInput[],
  ) => {
    addItemToCart(product, quantity, modifiers, comboSelections);
    setIsProductOptionsModalOpen(false);
    setProductForOptions(null);
  };

  // Line ops target lineId (product + modifiers + combo picks), NOT the bare
  // product id — two lines of the same product with different modifiers are
  // distinct bills, and a product-id match updated/removed every one of them.
  const handleUpdateQuantity = (lineId: string, quantity: number) => {
    if (quantity < 1) return;
    setCartItems((prev) => updateLineQuantity(prev, lineId, quantity));
    markCartDirty();
  };

  const handleRemoveItem = (lineId: string) => {
    setCartItems((prev) => removeLine(prev, lineId));
    markCartDirty();
  };

  // In-cart quantity per product id (summed across lines) for the MenuPanel
  // card badges. Built from the live cart so the badge tracks adds/removes.
  const cartQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of cartItems) {
      map[item.id] = (map[item.id] ?? 0) + item.quantity;
    }
    return map;
  }, [cartItems]);

  // Inline +/- from a MenuPanel card. Only wired for non-modifier items (the
  // panel hides the steppers for required-modifier products/combos), which
  // merge into a single plain line. stepProductLine resolves that ONE line
  // (never a sibling modifier line a reopened order may have added).
  const handleMenuIncrement = (productId: string) => {
    setCartItems((prev) => stepProductLine(prev, productId, 1));
    markCartDirty();
  };

  const handleMenuDecrement = (productId: string) => {
    setCartItems((prev) => stepProductLine(prev, productId, -1));
    markCartDirty();
  };

  // deep-review FH2: discount/notes edits also change the bill → mark dirty so
  // the two-step payment path re-persists before charging.
  const handleUpdateDiscount = (value: number) => {
    setDiscount(value);
    markCartDirty();
  };

  const handleUpdateOrderNotes = (notes: string) => {
    setOrderNotes(notes);
    markCartDirty();
  };

  const handleClearCart = () => {
    setCartItems([]);
    setDiscount(0);
    setCartDirtySinceOrder(false);
  };

  // Create or update order (for two-step checkout)
  const handleCreateOrder = () => {
    // In tableless mode, table is optional
    if (!isTablelessMode && !selectedTable) {
  toast.error(t('selectTable'));
      return;
    }

    if (cartItems.length === 0) {
  toast.error(t('cartEmpty'));
      return;
    }

    // deep-review FL3: never submit a discount larger than the live subtotal.
    const orderData = buildOrderData({
      isTablelessMode,
      selectedTable,
      customerName,
      orderNotes,
      discount: Math.max(0, Math.min(discount, calculateSubtotal(cartItems))),
      cartItems,
    });

    // Update existing order if currentOrderId exists, otherwise create new
    if (currentOrderId) {
      updateOrder(
        {
          id: currentOrderId,
          data: orderData,
        },
        {
          onSuccess: (order) => {
            setCurrentOrderAmount(Number(order.finalAmount));
            setCartDirtySinceOrder(false); // deep-review FH2
            toast.success(t('orderUpdated'));
          },
        }
      );
    } else {
      // Create new order
      createOrder(
        orderData,
        {
          onSuccess: (order) => {
            setCurrentOrderId(order.id);
            setCurrentOrderAmount(Number(order.finalAmount));
            setCartDirtySinceOrder(false); // deep-review FH2
            toast.success(t('orderCreatedSuccess', { orderNumber: order.orderNumber }));

            // Mark table as occupied after successful order creation (if table mode)
            if (selectedTable && selectedTable.status === TableStatus.AVAILABLE) {
              updateTableStatus({
                id: selectedTable.id,
                status: TableStatus.OCCUPIED,
              });
            }
          },
        }
      );
    }
  };

  // Checkout (create order + open payment modal for single-step, or just open payment for two-step)
  const handleCheckout = () => {
    // In tableless mode, table is optional
    if (!isTablelessMode && !selectedTable) {
  toast.error(t('selectTable'));
      return;
    }

    if (cartItems.length === 0) {
  toast.error(t('cartEmpty'));
      return;
    }

    // deep-review FH2: in two-step checkout, only short-circuit straight to the
    // payment modal when the cart has NOT diverged from the saved order. If the
    // cashier added items / changed the discount after the order was created,
    // we must fall through to the updateOrder path below — which persists the
    // edits and opens payment with the authoritative server finalAmount —
    // otherwise we'd charge the stale amount and drop the new items from the
    // bill and kitchen ticket.
    if (isTwoStepCheckout && currentOrderId && !cartDirtySinceOrder) {
      setIsPaymentModalOpen(true);
      return;
    }

    // deep-review FL3: never submit a discount larger than the live subtotal.
    const orderData = buildOrderData({
      isTablelessMode,
      selectedTable,
      customerName,
      orderNotes,
      discount: Math.max(0, Math.min(discount, calculateSubtotal(cartItems))),
      cartItems,
    });

    // Update existing order if currentOrderId exists, otherwise create new
    if (currentOrderId) {
      updateOrder(
        {
          id: currentOrderId,
          data: orderData,
        },
        {
          onSuccess: (order) => {
            setCurrentOrderAmount(Number(order.finalAmount));
            setCartDirtySinceOrder(false);
            setIsPaymentModalOpen(true);
            toast.success(t('orderUpdated'));
          },
        }
      );
    } else {
      // Create new order
      createOrder(
        orderData,
        {
          onSuccess: (order) => {
            setCurrentOrderId(order.id);
            setCurrentOrderAmount(Number(order.finalAmount));
            setCartDirtySinceOrder(false); // deep-review FH2
            setIsPaymentModalOpen(true);

            // Mark table as occupied after successful order creation (if table mode)
            if (selectedTable && selectedTable.status === TableStatus.AVAILABLE) {
              updateTableStatus({
                id: selectedTable.id,
                status: TableStatus.OCCUPIED,
              });
            }
          },
        }
      );
    }
  };

  // Handle collecting payment from SERVED orders
  const handleCollectPayment = (orderId: string, amount: number) => {
    setPayingOrderId(orderId);
    setPayingOrderAmount(amount);
    setIsPaymentModalOpen(true);
  };

  // ── Integrated card terminal (charge BEFORE record) ───────────────────
  // On RECORDED the backend has ALREADY written the Payment via the money-safe
  // rail (PaymentsService.create), so we only finalize the UI here — mirroring
  // the manual onSuccess table-release race guard (refetch → re-check remaining
  // → free table). DECLINED/ERROR/TIMEOUT keep the order open for retry.
  const startCardTerminalCharge = async (target: {
    orderId: string;
    amount: number;
    wasExistingOrderPayment: boolean;
  }) => {
    setTerminalCharge({ status: 'PENDING', error: null, chargeId: null, target });
    // Track the id locally too: the catch below must NOT lose it when a
    // mid-poll failure lands — an ERROR state without the id would make the
    // still-live PENDING charge uncancellable from the modal.
    let knownChargeId: string | null = null;
    try {
      let view = await startTerminalCharge(
        target.orderId,
        target.amount,
        crypto.randomUUID(),
      );
      knownChargeId = view.chargeId;
      // Surface the id as soon as START returns so Cancel can abort the
      // still-pending charge server-side (not just dismiss the modal).
      setTerminalCharge((prev) =>
        prev ? { ...prev, chargeId: view.chargeId } : prev,
      );
      // In-process providers (simulator) resolve on START; bridge providers
      // return PENDING — poll up to ~90s while the cashier taps the card.
      for (let i = 0; i < 45 && !isTerminalDone(view.status); i++) {
        await new Promise((r) => setTimeout(r, 2000));
        view = await pollTerminalCharge(target.orderId, view.chargeId);
      }
      if (view.status === 'RECORDED') {
        setTerminalCharge(null);
        const refreshed = await refetchOrders();
        const freshOrders = refreshed.data ?? tableOrders ?? [];
        setIsPaymentModalOpen(false);
        setPayingOrderId(null);
        setPayingOrderAmount(null);
        const hasRemainingOrders = hasRemainingUnpaidOrders(freshOrders);
        if (!hasRemainingOrders && selectedTable) {
          updateTableStatus({ id: selectedTable.id, status: TableStatus.AVAILABLE });
        }
        if (!target.wasExistingOrderPayment) {
          setCurrentOrderId(null);
          setCurrentOrderAmount(null);
          setSelectedTable(null);
          setCartItems([]);
          setDiscount(0);
          setCustomerName('');
          setOrderNotes('');
          setCartDirtySinceOrder(false);
        }
        toast.success(t('orderCompletedSuccess'));
      } else if (view.status !== 'CANCELLED') {
        // Not approved/recorded — surface the bank reason; order stays open.
        // CANCELLED is skipped: the operator already dismissed the modal via
        // Cancel, so re-opening it to a cancelled state would just flicker.
        // If the loop exhausted while still PENDING (a bridge terminal that
        // never acked within ~90s), present it as TIMEOUT so the operator gets
        // Retry/Close instead of a frozen spinner. The order stays open and the
        // non-retryable command may still settle — the recovery sweep records
        // it if it ultimately APPROVED.
        const settled = isTerminalDone(view.status) ? view.status : 'TIMEOUT';
        setTerminalCharge({
          status: settled,
          error: view.error,
          chargeId: view.chargeId,
          target,
        });
      }
    } catch (e: any) {
      setTerminalCharge({
        status: 'ERROR',
        error: e?.response?.data?.message ?? t('orderPaymentFailed', 'Ödeme başarısız'),
        // Keep the id from the failed attempt: the charge may still be live
        // (PENDING) server-side, so Cancel must stay possible and Retry must
        // be able to abort it before opening a new one.
        chargeId: knownChargeId,
        target,
      });
    }
  };

  // Abort a still-pending charge (bridge terminals). The poll loop sees the
  // CANCELLED status on its next tick and stops; we also close the modal now.
  const handleTerminalCancel = async () => {
    if (terminalCharge?.chargeId) {
      try {
        await cancelTerminalCharge(terminalCharge.target.orderId, terminalCharge.chargeId);
      } catch {
        // Best-effort — if the cancel races a settle, the poll loop reflects it.
      }
    }
    setTerminalCharge(null);
  };

  const handleTerminalRetry = async () => {
    if (!terminalCharge) return;
    const { chargeId, target } = terminalCharge;
    // Kill the previous attempt BEFORE starting a new charge — a retry runs
    // with a fresh idempotency key, so an un-cancelled prior charge could
    // settle alongside the new one and double-charge the card. The backend
    // START guard additionally 409s while a live charge exists for the order.
    if (chargeId) {
      try {
        await cancelTerminalCharge(target.orderId, chargeId);
      } catch {
        // Best-effort: proceed — the backend guard blocks a live duplicate,
        // but tell the operator the old attempt may still settle.
        toast.warning(
          t(
            'terminalCharge.retryCancelFailed',
            'Önceki çekim denemesi iptal edilemedi — yine de tamamlanırsa mutabakat ekranından çözümleyin.',
          ),
        );
      }
    }
    void startCardTerminalCharge(target);
  };

  const handleTerminalClose = () => setTerminalCharge(null);

  const handlePaymentConfirm = (data: { method: string; transactionId?: string; customerPhone?: string }) => {
    // Determine which order to pay: SERVED order (payingOrderId) or cart order
    // (currentOrderId). Returns null (and we bail) when nothing is chargeable.
    const target = resolvePaymentTarget({
      payingOrderId,
      payingOrderAmount: livePayingOrderAmount,
      currentOrderId,
      currentOrderAmount: liveCurrentOrderAmount,
    });
    if (!target) return;
    const orderIdToPay = target.orderId;
    const amountToPay = target.amount;

    // Card + an active terminal → drive the terminal (charge before record).
    // No active terminal → unchanged manual-card flow below (zero regression).
    if (data.method === 'CARD' && activeTerminal?.active) {
      void startCardTerminalCharge(target);
      return;
    }

    createPayment(
      {
        orderId: orderIdToPay,
        amount: amountToPay,
        method: data.method as any,
        transactionId: data.transactionId,
        customerPhone: data.customerPhone || undefined,
        // Same idempotency rationale as createOrder: backend has a partial
        // unique index on (orderId, idempotencyKey) — a double-tap or
        // 401-retry returns the existing payment instead of charging twice.
        idempotencyKey: crypto.randomUUID(),
      },
      {
        onSuccess: async (payment: Payment) => {
          // Auto-print on the desktop POS terminal. Gated on isTauri()
          // and a configured default printer; web users see no prints.
          // Failures are toasted with a one-tap Reprint action — the
          // snapshot is persisted on the backend so a manual reprint
          // never re-derives content (it matches the original
          // byte-for-byte even if the order is edited later). Side-effect
          // logic lives in posReceipt.runReceiptSideEffects (unit-tested).
          runReceiptSideEffects(payment, data.method, {
            isTauri,
            getPrinterId: () => useUiStore.getState().defaultReceiptPrinterId,
            hardware: HardwareService,
            toast,
            t,
          });

          // Refetch orders to update the list
          // Re-fetch fresh table orders BEFORE deciding whether to free
          // the table — `tableOrders` from useGetTableOrders is a stale
          // snapshot captured at render time. If a new order arrived
          // between the user opening payment and confirming, the snapshot
          // wouldn't include it and we'd incorrectly mark the table
          // AVAILABLE, letting another guest sit down on top of an
          // unpaid bill. The await guarantees we work with current state.
          const refreshed = await refetchOrders();
          const freshOrders = refreshed.data ?? tableOrders ?? [];

          // Check if this was an existing order payment (from AwaitingPayment section)
          const wasExistingOrderPayment = target.wasExistingOrderPayment;

          // Reset payment state
          setIsPaymentModalOpen(false);
          setPayingOrderId(null);
          setPayingOrderAmount(null);

          // Always check for remaining unpaid orders before marking table as
          // available (the documented stale-snapshot race guard). The just-paid
          // order is NOT excluded: fully paid ⇒ it already dropped out of the
          // refetched status-filtered list; still present ⇒ partial payment,
          // which must block the release.
          const hasRemainingOrders = hasRemainingUnpaidOrders(freshOrders);

          if (wasExistingOrderPayment) {
            // For existing order payments (READY/SERVED), only mark available if no remaining orders
            if (!hasRemainingOrders && selectedTable) {
              updateTableStatus({
                id: selectedTable.id,
                status: TableStatus.AVAILABLE,
              });
            }
          } else {
            // For cart orders (single-step checkout), check remaining orders before resetting
            if (!hasRemainingOrders && selectedTable) {
              updateTableStatus({
                id: selectedTable.id,
                status: TableStatus.AVAILABLE,
              });
            }
            setCurrentOrderId(null);
            setCurrentOrderAmount(null);
            setSelectedTable(null);
            setCartItems([]);
            setDiscount(0);
            setCustomerName('');
            setOrderNotes('');
            setCartDirtySinceOrder(false); // deep-review FH2
          }

          toast.success(t('orderCompletedSuccess'));
        },
      }
    );
  };

  // Handle table transfer
  const handleTransferTable = () => {
    if (!selectedTable) return;
    setIsTransferModalOpen(true);
  };

  const handleTransferConfirm = (targetTableId: string) => {
    if (!selectedTable) return;

    transferTableOrders(
      {
        sourceTableId: selectedTable.id,
        targetTableId,
        allowMerge: true,
      },
      {
        onSuccess: () => {
          // Reset state after successful transfer
          setIsTransferModalOpen(false);
          setSelectedTable(null);
          setCartItems([]);
          setDiscount(0);
          setCustomerName('');
          setOrderNotes('');
          setCurrentOrderId(null);
          setCurrentOrderAmount(null);
          setCartDirtySinceOrder(false); // deep-review FH2
          // The transfer cleared the table context, so land back on
          // table-selection (mirrors handleBackToTables). Staying on
          // 'order' with no table flips the header to "Takeaway order"
          // while the no-table guard blocks Create — a dead end.
          // (Unreachable in tableless mode: transfers need a selected
          // table, which tableless never has.)
          setCurrentView('table-selection');
        },
      }
    );
  };

  // Handle table merge
  const handleMergeTables = (tableIds: string[]) => {
    mergeTables({ tableIds }, {
      onSuccess: () => setIsMergeModalOpen(false),
    });
  };

  const handleUnmergeTable = (tableId: string) => {
    unmergeTable({ tableId });
  };

  const handleUnmergeAll = (groupId: string) => {
    unmergeAll(groupId, {
      onSuccess: () => setIsMergeModalOpen(false),
    });
  };

  // Handle bill split - returns promise for sequential multi-order calls
  const handleBillSplit = (orderId: string, splitType: SplitType, payments: SplitPaymentEntry[]) => {
    return new Promise<void>((resolve, reject) => {
      splitBill(
        { orderId, splitType, payments },
        {
          onSuccess: () => {
            setIsBillSplitModalOpen(false);
            setCurrentOrderId(null);
            setCurrentOrderAmount(null);
            resolve();
          },
          onError: (err) => reject(err),
        }
      );
    });
  };

  // Calculate totals (including modifier prices). Money math lives in
  // posCart.ts so it shares a single tested arithmetic surface with
  // cartStore.calculateItemTotal and can never drift.
  const subtotal = calculateSubtotal(cartItems);
  // deep-review FL3: re-clamp the stored discount to the LIVE subtotal at the
  // single source of truth. The OrderCart input clamps on keystroke, but if the
  // cashier sets a discount then removes items (shrinking the subtotal below the
  // discount), the stored `discount` stays stale — producing a negative total in
  // the UI and an over-discount sent to the server. Deriving the effective
  // discount here keeps display, create, and checkout all consistent.
  const effectiveDiscount = Math.max(0, Math.min(discount, subtotal));
  const total = subtotal - effectiveDiscount;
  const hasCartItems = cartItems.length > 0;

  // Table card status styles
  const getStatusStyles = (status: TableStatus) => {
    switch (status) {
      case TableStatus.AVAILABLE:
        return 'border-green-200 hover:border-green-300 hover:shadow-green-100/50';
      case TableStatus.OCCUPIED:
        return 'border-amber-200 hover:border-amber-300 hover:shadow-amber-100/50';
      case TableStatus.RESERVED:
        return 'border-slate-300 hover:border-slate-400';
      default:
        return 'border-slate-200';
    }
  };

  const getStatusBadgeStyles = (status: TableStatus) => {
    switch (status) {
      case TableStatus.AVAILABLE:
        return 'bg-green-100 text-green-700';
      case TableStatus.OCCUPIED:
        return 'bg-amber-100 text-amber-700';
      case TableStatus.RESERVED:
        return 'bg-slate-100 text-slate-600';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  };

  return (
    <div className="h-full pb-20 md:pb-0">
      {/* Notification Bar */}
      <NotificationBar
        onShowPendingOrders={() => setIsPendingOrdersPanelOpen(true)}
        onShowWaiterRequests={() => setIsWaiterRequestsPanelOpen(true)}
        onShowBillRequests={() => setIsBillRequestsPanelOpen(true)}
      />

      {/* ========== STEP 1: TABLE SELECTION SCREEN ========== */}
      {currentView === 'table-selection' && !isTablelessMode && (
        <div className="h-[calc(100vh-12rem)] flex flex-col">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-heading font-bold text-slate-900">
                {t('tableSelection.title')}
              </h1>
              <p className="text-sm md:text-base text-slate-500 mt-1">
                {t('tableSelection.description')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Persistent delivery-inbox opener — the NotificationBar hides
                  itself at 0 pending counts, but accepted delivery orders
                  (PREPARING/READY) still need a way into the panel. */}
              <DeliveryInboxButton onOpen={() => setIsPendingOrdersPanelOpen(true)} />
              {/* Grid / live-map view toggle */}
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setTableViewMode('grid')}
                  aria-pressed={tableViewMode === 'grid'}
                  aria-label={t('tableSelection.viewGrid', 'Izgara')}
                  className={`flex items-center justify-center w-10 h-9 rounded-md transition-colors ${tableViewMode === 'grid' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTableViewMode('map')}
                  aria-pressed={tableViewMode === 'map'}
                  aria-label={t('tableSelection.viewMap', 'Plan')}
                  className={`flex items-center justify-center w-10 h-9 rounded-md transition-colors ${tableViewMode === 'map' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <MapIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Takeaway Hero Card (if tableless mode enabled) */}
          {isTablelessMode && (
            <button
              onClick={handleTakeawayMode}
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-5 md:p-6 mb-6 shadow-lg hover:shadow-xl transition-all duration-300 text-left w-full"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-primary-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative flex items-center gap-4">
                <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm">
                  <ShoppingBag className="h-7 w-7 md:h-8 md:w-8 text-white" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg md:text-xl font-bold text-white">
                    {t('tableSelection.takeawayOrder')}
                  </h2>
                  <p className="text-slate-400 text-sm">
                    {t('tableSelection.takeawayDescription')}
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-white group-hover:translate-x-1 transition-all" />
              </div>
            </button>
          )}

          {/* Loading State */}
          {isLoadingTables && (
            <div className="flex-1 flex items-center justify-center">
              <Spinner />
            </div>
          )}

          {/* Tables Grid */}
          {!isLoadingTables && tables && tableViewMode === 'grid' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4 auto-rows-max overflow-auto pb-4" data-tour="table-grid">
              {tables.map((table) => {
                const notifications = getTableNotifications(table.id);
                const hasNotifications = notifications.orders > 0 || notifications.waiter > 0 || notifications.bill > 0;

                return (
                  <button
                    key={table.id}
                    onClick={() => handleSelectTable(table)}
                    className={`group relative flex flex-col p-4 md:p-5 bg-white rounded-xl border-2 transition-all duration-200 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 outline-none ${getStatusStyles(table.status)}`}
                  >
                    {/* Notification Badges - Top Right Corner */}
                    {hasNotifications && (
                      <div className="absolute -top-2 -right-2 flex gap-1">
                        {notifications.orders > 0 && (
                          <div className="bg-amber-500 text-white rounded-full h-6 w-6 flex items-center justify-center shadow-lg ring-2 ring-white">
                            <Clock className="h-3 w-3" />
                          </div>
                        )}
                        {notifications.waiter > 0 && (
                          <div className="bg-blue-500 text-white rounded-full h-6 w-6 flex items-center justify-center shadow-lg ring-2 ring-white">
                            <User className="h-3 w-3" />
                          </div>
                        )}
                        {notifications.bill > 0 && (
                          <div className="bg-purple-500 text-white rounded-full h-6 w-6 flex items-center justify-center shadow-lg ring-2 ring-white">
                            <Receipt className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Table Number & Status */}
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-2xl md:text-3xl font-bold text-slate-900">
                        {table.number}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeStyles(table.status)}`}>
                        {t(`tableGrid.status.${table.status}`)}
                      </span>
                    </div>

                    {/* Capacity */}
                    <div className="flex items-center gap-1.5 text-slate-500 text-sm">
                      <Users className="h-4 w-4" />
                      <span>{t('tableSelection.seats', { count: table.capacity })}</span>
                    </div>

                    {/* Upcoming reservation chip — warns the waiter this table
                        is booked soon even while it still reads AVAILABLE. */}
                    {table.upcomingReservation && (
                      <div className="mt-2">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold ring-1 ring-inset ring-amber-200/60"
                          title={t('tableGrid.upcomingReservationTitle', {
                            customerName: table.upcomingReservation.customerName,
                          })}
                          aria-label={t('tableGrid.upcomingReservationTitle', {
                            customerName: table.upcomingReservation.customerName,
                          })}
                        >
                          <CalendarClock className="h-3 w-3" />
                          {t('tableGrid.reservationChip', {
                            startTime: table.upcomingReservation.startTime,
                            guestCount: table.upcomingReservation.guestCount,
                          })}
                        </span>
                      </div>
                    )}

                    {/* Notification Details */}
                    {hasNotifications && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                        {notifications.orders > 0 && (
                          <div className="text-xs font-medium text-amber-600 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {notifications.orders} {t('tableSelection.pendingOrders', { count: notifications.orders })}
                          </div>
                        )}
                        {notifications.waiter > 0 && (
                          <div className="text-xs font-medium text-blue-600 flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {notifications.waiter} {t('tableSelection.waiterCalls', { count: notifications.waiter })}
                          </div>
                        )}
                        {notifications.bill > 0 && (
                          <div className="text-xs font-medium text-purple-600 flex items-center gap-1">
                            <Receipt className="h-3 w-3" />
                            {notifications.bill} {t('tableSelection.billRequests', { count: notifications.bill })}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Live 2D floor map — tap a table to start/resume its order. Looks
              up the full Table by id so handleSelectTable keeps every branch
              (reservation dialog, manual-lock, load-existing-order). */}
          {!isLoadingTables && tableViewMode === 'map' && (
            <div className="flex-1 min-h-0 rounded-2xl border border-slate-200 overflow-hidden bg-white">
              <LiveFloorMap
                onTableClick={(fpt) => {
                  const full = tables?.find((tb) => tb.id === fpt.id);
                  if (full) handleSelectTable(full);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* ========== STEP 2: ORDER SCREEN ========== */}
      {currentView === 'order' && (
        <div className="h-[calc(100vh-12rem)] flex flex-col">
          {/* Header with Back Button and Table Info */}
          <div className="flex items-center gap-4 mb-4 pb-4 border-b border-slate-200">
            {/* Back button - only show when tableless mode is NOT active */}
            {!isTablelessMode && (
              <button
                onClick={handleBackToTables}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                aria-label={t('tableSelection.backToTables')}
              >
                <ArrowLeft className="h-5 w-5 text-slate-600" />
              </button>
            )}
            <div className="flex-1">
              <h1 className="text-xl md:text-2xl font-bold text-slate-900">
                {selectedTable ? (
                  <>
                    {t('table')} {selectedTable.number}
                  </>
                ) : (
                  t('tableSelection.takeawayOrder')
                )}
              </h1>
              <p className="text-sm text-slate-500">
                {selectedTable ? (
                  <>
                    {t('tableSelection.seats', { count: selectedTable.capacity })} • {t(`tableGrid.status.${selectedTable.status}`)}
                  </>
                ) : (
                  t('tableSelection.takeawayDescription')
                )}
              </p>
            </div>
            {/* Persistent delivery-inbox opener — mirrored from the
                table-selection header so it stays reachable mid-order and in
                tableless mode (where table-selection never renders). */}
            <DeliveryInboxButton onOpen={() => setIsPendingOrdersPanelOpen(true)} />
            {/* Cart pill for mobile (only when the side cart is hidden). Now
                surfaces the running TOTAL alongside the count so the cashier
                can glance the bill without opening the drawer. */}
            {!useSideBySideLayout && hasCartItems && (
              <button
                onClick={() => setIsCartDrawerOpen(true)}
                className="flex items-center gap-2 pl-3 pr-4 py-2.5 bg-primary-600 text-white rounded-xl shadow-sm active:scale-95 transition-transform"
                aria-label={t('cart.yourOrder')}
              >
                <span className="relative">
                  <ShoppingBag className="h-5 w-5" />
                  <span className="absolute -top-2 -right-2 bg-white text-primary-700 text-[10px] font-bold rounded-full h-4 min-w-[1rem] px-1 flex items-center justify-center">
                    {cartItems.length}
                  </span>
                </span>
                <span className="font-bold tabular-nums">{formatPrice(total)}</span>
              </button>
            )}
          </div>

          {/* Awaiting Payment Section - READY or SERVED orders that need payment */}
          {selectedTable && readyOrServedOrders.length > 0 && (
            <AwaitingPaymentSection
              orders={readyOrServedOrders}
              onCollectPayment={handleCollectPayment}
            />
          )}

          {/* DESKTOP + LANDSCAPE TABLET (>=768): 2/3 Menu + 1/3 Cart Layout */}
          {useSideBySideLayout && (
            <div className="flex-1 grid grid-cols-3 gap-4 lg:gap-6 min-h-0">
              {/* Menu Panel - 2/3 width. Rendered chrome-free (no redundant
                  "Menu" Card header) so the product grid uses the FULL column
                  height — MenuPanel has its own header (search + categories)
                  and internal scroll. */}
              <div className="col-span-2 min-h-0" data-tour="menu-panel">
                <MenuPanel
                  onAddItem={handleAddItem}
                  cartQuantities={cartQuantities}
                  onIncrement={handleMenuIncrement}
                  onDecrement={handleMenuDecrement}
                />
              </div>

              {/* Order Cart - 1/3 width */}
              <div className="col-span-1" data-tour="order-cart">
                <div className="sticky top-0 h-full">
                  <OrderCart
                    items={cartItems}
                    discount={effectiveDiscount}
                    customerName={customerName}
                    orderNotes={orderNotes}
                    onUpdateQuantity={handleUpdateQuantity}
                    onRemoveItem={handleRemoveItem}
                    onUpdateDiscount={handleUpdateDiscount}
                    onUpdateCustomerName={setCustomerName}
                    onUpdateOrderNotes={handleUpdateOrderNotes}
                    onClearCart={handleClearCart}
                    onCheckout={handleCheckout}
                    onCreateOrder={handleCreateOrder}
                    onTransferTable={handleTransferTable}
                    onMergeTables={() => setIsMergeModalOpen(true)}
                    onSplitBill={() => setIsBillSplitModalOpen(true)}
                    onProgressivePay={() => setIsProgressiveModalOpen(true)}
                    isCheckingOut={isCreatingOrder || isUpdatingOrder}
                    isTwoStepCheckout={isTwoStepCheckout}
                    hasActiveOrder={!!currentOrderId}
                    hasSelectedTable={!!selectedTable}
                    canProceedToPayment={canProceedToPayment}
                    paymentBlockedReason={paymentBlockedReason}
                    cartDirty={cartDirtySinceOrder}
                  />
                </div>
              </div>
            </div>
          )}

          {/* PHONE: Full-screen Menu (cart lives in the drawer). Chrome-free
              for the same reason as the side-by-side branch — MenuPanel owns
              its header + scroll and fills the full height. */}
          {!useSideBySideLayout && (
            <div className="flex-1 min-h-0">
              <MenuPanel
                onAddItem={handleAddItem}
                cartQuantities={cartQuantities}
                onIncrement={handleMenuIncrement}
                onDecrement={handleMenuDecrement}
              />
            </div>
          )}
        </div>
      )}

      {/* STICKY BOTTOM CART BAR - phones only (order view); hidden once the
          side-by-side cart is shown (>=768) so a tablet doesn't get two carts. */}
      {currentView === 'order' && !useSideBySideLayout && (
        <StickyCartBar
          itemCount={cartItems.length}
          total={total}
          onViewCart={() => setIsCartDrawerOpen(true)}
          onCheckout={handleCheckout}
          onCreateOrder={handleCreateOrder}
          isCheckingOut={isCreatingOrder || isUpdatingOrder}
          hasItems={hasCartItems}
          isTwoStepCheckout={isTwoStepCheckout}
          hasActiveOrder={!!currentOrderId}
          canProceedToPayment={canProceedToPayment}
        />
      )}

      {/* CART DRAWER - Mobile only */}
      <CartDrawer
        isOpen={isCartDrawerOpen}
        onClose={() => setIsCartDrawerOpen(false)}
      >
        <OrderCart
          items={cartItems}
          discount={effectiveDiscount}
          customerName={customerName}
          orderNotes={orderNotes}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveItem}
          onUpdateDiscount={handleUpdateDiscount}
          onUpdateCustomerName={setCustomerName}
          onUpdateOrderNotes={handleUpdateOrderNotes}
          onClearCart={handleClearCart}
          onCheckout={() => {
            setIsCartDrawerOpen(false);
            handleCheckout();
          }}
          onCreateOrder={handleCreateOrder}
          onTransferTable={() => {
            setIsCartDrawerOpen(false);
            handleTransferTable();
          }}
          // Same table-ops the desktop cart gets — phone waiters need
          // merge/split/progressive too. The modals are page-level siblings
          // of the drawer, so close the drawer first (the established
          // checkout/transfer pattern) rather than stacking them over it.
          onMergeTables={() => {
            setIsCartDrawerOpen(false);
            setIsMergeModalOpen(true);
          }}
          onSplitBill={() => {
            setIsCartDrawerOpen(false);
            setIsBillSplitModalOpen(true);
          }}
          onProgressivePay={() => {
            setIsCartDrawerOpen(false);
            setIsProgressiveModalOpen(true);
          }}
          isCheckingOut={isCreatingOrder || isUpdatingOrder}
          isTwoStepCheckout={isTwoStepCheckout}
          hasActiveOrder={!!currentOrderId}
          hasSelectedTable={!!selectedTable}
          canProceedToPayment={canProceedToPayment}
          paymentBlockedReason={paymentBlockedReason}
          cartDirty={cartDirtySinceOrder}
        />
      </CartDrawer>

      {/* Payment Modal */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false);
          setPayingOrderId(null);
          setPayingOrderAmount(null);
        }}
        total={livePayingOrderAmount ?? liveCurrentOrderAmount ?? total}
        onConfirm={handlePaymentConfirm}
        isLoading={isCreatingPayment}
      />

      {/* Integrated card-terminal status (only mounts when a charge is active) */}
      <TerminalChargeModal
        charge={terminalCharge}
        amount={terminalCharge?.target.amount ?? 0}
        onCancel={handleTerminalCancel}
        onRetry={handleTerminalRetry}
        onClose={handleTerminalClose}
      />

      {/* Product Options Modal */}
      {productForOptions && (
        <ProductOptionsModal
          isOpen={isProductOptionsModalOpen}
          onClose={() => {
            setIsProductOptionsModalOpen(false);
            setProductForOptions(null);
          }}
          product={productForOptions}
          onAddToCart={handleAddItemWithModifiers}
        />
      )}

      {/* Notification Panels */}
      <PendingOrdersPanel
        isOpen={isPendingOrdersPanelOpen}
        onClose={() => setIsPendingOrdersPanelOpen(false)}
      />
      <WaiterRequestsPanel
        isOpen={isWaiterRequestsPanelOpen}
        onClose={() => setIsWaiterRequestsPanelOpen(false)}
      />
      <BillRequestsPanel
        isOpen={isBillRequestsPanelOpen}
        onClose={() => setIsBillRequestsPanelOpen(false)}
      />

      {/* Transfer Table Modal */}
      {selectedTable && (
        <TransferTableModal
          isOpen={isTransferModalOpen}
          onClose={() => setIsTransferModalOpen(false)}
          sourceTable={selectedTable}
          orderCount={tableOrders?.filter(
            (order) =>
              order.status !== OrderStatus.PAID &&
              order.status !== OrderStatus.CANCELLED
          ).length || 0}
          onConfirm={handleTransferConfirm}
          isLoading={isTransferring}
        />
      )}

      {/* Table Merge Modal */}
      <TableMergeModal
        isOpen={isMergeModalOpen}
        onClose={() => setIsMergeModalOpen(false)}
        currentTable={selectedTable}
        onMerge={handleMergeTables}
        onUnmerge={handleUnmergeTable}
        onUnmergeAll={handleUnmergeAll}
        // The modal's merge/unmerge/unmerge-all buttons share one disable —
        // gate it on ALL three mutations, not just merge, so a double-tap on
        // unmerge can't fire twice while its own request is in flight.
        isLoading={isMerging || isUnmergingTable || isUnmergingAll}
      />

      {/* Bill Split Modal */}
      {tableOrders && (
        <BillSplitModal
          isOpen={isBillSplitModalOpen}
          onClose={() => setIsBillSplitModalOpen(false)}
          orders={tableOrders}
          onConfirm={handleBillSplit}
          isLoading={isSplitting}
        />
      )}

      {/* Progressive ("Dutch-style") Payment Modal */}
      {/*
       * Source of orders:
       *  - Standalone table: just tableOrders (active, this table).
       *  - Merged group (selectedTable.groupId set): all active orders
       *    across every table in the group, so the modal's tab strip
       *    actually has >1 entry. groupBillSummary returns table
       *    numbers per order so each tab can show its source table.
       */}
      {(() => {
        const groupId = selectedTable?.groupId ?? null;
        // Hooks fire unconditionally; gate the modal render on isOpen
        // so we don't pay for the network call when it's closed.
        const groupOrders = (groupSummary?.orders || []).map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          tableNumber: groupSummary?.tables.find((t) => t.id === o.tableId)?.number,
        }));
        const standaloneOrders = (tableOrders || [])
          .filter((o) => o.status !== 'PAID' && o.status !== 'CANCELLED')
          .map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            tableNumber: selectedTable?.number,
          }));
        const orders = groupId && groupSummary ? groupOrders : standaloneOrders;
        // Never unmount while the modal is OPEN: paying the last items flips
        // the order PAID, the status-filtered refetch empties `orders`, and
        // unmounting here would destroy the modal at that exact moment — its
        // own fullyPaid confirmation (which it renders from the still-loaded
        // payable summary) could never be seen.
        if (!orders.length && !isProgressiveModalOpen) return null;
        return (
          <ProgressiveSplitModal
            isOpen={isProgressiveModalOpen}
            onClose={() => setIsProgressiveModalOpen(false)}
            orders={orders}
          />
        );
      })()}

      {/* Reservation action dialog — opens when the waiter taps a
          RESERVED table that the scheduler auto-held for an upcoming
          reservation. Shows the booking details and offers a one-tap
          "Seat" that flips the table to OCCUPIED and lands us on the
          order screen. */}
      {reservationDialog && (
        <ReservationActionDialog
          isOpen
          onClose={() => setReservationDialog(null)}
          reservation={reservationDialog.reservation}
          tableNumber={reservationDialog.table.number}
          onSeated={handleReservationSeated}
        />
      )}

      {/* Manual-lock dialog — opens when the waiter taps a RESERVED
          table that is NOT auto-held for an upcoming reservation
          (admin marked it RESERVED with no booking row). Offers a
          one-tap override that flips the table to AVAILABLE and
          drops the waiter on the order screen. */}
      {manualLockDialog && (
        <ManualLockDialog
          isOpen
          onClose={() => setManualLockDialog(null)}
          tableId={manualLockDialog.id}
          tableNumber={manualLockDialog.number}
          onUnlocked={handleManualLockOverride}
        />
      )}
    </div>
  );
};

export default POSPage;
