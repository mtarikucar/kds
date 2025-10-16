import { Trash2, Plus, Minus } from 'lucide-react';
import { Product } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { formatCurrency } from '../../lib/utils';

interface CartItem extends Product {
  quantity: number;
  notes?: string;
}

interface OrderCartProps {
  items: CartItem[];
  discount: number;
  customerName: string;
  orderNotes: string;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onUpdateDiscount: (discount: number) => void;
  onUpdateCustomerName: (name: string) => void;
  onUpdateOrderNotes: (notes: string) => void;
  onClearCart: () => void;
  onCheckout: () => void;
  isCheckingOut?: boolean;
}

const OrderCart = ({
  items,
  discount,
  customerName,
  orderNotes,
  onUpdateQuantity,
  onRemoveItem,
  onUpdateDiscount,
  onUpdateCustomerName,
  onUpdateOrderNotes,
  onClearCart,
  onCheckout,
  isCheckingOut = false,
}: OrderCartProps) => {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal - discount;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Current Order</CardTitle>
        {items.length > 0 && (
          <Button variant="outline" size="sm" onClick={onClearCart}>
            Clear All
          </Button>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col">
        {items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <p>No items in cart</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-3 mb-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">{item.name}</h4>
                    <p className="text-sm text-gray-600">
                      {formatCurrency(item.price)} x {item.quantity}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onUpdateQuantity(item.id, Math.max(1, item.quantity - 1))
                        }
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center font-medium">
                        {item.quantity}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => onRemoveItem(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-3 border-t pt-4">
              <Input
                label="Customer Name (Optional)"
                type="text"
                placeholder="Enter customer name"
                value={customerName}
                onChange={(e) => onUpdateCustomerName(e.target.value)}
              />

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">
                  Order Notes (Optional)
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="Special requests, allergies, etc."
                  rows={2}
                  value={orderNotes}
                  onChange={(e) => onUpdateOrderNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-between text-sm">
                <span>Subtotal:</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>

              <Input
                label="Discount"
                type="number"
                min="0"
                max={subtotal}
                step="0.01"
                value={discount}
                onChange={(e) => onUpdateDiscount(parseFloat(e.target.value) || 0)}
              />

              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Total:</span>
                <span>{formatCurrency(total)}</span>
              </div>

              <Button
                variant="success"
                className="w-full"
                size="lg"
                onClick={onCheckout}
                isLoading={isCheckingOut}
              >
                Checkout
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default OrderCart;
