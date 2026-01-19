import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import TableGrid from '../../components/pos/TableGrid';
import MenuPanel from '../../components/pos/MenuPanel';
import OrderCart from '../../components/pos/OrderCart';
import PaymentModal from '../../components/pos/PaymentModal';
import ProductOptionsModal, { SelectedModifier } from '../../components/pos/ProductOptionsModal';
import StickyCartBar from '../../components/pos/StickyCartBar';
import CartDrawer from '../../components/pos/CartDrawer';
import NotificationBar from '../../components/pos/NotificationBar';
import PendingOrdersPanel from '../../components/pos/PendingOrdersPanel';
import WaiterRequestsPanel from '../../components/pos/WaiterRequestsPanel';
import BillRequestsPanel from '../../components/pos/BillRequestsPanel';
import { useCreateOrder, useUpdateOrder, useOrders, useTransferTableOrders } from '../../features/orders/ordersApi';
import { useCreatePayment } from '../../features/orders/ordersApi';
import TransferTableModal from '../../components/pos/TransferTableModal';
import { useUpdateTableStatus } from '../../features/tables/tablesApi';
import { useGetPosSettings } from '../../features/pos/posApi';
import { usePosSocket } from '../../features/pos/usePosSocket';
import { Product, Table, TableStatus, OrderType, OrderStatus } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { useResponsive } from '../../hooks/useResponsive';

interface CartItem extends Product {
  quantity: number;
  notes?: string;
  modifiers?: SelectedModifier[];
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
  const [currentOrderAmount, setCurrentOrderAmount] = useState<number | null>(null);
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const [isPendingOrdersPanelOpen, setIsPendingOrdersPanelOpen] = useState(false);
  const [isWaiterRequestsPanelOpen, setIsWaiterRequestsPanelOpen] = useState(false);
  const [isBillRequestsPanelOpen, setIsBillRequestsPanelOpen] = useState(false);
  const [isProductOptionsModalOpen, setIsProductOptionsModalOpen] = useState(false);
  const [productForOptions, setProductForOptions] = useState<Product | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  // Responsive hook
  const { isDesktop, isMobile, isTablet } = useResponsive();

  // Socket.IO for real-time updates
  usePosSocket();

  // Fetch POS settings
  const { data: posSettings } = useGetPosSettings();

  const { mutate: createOrder, isPending: isCreatingOrder } = useCreateOrder();
  const { mutate: updateOrder, isPending: isUpdatingOrder } = useUpdateOrder();
  const { mutate: createPayment, isPending: isCreatingPayment } = useCreatePayment();
  const { mutate: updateTableStatus } = useUpdateTableStatus();
  const { mutate: transferTableOrders, isPending: isTransferring } = useTransferTableOrders();

  // Determine if tableless mode is enabled
  const isTablelessMode = posSettings?.enableTablelessMode ?? false;
  const isTwoStepCheckout = posSettings?.enableTwoStepCheckout ?? false;

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
      } else {
        // Table is marked occupied but no active orders found
  toast.warning(t('tableOccupiedNoOrders'));
      }
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
    } else if (table.status === TableStatus.OCCUPIED) {
      setSelectedTable(table);
      // Clear cart first - useEffect will load existing orders
      setCartItems([]);
      setDiscount(0);
      setCustomerName('');
      setOrderNotes('');
  toast.info(t('loadingExistingOrder'));
    } else {
  toast.warning(t('tableReserved'));
    }
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

  const handlePaymentConfirm = (data: { method: string; transactionId?: string; customerPhone?: string }) => {
    if (!currentOrderId || currentOrderAmount === null) return;

    // Use the order's actual finalAmount, not recalculated from cart
    const total = currentOrderAmount;

    createPayment(
      {
        orderId: currentOrderId,
        amount: total,
        method: data.method as any,
        transactionId: data.transactionId,
        customerPhone: data.customerPhone || undefined,
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
          setCurrentOrderAmount(null);
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
                <CardContent className="overflow-y-auto">
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
                onTransferTable={handleTransferTable}
                isCheckingOut={isCreatingOrder || isUpdatingOrder}
                isTwoStepCheckout={isTwoStepCheckout}
                hasActiveOrder={!!currentOrderId}
                hasSelectedTable={!!selectedTable}
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
          onTransferTable={() => {
            setIsCartDrawerOpen(false);
            handleTransferTable();
          }}
          isCheckingOut={isCreatingOrder || isUpdatingOrder}
          isTwoStepCheckout={isTwoStepCheckout}
          hasActiveOrder={!!currentOrderId}
          hasSelectedTable={!!selectedTable}
        />
      </CartDrawer>

      {/* Payment Modal */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        total={currentOrderAmount ?? total}
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
