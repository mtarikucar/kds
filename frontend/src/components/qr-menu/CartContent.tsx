import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Plus, Minus, MessageSquare, AlertCircle, Phone, ClipboardList } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { useCartStore } from '../../store/cartStore';
import { MenuSettings } from '../../pages/qr-menu/QRMenuLayout';

interface CartContentProps {
  settings: MenuSettings;
  enableCustomerOrdering: boolean;
  currency: string;
  onSubmitOrder: () => void;
  onShowTableSelection: () => void;
  isSubmitting: boolean;
}

const CartContent: React.FC<CartContentProps> = ({
  settings,
  enableCustomerOrdering,
  currency,
  onSubmitOrder,
  onShowTableSelection,
  isSubmitting,
}) => {
  const { t } = useTranslation('common');
  const { items, updateItemQuantity, removeItem, getSubtotal, getTotal } = useCartStore();
  const [specialNotes, setSpecialNotes] = useState('');

  if (items.length === 0) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 mb-20 md:mb-0">
        <div className="max-w-2xl mx-auto text-center py-12">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: `${settings.primaryColor}15` }}
          >
            <ClipboardList className="h-8 w-8" style={{ color: settings.primaryColor }} />
          </div>
          <p className="text-gray-600 text-lg">{t('cart.empty', 'Your cart is empty')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 mb-20 md:mb-0">
      <div className="max-w-2xl mx-auto">
        {/* Cart Items */}
        <div className="space-y-3 mb-6">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="bg-white rounded-2xl shadow-lg hover:shadow-xl p-4 animate-in fade-in slide-in-from-bottom duration-300 transition-all border-l-4"
              style={{
                animationDelay: `${index * 30}ms`,
                borderLeftColor: settings.primaryColor,
              }}
            >
              <div className="flex gap-4">
                <div className="flex-1">
                  <h3 className="font-bold text-lg mb-1" style={{ color: settings.secondaryColor }}>
                    {item.product.name}
                  </h3>
                  <p className="text-sm font-semibold mb-2" style={{ color: settings.primaryColor }}>
                    {formatCurrency(item.product.price, currency)}
                  </p>

                  {/* Modifiers */}
                  {item.modifiers.length > 0 && (
                    <div className="space-y-1 mb-3 p-2 bg-gray-50 rounded-lg">
                      {item.modifiers.map(mod => (
                        <div key={mod.id} className="text-xs text-gray-600 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: settings.primaryColor }}></span>
                            {mod.displayName}
                          </span>
                          {mod.priceAdjustment > 0 && (
                            <span className="font-semibold text-green-600">
                              +{formatCurrency(mod.priceAdjustment, currency)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {item.notes && (
                    <div className="text-sm text-gray-600 flex items-start gap-2 mb-3 p-2 bg-blue-50 rounded-lg">
                      <MessageSquare className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: settings.primaryColor }} />
                      <span className="italic">{item.notes}</span>
                    </div>
                  )}

                  {/* Quantity Controls */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateItemQuantity(item.id, item.quantity - 1)}
                      className="p-3 rounded-lg border-2 transition-all hover:scale-110 active:scale-95 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      style={{ borderColor: settings.primaryColor, color: settings.primaryColor }}
                    >
                      <Minus className="h-5 w-5" />
                    </button>
                    <span className="w-10 text-center font-bold text-lg" style={{ color: settings.secondaryColor }}>
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateItemQuantity(item.id, item.quantity + 1)}
                      className="p-3 rounded-lg border-2 transition-all hover:scale-110 active:scale-95 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      style={{ borderColor: settings.primaryColor, color: settings.primaryColor }}
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col items-end justify-between">
                  <span className="font-bold text-lg" style={{ color: settings.primaryColor }}>
                    {formatCurrency(item.itemTotal, currency)}
                  </span>
                  <button
                    onClick={() => removeItem(item.id)}
                    className="p-2 rounded-lg hover:bg-red-50 transition-all"
                  >
                    <Trash2 className="h-5 w-5 text-red-600" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Special Notes */}
        <div className="bg-white rounded-2xl shadow-md p-4 mb-6">
          <label className="block text-sm font-semibold mb-2" style={{ color: settings.secondaryColor }}>
            {t('cart.specialNotes', 'Special Notes')}
          </label>
          <textarea
            value={specialNotes}
            onChange={(e) => setSpecialNotes(e.target.value)}
            placeholder={t('cart.notesPlaceholder', 'Any special requests?')}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-opacity-50 resize-none"
            style={{ focusRingColor: settings.primaryColor }}
            rows={3}
          />
        </div>

        {/* Order Summary */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6 space-y-3">
          <div className="flex justify-between text-gray-600">
            <span>{t('cart.subtotal', 'Subtotal')}</span>
            <span>{formatCurrency(getSubtotal(), currency)}</span>
          </div>
          <div className="border-t pt-3 flex justify-between font-bold text-lg" style={{ color: settings.primaryColor }}>
            <span>{t('cart.total', 'Total')}</span>
            <span>{formatCurrency(getTotal(), currency)}</span>
          </div>
        </div>

        {/* Submit Button */}
        <button
          onClick={onSubmitOrder}
          disabled={isSubmitting}
          className="w-full py-4 rounded-2xl font-bold text-white transition-all duration-200 transform hover:scale-105 active:scale-95 disabled:opacity-50"
          style={{ backgroundColor: settings.primaryColor }}
        >
          {isSubmitting ? t('cart.submitting') : t('cart.placeOrder')}
        </button>

        {enableCustomerOrdering && (
          <p className="text-xs text-center text-gray-500 mt-2">
            {t('cart.approvalNote', 'Your order will be sent to staff for approval')}
          </p>
        )}
      </div>
    </div>
  );
};

export default CartContent;

