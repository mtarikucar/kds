import { useState } from 'react';
import { toast } from 'sonner';
import TableGrid from '../../components/pos/TableGrid';
import MenuPanel from '../../components/pos/MenuPanel';
import OrderCart from '../../components/pos/OrderCart';
import PaymentModal from '../../components/pos/PaymentModal';
import { useCreateOrder } from '../../features/orders/ordersApi';
import { useCreatePayment } from '../../features/orders/ordersApi';
import { useUpdateTableStatus } from '../../features/tables/tablesApi';
import { Product, Table, TableStatus, OrderType } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';

interface CartItem extends Product {
  quantity: number;
  notes?: string;
}

const POSPage = () => {
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

  const { mutate: createOrder } = useCreateOrder();
  const { mutate: createPayment, isPending: isCreatingPayment } = useCreatePayment();
  const { mutate: updateTableStatus } = useUpdateTableStatus();

  const handleSelectTable = (table: Table) => {
    if (table.status === TableStatus.AVAILABLE) {
      setSelectedTable(table);
      setCartItems([]);
      setDiscount(0);
      // Update table to occupied
      updateTableStatus({
        id: table.id,
        status: TableStatus.OCCUPIED,
      });
    } else if (table.status === TableStatus.OCCUPIED) {
      setSelectedTable(table);
      toast.info('Table is occupied. You can add to existing order.');
    } else {
      toast.warning('Table is reserved');
    }
  };

  const handleAddItem = (product: Product) => {
    if (!selectedTable) {
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

  const handleCheckout = () => {
    if (!selectedTable) {
      toast.error('Please select a table');
      return;
    }

    if (cartItems.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    // Create order
    createOrder(
      {
        type: OrderType.DINE_IN,
        tableId: selectedTable.id,
        items: cartItems.map((item) => ({
          productId: item.id,
          quantity: item.quantity,
          unitPrice: item.price,
          notes: item.notes,
        })),
      },
      {
        onSuccess: (order) => {
          setCurrentOrderId(order.id);
          setIsPaymentModalOpen(true);
        },
      }
    );
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

          toast.success('Order completed successfully!');
        },
      }
    );
  };

  return (
    <div className="h-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Point of Sale</h1>
        <p className="text-gray-600">Select a table and start taking orders</p>
      </div>

      <div className="grid grid-cols-12 gap-6 h-[calc(100vh-200px)]">
        {/* Tables Section */}
        <div className="col-span-3">
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

        {/* Menu Section */}
        <div className="col-span-6">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>
                Menu {selectedTable && `- Table ${selectedTable.number}`}
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[calc(100%-80px)]">
              <MenuPanel onAddItem={handleAddItem} />
            </CardContent>
          </Card>
        </div>

        {/* Order Cart Section */}
        <div className="col-span-3">
          <OrderCart
            items={cartItems}
            discount={discount}
            onUpdateQuantity={handleUpdateQuantity}
            onRemoveItem={handleRemoveItem}
            onUpdateDiscount={setDiscount}
            onClearCart={handleClearCart}
            onCheckout={handleCheckout}
          />
        </div>
      </div>

      {/* Payment Modal */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        total={
          cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0) -
          discount
        }
        onConfirm={handlePaymentConfirm}
        isLoading={isCreatingPayment}
      />
    </div>
  );
};

export default POSPage;
