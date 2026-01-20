import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
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
import TableActionModal from '../../components/pos/TableActionModal';
import { useUpdateTableStatus } from '../../features/tables/tablesApi';
import { useGetPosSettings } from '../../features/pos/posApi';
import { usePosSocket } from '../../features/pos/usePosSocket';
import { Product, Table, TableStatus, OrderType, OrderStatus } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { useResponsive } from '../../hooks/useResponsive';
import { cn } from '../../lib/utils';

interface CartItem extends Product {
  quantity: number;
  notes?: string;
  modifiers?: SelectedModifier[];
}

const POSPage = () => {
  const { t } = useTranslation('pos');
  const [viewMode, setViewMode] = useState<'tables' | 'ordering' | 'payment'>('tables');
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
  const [isTableActionModalOpen, setIsTableActionModalOpen] = useState(false);
  const [isOrderSummaryOpen, setIsOrderSummaryOpen] = useState(false);
  const [isTablesPanelOpen, setIsTablesPanelOpen] = useState(false);

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

  // Reset to tables view when navigating to POS from sidebar (only if no table selected)
  useEffect(() => {
    // When location changes to /pos and no table is selected, reset to tables view
    if (location.pathname === '/pos' && !selectedTable && viewMode !== 'tables') {
      setViewMode('tables');
      setCartItems([]);
      setDiscount(0);
      setCustomerName('');
      setOrderNotes('');
      setCurrentOrderId(null);
      setCurrentOrderAmount(null);
    }
  }, [location.pathname, selectedTable, viewMode]);

  // Load existing orders when an occupied table is selected and in ordering mode
  useEffect(() => {
    if (
      selectedTable?.status === TableStatus.OCCUPIED &&
      tableOrders &&
      viewMode === 'ordering'
    ) {
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
      }
    }
  }, [selectedTable, tableOrders, viewMode]);

  const handleSelectTable = (table: Table) => {
    if (table.status === TableStatus.AVAILABLE) {
      // Boş masa: Direkt sipariş ekleme moduna geç
      setSelectedTable(table);
      setCartItems([]);
      setDiscount(0);
      setCustomerName('');
      setOrderNotes('');
      setCurrentOrderId(null);
      setCurrentOrderAmount(null);
      setViewMode('ordering');
    } else if (table.status === TableStatus.OCCUPIED) {
      // Dolu masa: Modal aç
      setSelectedTable(table);
      setIsTableActionModalOpen(true);
    } else {
      toast.warning(t('tableReserved'));
    }
  };

  const handleAddNewOrder = () => {
    // Yeni sipariş ekleme moduna geç
    // selectedTable zaten set edilmiş durumda (modal açılmadan önce)
    setCartItems([]);
    setDiscount(0);
    setCustomerName('');
    setOrderNotes('');
    setCurrentOrderId(null);
    setCurrentOrderAmount(null);
    setViewMode('ordering');
    // Masalar panelini aç (ordering modunda)
    setIsTablesPanelOpen(true);
    // Modal kapanacak ama selectedTable korunacak
  };

  const handleCloseBillFromModal = () => {
    // Tüm aktif siparişlerin toplam tutarını hesapla ve ödeme modal'ını aç
    if (tableOrders && tableOrders.length > 0) {
      const totalAmount = tableOrders.reduce(
        (sum, order) => sum + Number(order.finalAmount || 0),
        0
      );
      // İlk siparişi referans olarak kullan (tüm siparişler için ödeme yapılacak)
      const firstOrder = tableOrders[0];
      setCurrentOrderId(firstOrder.id);
      setCurrentOrderAmount(totalAmount);
      setViewMode('ordering');
      setIsPaymentModalOpen(true);
    }
  };

  const handleBackToTables = () => {
    setViewMode('tables');
    setSelectedTable(null);
    setCartItems([]);
    setDiscount(0);
    setCustomerName('');
    setOrderNotes('');
    setCurrentOrderId(null);
    setCurrentOrderAmount(null);
    setIsTablesPanelOpen(false);
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
          // Reset state after successful transfer and go back to tables view
          setIsTransferModalOpen(false);
          setViewMode('tables');
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
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Minimal Notification Bar - Only show when there are notifications */}
      <NotificationBar
        onShowPendingOrders={() => setIsPendingOrdersPanelOpen(true)}
        onShowWaiterRequests={() => setIsWaiterRequestsPanelOpen(true)}
        onShowBillRequests={() => setIsBillRequestsPanelOpen(true)}
      />

      {/* TABLES VIEW - Full screen, minimal header */}
      {viewMode === 'tables' && !isTablelessMode && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-white">
            <h1 className="text-xl font-semibold text-foreground">{t('selectTable', 'Masa Seçin')}</h1>
          </div>
          <div className="flex-1 overflow-hidden p-6">
            <TableGrid selectedTable={selectedTable} onSelectTable={handleSelectTable} />
          </div>
        </div>
      )}

      {/* ORDERING VIEW - Menu without tables panel */}
      {viewMode === 'ordering' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Main Content Area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Minimal Header - Table info + Actions */}
            <div className="px-4 md:px-6 py-3 border-b border-border bg-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                {selectedTable && (
                  <>
                    <div className="px-3 py-1.5 bg-primary-100 text-primary-700 rounded-lg font-semibold text-sm">
                      {t('tableLabel')} {selectedTable.number}
                    </div>
                    <Badge variant={selectedTable.status === TableStatus.OCCUPIED ? 'danger' : 'success'} className="text-xs">
                      {t(`tableGrid.status.${selectedTable.status}`)}
                    </Badge>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Cart Button - Shows item count */}
                {hasCartItems && (
                  <button
                    onClick={() => setIsOrderSummaryOpen(true)}
                    className="relative flex items-center gap-2 px-3 md:px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors duration-150 font-medium text-sm"
                  >
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="hidden sm:inline">{cartItems.length}</span>
                    <span className="absolute -top-1.5 -right-1.5 bg-error text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                      {cartItems.reduce((sum, item) => sum + item.quantity, 0)}
                    </span>
                  </button>
                )}
                {selectedTable && (
                  <button
                    onClick={handleBackToTables}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-neutral-100 rounded-lg transition-colors duration-150"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    <span className="hidden sm:inline">{t('backToTables', 'Masalara Dön')}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Full Screen Menu */}
            <div className="flex-1 overflow-hidden">
              <MenuPanel onAddItem={handleAddItem} />
            </div>
          </div>
        </div>
      )}


      {/* TABLELESS MODE - Show menu directly */}
      {isTablelessMode && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Minimal Header */}
          <div className="px-6 py-3 border-b border-border bg-white flex items-center justify-between">
            <h1 className="text-xl font-semibold text-foreground">{t('common:navigation.menu')}</h1>
            {hasCartItems && (
              <button
                onClick={() => setIsOrderSummaryOpen(true)}
                className="relative flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors duration-150 font-medium"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span>{cartItems.length}</span>
                <span className="hidden md:inline">{t('items', 'ürün')}</span>
                <span className="absolute -top-2 -right-2 bg-error text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                  {cartItems.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              </button>
            )}
          </div>
          {/* Full Screen Menu */}
          <div className="flex-1 overflow-hidden">
            <MenuPanel onAddItem={handleAddItem} />
          </div>
        </div>
      )}

      {/* STICKY BOTTOM CART BAR - Mobile/Tablet only, show in ordering mode */}
      {viewMode === 'ordering' && !isDesktop && (
        <StickyCartBar
          itemCount={cartItems.length}
          total={total}
          onViewCart={() => setIsOrderSummaryOpen(true)}
          onCheckout={handleCheckout}
          onCreateOrder={handleCreateOrder}
          isCheckingOut={isCreatingOrder || isUpdatingOrder}
          hasItems={hasCartItems}
          isTwoStepCheckout={isTwoStepCheckout}
          hasActiveOrder={!!currentOrderId}
        />
      )}

      {/* ORDER SUMMARY DRAWER/MODAL - Desktop: Right sidebar, Mobile: Bottom drawer */}
      {isDesktop ? (
        <>
          {/* Desktop Backdrop */}
          {isOrderSummaryOpen && (
            <div
              className="fixed inset-0 bg-black bg-opacity-30 z-40 transition-opacity"
              onClick={() => setIsOrderSummaryOpen(false)}
              aria-hidden="true"
            />
          )}
          {/* Desktop Right Sidebar */}
          <div
            className={`fixed right-0 top-0 bottom-0 w-96 bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-out ${
              isOrderSummaryOpen ? 'translate-x-0' : 'translate-x-full'
            } flex flex-col`}
          >
            <div className="flex-1 overflow-y-auto">
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
                  setIsOrderSummaryOpen(false);
                  handleCheckout();
                }}
                onCreateOrder={handleCreateOrder}
                onTransferTable={() => {
                  setIsOrderSummaryOpen(false);
                  handleTransferTable();
                }}
                isCheckingOut={isCreatingOrder || isUpdatingOrder}
                isTwoStepCheckout={isTwoStepCheckout}
                hasActiveOrder={!!currentOrderId}
                hasSelectedTable={!!selectedTable}
              />
            </div>
          </div>
        </>
      ) : (
        <CartDrawer
          isOpen={isOrderSummaryOpen || isCartDrawerOpen}
          onClose={() => {
            setIsOrderSummaryOpen(false);
            setIsCartDrawerOpen(false);
          }}
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
              setIsOrderSummaryOpen(false);
              setIsCartDrawerOpen(false);
              handleCheckout();
            }}
            onCreateOrder={handleCreateOrder}
            onTransferTable={() => {
              setIsOrderSummaryOpen(false);
              setIsCartDrawerOpen(false);
              handleTransferTable();
            }}
            isCheckingOut={isCreatingOrder || isUpdatingOrder}
            isTwoStepCheckout={isTwoStepCheckout}
            hasActiveOrder={!!currentOrderId}
            hasSelectedTable={!!selectedTable}
          />
        </CartDrawer>
      )}

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

      {/* Table Action Modal */}
      {selectedTable && selectedTable.status === TableStatus.OCCUPIED && (
        <TableActionModal
          isOpen={isTableActionModalOpen}
          onClose={() => {
            setIsTableActionModalOpen(false);
            // Sadece modal kapatıldığında (X veya backdrop) masa seçimini temizle
            // "Sipariş Ekle" butonuna tıklandığında handleAddNewOrder içinde modal kapanacak
            // ama selectedTable korunacak
            if (viewMode === 'tables') {
              setSelectedTable(null);
            }
          }}
          table={selectedTable}
          onAddOrder={() => {
            // Önce modal'ı kapat, sonra ordering moduna geç
            setIsTableActionModalOpen(false);
            // selectedTable korunacak, sadece viewMode değişecek
            handleAddNewOrder();
          }}
          onCloseBill={handleCloseBillFromModal}
        />
      )}
    </div>
  );
};

export default POSPage;
