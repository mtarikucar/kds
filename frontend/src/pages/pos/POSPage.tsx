import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import TableGrid from '../../components/pos/TableGrid';
import MenuPanel from '../../components/pos/MenuPanel';
import OrderCart from '../../components/pos/OrderCart';
import PaymentModal from '../../components/pos/PaymentModal';
import StickyCartBar from '../../components/pos/StickyCartBar';
import CartDrawer from '../../components/pos/CartDrawer';
import { useCreateOrder, useUpdateOrder, useOrders } from '../../features/orders/ordersApi';
import { useCreatePayment } from '../../features/orders/ordersApi';
import { useUpdateTableStatus } from '../../features/tables/tablesApi';
import { useGetPosSettings } from '../../features/pos/posApi';
import { Product, Table, TableStatus, OrderType, OrderStatus } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { useResponsive } from '../../hooks/useResponsive';

interface CartItem extends Product {
  quantity: number;
  notes?: string;
}

const POSPage = () => {
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);

  // Responsive hook
  const { isDesktop, isMobile, isTablet } = useResponsive();

  // Fetch POS settings
  const { data: posSettings } = useGetPosSettings();

  const { mutate: createOrder, isPending: isCreatingOrder } = useCreateOrder();
  const { mutate: updateOrder, isPending: isUpdatingOrder } = useUpdateOrder();
  const { mutate: createPayment, isPending: isCreatingPayment } = useCreatePayment();
  const { mutate: updateTableStatus } = useUpdateTableStatus();

  // Determine if tableless mode is enabled
  const isTablelessMode = posSettings?.enableTablelessMode ?? false;
  const isTwoStepCheckout = posSettings?.enableTwoStepCheckout ?? false;

  // Fetch active orders for selected table
  const { data: tableOrders, refetch: refetchOrders } = useOrders(
    selectedTable
      ? {
          tableId: selectedTable.id,
        }
      : undefined
  );

  // Load existing orders when an occupied table is selected
  useEffect(() => {
    if (selectedTable?.status === TableStatus.OCCUPIED && tableOrders) {
      // Find the most recent active order (not PAID or CANCELLED)
      const activeOrder = tableOrders.find(
        (order) =>
          order.status !== OrderStatus.PAID &&
          order.status !== OrderStatus.CANCELLED
      );

      if (activeOrder) {
        setCurrentOrderId(activeOrder.id);

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
          `Loaded existing order #${activeOrder.orderNumber} with ${items.length} items`
        );
      } else {
        // Table is marked occupied but no active orders found
        toast.warning('Table is occupied but no active orders found');
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
    } else if (table.status === TableStatus.OCCUPIED) {
      setSelectedTable(table);
      // Clear cart first - useEffect will load existing orders
      setCartItems([]);
      setDiscount(0);
      setCustomerName('');
      setOrderNotes('');
      toast.info('Loading existing order...');
    } else {
      toast.warning('Table is reserved');
    }
  };

  const handleAddItem = (product: Product) => {
    // In tableless mode, table selection is optional
    if (!isTablelessMode && !selectedTable) {
      toast.error('Please select a table first');
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
      toast.error('Please select a table');
      return;
    }

    if (cartItems.length === 0) {
      toast.error('Cart is empty');
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

    // Update existing order if currentOrderId exists, otherwise create new
    if (currentOrderId) {
      updateOrder(
        {
          id: currentOrderId,
          data: orderData,
        },
        {
          onSuccess: (order) => {
            toast.success('Order updated successfully');
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
            toast.success(`Order #${order.orderNumber} created successfully`);

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
      toast.error('Please select a table');
      return;
    }

    if (cartItems.length === 0) {
      toast.error('Cart is empty');
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
            setIsPaymentModalOpen(true);
            toast.success('Order updated successfully');
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

    createPayment(
      {
        orderId: currentOrderId,
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

          toast.success('Order completed successfully!');
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
      {/* Header */}
      <div className="mb-4 md:mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Point of Sale</h1>
        <p className="text-sm md:text-base text-gray-600">
          {isTablelessMode
            ? 'Start taking orders (table selection is optional)'
            : 'Select a table and start taking orders'}
        </p>
        {/* Selected Table Indicator - Mobile/Tablet */}
        {selectedTable && !isDesktop && (
          <div className="mt-2 inline-flex items-center gap-2 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Table {selectedTable.number}
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
                  <CardTitle>Tables</CardTitle>
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
                  Menu {selectedTable && `- Table ${selectedTable.number}`}
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
                <CardTitle className="text-lg">Select a Table</CardTitle>
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
                Menu {selectedTable && `- Table ${selectedTable.number}`}
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
    </div>
  );
};

export default POSPage;
