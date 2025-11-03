import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import TableGrid from '../../components/pos/TableGrid';
import MenuPanel from '../../components/pos/MenuPanel';
import OrderCart from '../../components/pos/OrderCart';
import PaymentModal from '../../components/pos/PaymentModal';
import StickyCartBar from '../../components/pos/StickyCartBar';
import CartDrawer from '../../components/pos/CartDrawer';
import NotificationBar from '../../components/pos/NotificationBar';
import PendingOrdersPanel from '../../components/pos/PendingOrdersPanel';
import WaiterRequestsPanel from '../../components/pos/WaiterRequestsPanel';
import BillRequestsPanel from '../../components/pos/BillRequestsPanel';
import { useCreateOrder, useUpdateOrder, useOrders } from '../../features/orders/ordersApi';
import { useCreatePayment } from '../../features/orders/ordersApi';
import { useUpdateTableStatus } from '../../features/tables/tablesApi';
import { useGetPosSettings } from '../../features/pos/posApi';
import { usePosSocket } from '../../features/pos/usePosSocket';
import { Product, Table, TableStatus, OrderType, OrderStatus } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { useResponsive } from '../../hooks/useResponsive';

interface CartItem extends Product {
  quantity: number;
  notes?: string;
}

const POSPage = () => {
  const { t } = useTranslation('pos');
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const [isPendingOrdersPanelOpen, setIsPendingOrdersPanelOpen] = useState(false);
  const [isWaiterRequestsPanelOpen, setIsWaiterRequestsPanelOpen] = useState(false);
  const [isBillRequestsPanelOpen, setIsBillRequestsPanelOpen] = useState(false);

  // Responsive hook
  const { isDesktop, isMobile, isTablet } = useResponsive();

  // Fetch POS settings
  const { data: posSettings } = useGetPosSettings();

  // Connect to WebSocket for real-time order updates
  const { isConnected } = usePosSocket();

  const { mutate: createOrder, isPending: isCreatingOrder } = useCreateOrder();
  const { mutate: updateOrder, isPending: isUpdatingOrder } = useUpdateOrder();
  const { mutate: createPayment, isPending: isCreatingPayment } = useCreatePayment();
  const { mutate: updateTableStatus } = useUpdateTableStatus();

  // Determine if tableless mode is enabled
  const isTablelessMode = posSettings?.enableTablelessMode ?? false;
  const isTwoStepCheckout = posSettings?.enableTwoStepCheckout ?? true; // Default to true for two-step workflow

  // Fetch active orders for selected table
  const { data: tableOrders, refetch: refetchOrders } = useOrders(
    selectedTable
      ? {
          tableId: selectedTable.id,
        }
      : undefined
  );

  // Load existing orders when a table is selected or tableOrders change
  useEffect(() => {
    // Skip if no table is selected
    if (!selectedTable) {
      return;
    }

    // Wait for tableOrders to load
    if (tableOrders === undefined) {
      return;
    }

    // Find ALL unpaid orders (not PAID, CANCELLED, or PENDING_APPROVAL)
    const activeOrders = tableOrders.filter(
      (order) =>
        order.status !== OrderStatus.PAID &&
        order.status !== OrderStatus.CANCELLED &&
        order.status !== 'PENDING_APPROVAL'
    );

    if (activeOrders.length > 0) {
      // Combine all order items from all active orders
      const allItems: CartItem[] = [];
      let totalDiscount = 0;
      let combinedNotes = '';
      const orderIds: string[] = [];

      activeOrders.forEach((order) => {
        orderIds.push(order.id);
        totalDiscount += order.discount || 0;
        if (order.notes) {
          combinedNotes += (combinedNotes ? '\n' : '') + order.notes;
        }

        const items = order.orderItems || order.items || [];
        items.forEach((item) => {
          if (!item.product) return;
          
          // Check if this product already exists in cart
          const existingItemIndex = allItems.findIndex((ci) => ci.id === item.product?.id);
          
          if (existingItemIndex >= 0) {
            // Add to existing quantity
            allItems[existingItemIndex].quantity += item.quantity;
          } else {
            // Add new item
            allItems.push({
              ...(item.product as Product),
              quantity: item.quantity,
              notes: item.notes || undefined,
            });
          }
        });
      });

      // Check if orders have changed
      const currentOrderIds = orderIds.sort().join(',');
      const loadedOrderIds = currentOrderId ? currentOrderId.split(',').sort().join(',') : '';

      // Only update if order IDs have actually changed (new orders added/removed)
      if (currentOrderIds !== loadedOrderIds) {
        console.log(`[POS] Loading ${activeOrders.length} order(s) for table ${selectedTable.number}`);
        console.log(`[POS] Order IDs: ${orderIds.join(', ')}`);
        
        // If we already have a currentOrderId and it exists in the new list, keep it
        // Otherwise, use the most recent order (last in array)
        let orderIdToSet: string;
        if (currentOrderId && orderIds.includes(currentOrderId)) {
          // Keep existing order ID if it's still valid
          orderIdToSet = currentOrderId;
          console.log(`[POS] Keeping existing order ID: ${currentOrderId}`);
        } else if (activeOrders.length === 1) {
          // Single order - use it
          orderIdToSet = orderIds[0];
          console.log(`[POS] Using single order ID: ${orderIdToSet}`);
        } else {
          // Multiple orders - store all but work with the last one
          orderIdToSet = orderIds.join(',');
          console.log(`[POS] Multiple orders, storing: ${orderIdToSet}`);
        }
        
        setCurrentOrderId(orderIdToSet);
        setCartItems(allItems);
        setDiscount(totalDiscount);
        setCustomerName('');
        setOrderNotes(combinedNotes);

        const orderNumbers = activeOrders.map(o => o.orderNumber).join(', ');
        const totalItemCount = allItems.reduce((sum, item) => sum + item.quantity, 0);
        
        toast.info(
          t('loadedExistingOrder', { orderNumber: orderNumbers, count: totalItemCount })
        );
      }
    } else {
      // No active order found for this table
      // Only clear if we currently have an order loaded
      if (currentOrderId !== null) {
        console.log(`[POS] No active orders for table ${selectedTable.number}, clearing cart`);
        setCurrentOrderId(null);
        setCartItems([]);
        setDiscount(0);
        setCustomerName('');
        setOrderNotes('');
      }
    }
    // Note: We intentionally don't include currentOrderId in dependencies
    // to avoid infinite loops. We check it manually inside the effect.
  }, [selectedTable?.id, tableOrders, t]);

  const handleSelectTable = (table: Table) => {
    // Don't re-select the same table
    if (selectedTable?.id === table.id) {
      return;
    }

    if (table.status === TableStatus.RESERVED) {
      toast.warning(t('tableReserved'));
      return;
    }

    // Set the new table
    setSelectedTable(table);
    
    // Clear cart - useEffect will load existing orders if any
    setCartItems([]);
    setDiscount(0);
    setCustomerName('');
    setOrderNotes('');
    setCurrentOrderId(null);

    // Show loading message for occupied tables
    if (table.status === TableStatus.OCCUPIED) {
      toast.info(t('loadingExistingOrder'));
    }
  };

  const handleAddItem = (product: Product) => {
    // In tableless mode, table selection is optional
    if (!isTablelessMode && !selectedTable) {
  toast.error(t('selectTableFirst'));
      return;
    }

    setCartItems((prev) => {
      const existingItem = prev.find((item) => item.id === product.id);
      if (existingItem) {
        return prev.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
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
      })),
    };

    // Check if we have a single order ID (can be updated) or multiple orders
    const hasMultipleOrders = currentOrderId && currentOrderId.includes(',');
    
    // If we have multiple orders, use the LAST one (most recent) for updates
    const orderIdToUpdate = hasMultipleOrders 
      ? currentOrderId.split(',').pop() 
      : currentOrderId;

    // Update existing order if we have an order ID
    if (orderIdToUpdate) {
      console.log(`[POS] Updating order: ${orderIdToUpdate}`);
      updateOrder(
        {
          id: orderIdToUpdate,
          data: orderData,
        },
        {
          onSuccess: (order) => {
            // Keep the updated order as current
            setCurrentOrderId(order.id);
            toast.success(t('orderUpdated'));
          },
        }
      );
    } else {
      // Create new order
      console.log(`[POS] Creating new order`);
      createOrder(
        orderData,
        {
          onSuccess: (order) => {
            setCurrentOrderId(order.id);
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

    // Check if we have multiple orders or single order
    const hasMultipleOrders = currentOrderId && currentOrderId.includes(',');
    
    // If we have multiple orders, use the LAST one (most recent)
    const orderIdToUpdate = hasMultipleOrders 
      ? currentOrderId.split(',').pop() 
      : currentOrderId;

    // If two-step checkout is enabled and we have order(s), just open payment
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
      })),
    };

    // Update existing order if we have an order ID
    if (orderIdToUpdate) {
      console.log(`[POS] Updating order before payment: ${orderIdToUpdate}`);
      updateOrder(
        {
          id: orderIdToUpdate,
          data: orderData,
        },
        {
          onSuccess: (order) => {
            // Keep the updated order as current
            setCurrentOrderId(order.id);
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

  const handlePaymentConfirm = (data: any) => {
    if (!currentOrderId) return;

    const subtotal = cartItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const total = subtotal - discount;

    // If we have multiple orders, use the first one for payment
    // (In a real scenario, you might want to create a combined payment or handle each separately)
    const orderIdForPayment = currentOrderId.includes(',') 
      ? currentOrderId.split(',')[0] 
      : currentOrderId;

    console.log(`[POS] Creating payment for order: ${orderIdForPayment}`);

    createPayment(
      {
        orderId: orderIdForPayment,
        amount: total,
        method: data.method,
        transactionId: data.transactionId,
      },
      {
        onSuccess: () => {
          // Update table status to available
          if (selectedTable) {
            updateTableStatus({
              id: selectedTable.id,
              status: TableStatus.AVAILABLE,
            });
          }

          // Reset state
          setIsPaymentModalOpen(false);
          setCurrentOrderId(null);
          setSelectedTable(null);
          setCartItems([]);
          setDiscount(0);
          setCustomerName('');
          setOrderNotes('');

          toast.success(t('orderCompletedSuccess'));
        },
      }
    );
  };

  // Calculate totals
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal - discount;
  const hasCartItems = cartItems.length > 0;

  return (
    <div className="h-full pb-20 lg:pb-0">
      {/* Notification Bar */}
      <NotificationBar
        onShowPendingOrders={() => setIsPendingOrdersPanelOpen(true)}
        onShowWaiterRequests={() => setIsWaiterRequestsPanelOpen(true)}
        onShowBillRequests={() => setIsBillRequestsPanelOpen(true)}
      />

      {/* Header */}
      <div className="mb-4 md:mb-6">
  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-sm md:text-base text-gray-600">
          {isTablelessMode
            ? t('startTakingOrdersTableless')
            : t('selectTableAndStart')}
        </p>
        {/* Selected Table Indicator - Mobile/Tablet */}
        {selectedTable && !isDesktop && (
          <div className="mt-2 inline-flex items-center gap-2 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {t('table')} {selectedTable.number}
          </div>
        )}
      </div>

      {/* DESKTOP LAYOUT (≥1024px) - 3-Panel */}
      {isDesktop && (
        <div className="flex gap-6 h-[calc(100vh-200px)]">
          {/* Tables Section - hidden in tableless mode */}
          {!isTablelessMode && (
            <div className="w-1/4">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>{t('common:navigation.tables')}</CardTitle>
                </CardHeader>
                <CardContent className="overflow-y-auto h-[calc(100%-80px)]">
                  <TableGrid
                    selectedTable={selectedTable}
                    onSelectTable={handleSelectTable}
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Menu Section */}
          <div className={`flex-1 ${isTablelessMode ? 'w-3/4' : 'w-1/2'}`}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>
                  {t('common:navigation.menu')} {selectedTable && `- ${t('tableLabel')} ${selectedTable.number}`}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[calc(100%-80px)] overflow-y-auto">
                <MenuPanel onAddItem={handleAddItem} />
              </CardContent>
            </Card>
          </div>

          {/* Order Cart Section */}
          <div className="w-1/4">
            <div className="sticky top-0">
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
                isCheckingOut={isCreatingOrder || isUpdatingOrder}
                isTwoStepCheckout={isTwoStepCheckout}
                hasActiveOrder={!!currentOrderId}
              />
            </div>
          </div>
        </div>
      )}

      {/* TABLET/MOBILE LAYOUT (<1024px) - Full-screen Menu + Sticky Bar */}
      {!isDesktop && (
        <div className="h-[calc(100vh-220px)]">
          {/* Tables Section - Collapsible on mobile/tablet */}
          {!isTablelessMode && !selectedTable && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="text-lg">{t('selectTableTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="max-h-[300px] overflow-y-auto">
                <TableGrid
                  selectedTable={selectedTable}
                  onSelectTable={handleSelectTable}
                />
              </CardContent>
            </Card>
          )}

          {/* Menu Section - Full Screen */}
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-lg">
                {t('common:navigation.menu')} {selectedTable && `- ${t('tableLabel')} ${selectedTable.number}`}
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[calc(100%-70px)] overflow-y-auto">
              <MenuPanel onAddItem={handleAddItem} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* STICKY BOTTOM CART BAR - Mobile/Tablet only */}
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
      />

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
          isCheckingOut={isCreatingOrder || isUpdatingOrder}
          isTwoStepCheckout={isTwoStepCheckout}
          hasActiveOrder={!!currentOrderId}
        />
      </CartDrawer>

      {/* Payment Modal */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        total={total}
        onConfirm={handlePaymentConfirm}
        isLoading={isCreatingPayment}
      />

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
    </div>
  );
};

export default POSPage;
