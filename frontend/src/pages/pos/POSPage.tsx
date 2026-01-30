import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ShoppingBag, ArrowRight, Users, Clock, User, Receipt } from 'lucide-react';
import MenuPanel from '../../components/pos/MenuPanel';
import OrderCart from '../../components/pos/OrderCart';
import PaymentModal from '../../components/pos/PaymentModal';
import ProductOptionsModal, { SelectedModifier } from '../../components/pos/ProductOptionsModal';
import StickyCartBar from '../../components/pos/StickyCartBar';
import CartDrawer from '../../components/pos/CartDrawer';
import NotificationBar from '../../components/pos/NotificationBar';
import AwaitingPaymentSection from '../../components/pos/AwaitingPaymentSection';
import PendingOrdersPanel from '../../components/pos/PendingOrdersPanel';
import WaiterRequestsPanel from '../../components/pos/WaiterRequestsPanel';
import BillRequestsPanel from '../../components/pos/BillRequestsPanel';
import { useCreateOrder, useUpdateOrder, useOrders, useTransferTableOrders } from '../../features/orders/ordersApi';
import { useCreatePayment, usePendingOrders, useWaiterRequests, useBillRequests } from '../../features/orders/ordersApi';
import TransferTableModal from '../../components/pos/TransferTableModal';
import { useTables, useUpdateTableStatus } from '../../features/tables/tablesApi';
import { useGetPosSettings } from '../../features/pos/posApi';
import { usePosSocket } from '../../features/pos/usePosSocket';
import { Product, Table, TableStatus, OrderType, OrderStatus } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { useResponsive } from '../../hooks/useResponsive';
import Spinner from '../../components/ui/Spinner';

// View state type
type POSView = 'table-selection' | 'order';

interface CartItem extends Product {
  quantity: number;
  notes?: string;
  modifiers?: SelectedModifier[];
}

