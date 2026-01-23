import { useTranslation } from 'react-i18next';
import { Trash2, Plus, Minus, ArrowRightLeft, ShoppingCart } from 'lucide-react';
import { Product } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

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
  onCreateOrder: () => void;
  onTransferTable?: () => void;
  isCheckingOut?: boolean;
  isTwoStepCheckout?: boolean;
  hasActiveOrder?: boolean;
  hasSelectedTable?: boolean;
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
  onCreateOrder,
  onTransferTable,
  isCheckingOut = false,
  isTwoStepCheckout = false,
  hasActiveOrder = false,
  hasSelectedTable = false,
}: OrderCartProps) => {
  const { t } = useTranslation('pos');
  const formatPrice = useFormatCurrency();
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal - discount;

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-slate-500" />
          {t('currentOrder')}
        </CardTitle>
        <div className="flex gap-2">
          {/* Transfer Button */}
          {hasActiveOrder && hasSelectedTable && onTransferTable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onTransferTable}
              title={t('transfer.buttonTitle')}
              className="text-slate-500 hover:text-slate-700"
            >
              <ArrowRightLeft className="h-4 w-4" />
            </Button>
          )}
          {items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearCart} className="text-slate-500 hover:text-red-600">
              {t('clearAll')}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 min-h-0 overflow-hidden">
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-6">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <ShoppingCart className="h-8 w-8 text-slate-300" />
            </div>
            <p className="text-sm">{t('noItemsInCart')}</p>
          </div>
        ) : (
          <>
            {/* Cart Items - Scrollable area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 bg-slate-50/80 rounded-xl border border-slate-100"
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm text-slate-900 truncate">{item.name}</h4>
                    <p className="text-sm text-slate-500">
                      {formatPrice(item.price)} × {item.quantity}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 ml-3">
                    <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-0.5">
                      <button
                        onClick={() => onUpdateQuantity(item.id, Math.max(1, item.quantity - 1))}
                        className="p-1.5 rounded-md hover:bg-slate-100 transition-colors text-slate-600"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center font-medium text-sm text-slate-900">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                        className="p-1.5 rounded-md hover:bg-slate-100 transition-colors text-slate-600"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <button
                      onClick={() => onRemoveItem(item.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Order Details & Checkout - Always visible at bottom */}
            <div className="flex-shrink-0 p-4 space-y-4 border-t border-slate-100 bg-slate-50/30">
              <Input
                label={t('customerNameLabel')}
                type="text"
                placeholder={t('customerNamePlaceholder')}
                value={customerName}
                onChange={(e) => onUpdateCustomerName(e.target.value)}
              />

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">
                  {t('orderNotesLabel')}
                </label>
                <textarea
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm resize-none shadow-sm"
                  placeholder={t('orderNotesPlaceholder')}
                  rows={2}
                  value={orderNotes}
                  onChange={(e) => onUpdateOrderNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{t('subtotal')}:</span>
                <span className="font-medium text-slate-900">{formatPrice(subtotal)}</span>
              </div>

              <Input
                label={t('discount')}
                type="number"
                min="0"
                max={subtotal}
                step="0.01"
                value={discount}
                onChange={(e) => onUpdateDiscount(parseFloat(e.target.value) || 0)}
              />

              <div className="flex justify-between text-lg font-bold border-t border-slate-200 pt-4">
                <span className="text-slate-900">{t('total')}:</span>
                <span className="text-primary-600">{formatPrice(total)}</span>
              </div>

              {/* Conditional button rendering based on checkout mode */}
              {isTwoStepCheckout ? (
                <div className="space-y-2 pt-2">
                  {/* Create Order button */}
                  <Button
                    variant="secondary"
                    className="w-full"
                    size="lg"
                    onClick={onCreateOrder}
                    isLoading={isCheckingOut}
                    disabled={hasActiveOrder && items.length === 0}
                  >
                    {hasActiveOrder ? t('updateOrder') : t('createOrder')}
                  </Button>

                  {/* Payment button */}
                  <Button
                    variant="primary"
                    className="w-full"
                    size="lg"
                    onClick={onCheckout}
                    disabled={!hasActiveOrder}
                  >
                    {t('proceedToPayment')}
                  </Button>
                </div>
              ) : (
                /* Single-step checkout button */
                <Button
                  variant="primary"
                  className="w-full"
                  size="lg"
                  onClick={onCheckout}
                  isLoading={isCheckingOut}
                >
                  {t('checkout')}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default OrderCart;
