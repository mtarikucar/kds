import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { ArrowLeft, Trash2, Plus, Minus, ShoppingBag, Check, Phone, MessageSquare } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { formatCurrency } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';

interface MenuSettings {
  primaryColor: string;
  secondaryColor: string;
}

const CartPage = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');

  const {
    items,
    sessionId,
    updateItemQuantity,
    removeItem,
    clearCart,
    getSubtotal,
    getTotal,
  } = useCartStore();

  const [settings, setSettings] = useState<MenuSettings>({
    primaryColor: '#FF6B6B',
    secondaryColor: '#4ECDC4',
  });
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch menu settings for colors
    const fetchSettings = async () => {
      try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const response = await axios.get(`${API_URL}/qr-menu/${tenantId}`);
        setSettings({
          primaryColor: response.data.settings.primaryColor,
          secondaryColor: response.data.settings.secondaryColor,
        });
      } catch (err) {
        console.error('Error fetching settings:', err);
      }
    };

    if (tenantId) {
      fetchSettings();
    }
  }, [tenantId]);

  const handleSubmitOrder = async () => {
    if (!tenantId || !tableId || !sessionId) {
      setError('Missing required information');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

      // Transform cart items to API format
      const orderItems = items.map(item => ({
        productId: item.product.id,
        quantity: item.quantity,
        notes: item.notes,
        modifiers: item.modifiers.map(mod => ({
          modifierId: mod.id,
          quantity: mod.quantity,
          priceAdjustment: mod.priceAdjustment,
        })),
      }));

      const orderData = {
        tenantId,
        tableId,
        sessionId,
        customerPhone: customerPhone || undefined,
        items: orderItems,
        notes: orderNotes || undefined,
      };

      await axios.post(`${API_URL}/customer-orders`, orderData);

      setOrderSuccess(true);
      clearCart();

      // Redirect to order tracking after 2 seconds
      setTimeout(() => {
        navigate(`/qr-menu/${tenantId}/orders?tableId=${tableId}&sessionId=${sessionId}`);
      }, 2000);
    } catch (err: any) {
      console.error('Error submitting order:', err);
      setError(err.response?.data?.message || 'Failed to submit order');
      setIsSubmitting(false);
    }
  };

  if (items.length === 0 && !orderSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <ShoppingBag className="h-24 w-24 text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold text-gray-700 mb-2">
          {t('cart.empty', 'Your cart is empty')}
        </h2>
        <p className="text-gray-500 mb-6 text-center">
          {t('cart.emptyDescription', 'Add some delicious items to get started')}
        </p>
        <button
          onClick={() => navigate(`/qr-menu/${tenantId}${tableId ? `?tableId=${tableId}` : ''}`)}
          className="px-6 py-3 rounded-lg font-semibold text-white transition-all"
          style={{ backgroundColor: settings.primaryColor }}
        >
          {t('cart.backToMenu', 'Back to Menu')}
        </button>
      </div>
    );
  }

  if (orderSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-4">
          <Check className="h-12 w-12 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {t('cart.orderSuccess', 'Order Submitted!')}
        </h2>
        <p className="text-gray-600 text-center mb-4">
          {t('cart.orderSuccessMessage', 'Your order has been sent to the kitchen and is awaiting approval')}
        </p>
        <Spinner size="sm" />
        <p className="text-sm text-gray-500 mt-2">
          {t('cart.redirecting', 'Redirecting to order tracking...')}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div
        className="sticky top-0 z-20 shadow-lg"
        style={{
          background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
        }}
      >
        <div className="px-4 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate(`/qr-menu/${tenantId}${tableId ? `?tableId=${tableId}` : ''}`)}
            className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          <h1 className="text-xl font-bold text-white flex-1">
            {t('cart.title', 'Your Cart')}
          </h1>
          <div className="text-white text-sm font-semibold">
            {items.length} {t('cart.items', 'Items')}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 pb-32">
        {/* Cart Items */}
        <div className="space-y-4 mb-6">
          {items.map(item => (
            <div key={item.id} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 mb-1">{item.product.name}</h3>
                  <p className="text-sm text-gray-600 mb-2">
                    {formatCurrency(item.product.price, 'USD')}
                  </p>

                  {/* Modifiers */}
                  {item.modifiers.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {item.modifiers.map(mod => (
                        <div key={mod.id} className="text-xs text-gray-500 flex items-center gap-2">
                          <span>• {mod.displayName}</span>
                          {mod.priceAdjustment > 0 && (
                            <span className="text-green-600">
                              +{formatCurrency(mod.priceAdjustment, 'USD')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {item.notes && (
                    <div className="text-xs text-gray-500 flex items-center gap-1 mb-2">
                      <MessageSquare className="h-3 w-3" />
                      <span>{item.notes}</span>
                    </div>
                  )}

                  {/* Quantity Controls */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateItemQuantity(item.id, item.quantity - 1)}
                      className="p-1 rounded border border-gray-300 hover:bg-gray-50"
                    >
                      <Minus className="h-4 w-4 text-gray-600" />
                    </button>
                    <span className="w-8 text-center font-semibold">{item.quantity}</span>
                    <button
                      onClick={() => updateItemQuantity(item.id, item.quantity + 1)}
                      className="p-1 rounded border border-gray-300 hover:bg-gray-50"
                    >
                      <Plus className="h-4 w-4 text-gray-600" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col items-end justify-between">
                  <button
                    onClick={() => removeItem(item.id)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                  <div className="font-bold text-gray-900">
                    {formatCurrency(item.itemTotal, 'USD')}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Customer Phone */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <Phone className="h-4 w-4 inline mr-1" />
            {t('cart.phoneNumber', 'Phone Number (Optional)')}
          </label>
          <input
            type="tel"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="+90 555 123 4567"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50"
            style={{ focusRing: settings.primaryColor }}
          />
        </div>

        {/* Order Notes */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <MessageSquare className="h-4 w-4 inline mr-1" />
            {t('cart.orderNotes', 'Order Notes (Optional)')}
          </label>
          <textarea
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            placeholder={t('cart.notesPlaceholder', 'Any special requests?')}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 resize-none"
            style={{ focusRing: settings.primaryColor }}
            rows={3}
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}
      </div>

      {/* Fixed Bottom: Summary and Checkout */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-2xl">
        <div className="max-w-2xl mx-auto p-4">
          {/* Summary */}
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{t('cart.subtotal', 'Subtotal')}</span>
              <span className="font-semibold">{formatCurrency(getSubtotal(), 'USD')}</span>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>{t('cart.total', 'Total')}</span>
              <span style={{ color: settings.primaryColor }}>
                {formatCurrency(getTotal(), 'USD')}
              </span>
            </div>
          </div>

          {/* Checkout Button */}
          <button
            onClick={handleSubmitOrder}
            disabled={isSubmitting}
            className="w-full py-4 rounded-xl font-bold text-white text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: settings.primaryColor }}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner size="sm" />
                {t('cart.submitting', 'Submitting...')}
              </span>
            ) : (
              t('cart.placeOrder', 'Place Order')
            )}
          </button>
          <p className="text-xs text-center text-gray-500 mt-2">
            {t('cart.approvalNote', 'Your order will be sent to staff for approval')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default CartPage;