const POSPage = () => {
  const { t } = useTranslation('pos');

  // View state: table-selection or order
  const [currentView, setCurrentView] = useState<POSView>('table-selection');

  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [currentOrderAmount, setCurrentOrderAmount] = useState<number | null>(null);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [payingOrderAmount, setPayingOrderAmount] = useState<number | null>(null);
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const [isPendingOrdersPanelOpen, setIsPendingOrdersPanelOpen] = useState(false);
  const [isWaiterRequestsPanelOpen, setIsWaiterRequestsPanelOpen] = useState(false);
  const [isBillRequestsPanelOpen, setIsBillRequestsPanelOpen] = useState(false);
  const [isProductOptionsModalOpen, setIsProductOptionsModalOpen] = useState(false);
  const [productForOptions, setProductForOptions] = useState<Product | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  // Responsive hook
  const { isDesktop } = useResponsive();

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

  // Find the current order for payment eligibility check
  const currentOrder = useMemo(() => {
    if (!currentOrderId || !tableOrders) return null;
    return tableOrders.find((o) => o.id === currentOrderId) || null;
  }, [currentOrderId, tableOrders]);

  // Payment eligibility calculation for two-step checkout
  const canProceedToPayment = useMemo(() => {
    // Must have an active order to proceed to payment
    if (!currentOrderId || !currentOrder) return false;

    // Takeaway and delivery orders can always proceed to payment
    const orderType = currentOrder.type || OrderType.DINE_IN;
    if (orderType === OrderType.TAKEAWAY || orderType === OrderType.DELIVERY) {
      return true;
    }

    // For dine-in, check if SERVED/READY status is required
    if (posSettings?.requireServedForDineInPayment) {
      return currentOrder.status === OrderStatus.SERVED || currentOrder.status === OrderStatus.READY;
    }

    // Setting is off - allow payment anytime
    return true;
  }, [currentOrderId, currentOrder, posSettings?.requireServedForDineInPayment]);

  // Reason why payment is blocked (for user feedback)
  const paymentBlockedReason = useMemo(() => {
    if (canProceedToPayment) return null;
    if (!currentOrderId) return 'noActiveOrder';
    if (
      posSettings?.requireServedForDineInPayment &&
      currentOrder?.type === OrderType.DINE_IN &&
      currentOrder?.status !== OrderStatus.SERVED &&
      currentOrder?.status !== OrderStatus.READY
    ) {
      return 'dineInPaymentRequiresReadyOrServed';
    }
    return null;
  }, [canProceedToPayment, currentOrderId, currentOrder, posSettings?.requireServedForDineInPayment]);

  // Load existing orders when an occupied table is selected
  useEffect(() => {
    if (selectedTable?.status === TableStatus.OCCUPIED && tableOrders) {
      // Find the most recent editable order (only PENDING or PREPARING)
      // READY and SERVED orders should not be continued - new order should be created
      const activeOrder = tableOrders.find(
        (order) =>
          order.status === OrderStatus.PENDING ||
          order.status === OrderStatus.PREPARING
      );

      if (activeOrder) {
        setCurrentOrderId(activeOrder.id);
        setCurrentOrderAmount(Number(activeOrder.finalAmount));

        // Populate cart with existing order items
        const items = activeOrder.orderItems || activeOrder.items || [];
        const existingItems: CartItem[] = items.map((item) => ({
          ...(item.product as Product),
          quantity: item.quantity,
          notes: item.notes || undefined,
        }));

        setCartItems(existingItems);
        setDiscount(activeOrder.discount || 0);
        setCustomerName('');
        setOrderNotes(activeOrder.notes || '');

        toast.info(
          t('loadedExistingOrder', { orderNumber: activeOrder.orderNumber, count: items.length })
        );
      } else if (tableOrders.length === 0) {
        // Table is marked occupied but no orders found at all - this is unusual
        toast.warning(t('tableOccupiedNoOrders'));
      }
      // If there are only READY/SERVED orders, we don't show a warning - the AwaitingPaymentSection will handle them
    }
  }, [selectedTable, tableOrders]);

  const handleSelectTable = (table: Table) => {
    if (table.status === TableStatus.AVAILABLE) {
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
      // Clear cart first - useEffect will load existing orders
      setCartItems([]);
      setDiscount(0);
      setCustomerName('');
      setOrderNotes('');
      setCurrentView('order');
      toast.info(t('loadingExistingOrder'));
    } else {
      toast.warning(t('tableReserved'));
    }
  };

  // Handle back to table selection (preserves cart)
  const handleBackToTables = () => {
    setCurrentView('table-selection');
    // Cart is preserved - user can select different table
  };

  // Handle takeaway mode (no table needed)
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

    if (hasRequiredModifiers) {
      // Open options modal for modifier selection
      setProductForOptions(product);
      setIsProductOptionsModalOpen(true);
      return;
    }

    // No required modifiers - add directly to cart
    addItemToCart(product, 1, []);
  };

  const addItemToCart = (product: Product, quantity: number, modifiers: SelectedModifier[]) => {
    setCartItems((prev) => {
      // Create a unique key based on product ID and selected modifiers
      const modifierKey = modifiers.map(m => m.modifierId).sort().join('-');
      const existingItem = prev.find(
        (item) => item.id === product.id &&
          (item.modifiers?.map(m => m.modifierId).sort().join('-') || '') === modifierKey
      );

      if (existingItem) {
        return prev.map((item) =>
          item === existingItem
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      return [...prev, { ...product, quantity, modifiers }];
    });
  };

  const handleAddItemWithModifiers = (product: Product, quantity: number, modifiers: SelectedModifier[]) => {
    addItemToCart(product, quantity, modifiers);
    setIsProductOptionsModalOpen(false);
    setProductForOptions(null);
  };

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    if (quantity < 1) return;
    setCartItems((prev) =>
      prev.map((item) =>
        item.id === productId ? { ...item, quantity } : item
      )
    );
  };

  const handleRemoveItem = (productId: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== productId));
  };

  const handleClearCart = () => {
    setCartItems([]);
    setDiscount(0);
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

    // Determine order type based on mode
    const orderType = isTablelessMode && !selectedTable ? OrderType.TAKEAWAY : OrderType.DINE_IN;

    const orderData = {
      type: orderType,
      tableId: selectedTable?.id,
      customerName: customerName || undefined,
      notes: orderNotes || undefined,
      discount,
      items: cartItems.map((item) => ({
        productId: item.id,
        quantity: item.quantity,
        unitPrice: item.price,
        notes: item.notes,
        modifiers: item.modifiers?.map(m => ({
          modifierId: m.modifierId,
          quantity: m.quantity,
        })),
      })),
    };

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

    // If two-step checkout is enabled and order already exists, just open payment
    if (isTwoStepCheckout && currentOrderId) {
      setIsPaymentModalOpen(true);
      return;
    }

    // Determine order type based on mode
    const orderType = isTablelessMode && !selectedTable ? OrderType.TAKEAWAY : OrderType.DINE_IN;

    const orderData = {
      type: orderType,
      tableId: selectedTable?.id,
      customerName: customerName || undefined,
      notes: orderNotes || undefined,
      discount,
      items: cartItems.map((item) => ({
        productId: item.id,
        quantity: item.quantity,
        unitPrice: item.price,
        notes: item.notes,
        modifiers: item.modifiers?.map(m => ({
          modifierId: m.modifierId,
          quantity: m.quantity,
        })),
      })),
    };

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

  const handlePaymentConfirm = (data: { method: string; transactionId?: string; customerPhone?: string }) => {
    // Determine which order to pay: SERVED order (payingOrderId) or cart order (currentOrderId)
    const orderIdToPay = payingOrderId || currentOrderId;
    const amountToPay = payingOrderId ? payingOrderAmount : currentOrderAmount;

    if (!orderIdToPay || amountToPay === null) return;

    createPayment(
      {
        orderId: orderIdToPay,
        amount: amountToPay,
        method: data.method as any,
        transactionId: data.transactionId,
        customerPhone: data.customerPhone || undefined,
      },
      {
        onSuccess: () => {
          // Refetch orders to update the list
          refetchOrders();

          // Check if this was an existing order payment (from AwaitingPayment section)
          const wasExistingOrderPayment = !!payingOrderId;

          // Reset payment state
          setIsPaymentModalOpen(false);
          setPayingOrderId(null);
          setPayingOrderAmount(null);

          // Always check for remaining unpaid orders before marking table as available
          const remainingOrders = tableOrders?.filter(
            (order) =>
              order.id !== orderIdToPay &&
              order.status !== OrderStatus.PAID &&
              order.status !== OrderStatus.CANCELLED
          );

          const hasRemainingOrders = remainingOrders && remainingOrders.length > 0;

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
        },
      }
    );
  };

  // Calculate totals (including modifier prices)
  const subtotal = cartItems.reduce((sum, item) => {
    const itemPrice = Number(item.price);
    const modifiersTotal = (item.modifiers || []).reduce(
      (modSum, mod) => modSum + (mod.priceAdjustment * mod.quantity),
      0
    );
    return sum + (itemPrice + modifiersTotal) * item.quantity;
  }, 0);
  const total = subtotal - discount;
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
    <div className="h-full pb-20 lg:pb-0">
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
          <div className="mb-6">
            <h1 className="text-2xl md:text-3xl font-heading font-bold text-slate-900">
              {t('tableSelection.title')}
            </h1>
            <p className="text-sm md:text-base text-slate-500 mt-1">
              {t('tableSelection.description')}
            </p>
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
          {!isLoadingTables && tables && (
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
            {/* Cart indicator for mobile */}
            {!isDesktop && hasCartItems && (
              <button
                onClick={() => setIsCartDrawerOpen(true)}
                className="relative p-2 bg-primary-50 text-primary-700 rounded-lg"
                aria-label={t('cart.yourOrder')}
              >
                <ShoppingBag className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 bg-primary-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {cartItems.length}
                </span>
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

          {/* DESKTOP: 2/3 Menu + 1/3 Cart Layout */}
          {isDesktop && (
            <div className="flex-1 grid grid-cols-3 gap-6 min-h-0">
              {/* Menu Panel - 2/3 width */}
              <div className="col-span-2" data-tour="menu-panel">
                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{t('common:navigation.menu')}</CardTitle>
                  </CardHeader>
                  <CardContent className="h-[calc(100%-70px)] overflow-y-auto">
                    <MenuPanel onAddItem={handleAddItem} />
                  </CardContent>
                </Card>
              </div>

              {/* Order Cart - 1/3 width */}
              <div className="col-span-1" data-tour="order-cart">
                <div className="sticky top-0 h-full">
                  <OrderCart
                    items={cartItems}
                    discount={discount}
                    customerName={customerName}
                    orderNotes={orderNotes}
                    onUpdateQuantity={handleUpdateQuantity}
                    onRemoveItem={handleRemoveItem}
                    onUpdateDiscount={setDiscount}
                    onUpdateCustomerName={setCustomerName}
                    onUpdateOrderNotes={setOrderNotes}
                    onClearCart={handleClearCart}
                    onCheckout={handleCheckout}
                    onCreateOrder={handleCreateOrder}
                    onTransferTable={handleTransferTable}
                    isCheckingOut={isCreatingOrder || isUpdatingOrder}
                    isTwoStepCheckout={isTwoStepCheckout}
                    hasActiveOrder={!!currentOrderId}
                    hasSelectedTable={!!selectedTable}
                    canProceedToPayment={canProceedToPayment}
                    paymentBlockedReason={paymentBlockedReason}
                  />
                </div>
              </div>
            </div>
          )}

          {/* MOBILE/TABLET: Full-screen Menu */}
          {!isDesktop && (
            <div className="flex-1 min-h-0">
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">{t('common:navigation.menu')}</CardTitle>
                </CardHeader>
                <CardContent className="h-[calc(100%-70px)] overflow-y-auto">
                  <MenuPanel onAddItem={handleAddItem} />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* STICKY BOTTOM CART BAR - Mobile/Tablet only (order view) */}
      {currentView === 'order' && (
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
          discount={discount}
          customerName={customerName}
          orderNotes={orderNotes}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveItem}
          onUpdateDiscount={setDiscount}
          onUpdateCustomerName={setCustomerName}
          onUpdateOrderNotes={setOrderNotes}
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
          isCheckingOut={isCreatingOrder || isUpdatingOrder}
          isTwoStepCheckout={isTwoStepCheckout}
          hasActiveOrder={!!currentOrderId}
          hasSelectedTable={!!selectedTable}
          canProceedToPayment={canProceedToPayment}
          paymentBlockedReason={paymentBlockedReason}
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
        total={payingOrderAmount ?? currentOrderAmount ?? total}
        onConfirm={handlePaymentConfirm}
        isLoading={isCreatingPayment}
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
    </div>
  );
};

export default POSPage;
