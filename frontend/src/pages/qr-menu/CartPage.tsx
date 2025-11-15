import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { ArrowLeft, Trash2, Plus, Minus, ShoppingBag, Check, Phone, MessageSquare, ClipboardList, AlertCircle } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { formatCurrency } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';
import MobileBottomMenu from '../../components/qr-menu/MobileBottomMenu';
import TableSelectionModal from '../../components/qr-menu/TableSelectionModal';

interface MenuSettings {
  primaryColor: string; 
  secondaryColor: string;
}

interface MenuData {
  settings: MenuSettings;
  enableCustomerOrdering: boolean;
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
    tableId: cartTableId,
    updateItemQuantity,
    removeItem,
    clearCart,
    getSubtotal,
    getTotal,
    setTableId,
  } = useCartStore();

  const [settings, setSettings] = useState<MenuSettings>({
    primaryColor: '#FF6B6B',
    secondaryColor: '#4ECDC4',
  });
  const [enableCustomerOrdering, setEnableCustomerOrdering] = useState(true);
  const [enableTablelessMode, setEnableTablelessMode] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTableSelection, setShowTableSelection] = useState(false);

  useEffect(() => {
    // Fetch menu settings for colors and ordering status
    const fetchSettings = async () => {
      try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const response = await axios.get(`${API_URL}/qr-menu/${tenantId}`);
        setSettings({
          primaryColor: response.data.settings.primaryColor,
          secondaryColor: response.data.settings.secondaryColor,
        });
        setEnableCustomerOrdering(response.data.enableCustomerOrdering ?? true);
        setEnableTablelessMode(response.data.enableTablelessMode ?? false);
      } catch (err) {
        console.error('Error fetching settings:', err);
      }
    };

    if (tenantId) {
      fetchSettings();
    }
  }, [tenantId]);

  const handleSubmitOrder = async () => {
    // Determine effective tableId (from URL or cart store)
    const effectiveTableId = tableId || cartTableId;

    // Check basic tenant requirement
    if (!tenantId) {
      setError('Missing required information');
      return;
    }

    // Check if customer ordering is enabled
    if (!enableCustomerOrdering) {
      setError(t('qrMenu.orderingDisabled'));
      return;
    }

    // If tableId is missing, show table selection modal
    if (!effectiveTableId) {
      setShowTableSelection(true);
      return;
    }

    // Final validation before submission
    if (!sessionId) {
      setError('Missing session information. Please refresh the page.');
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
        tableId: effectiveTableId,
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
        navigate(`/qr-menu/${tenantId}/orders?tableId=${effectiveTableId}&sessionId=${sessionId}`);
      }, 2000);
    } catch (err: any) {
      console.error('Error submitting order:', err);

      // Handle 403 Forbidden specifically (ordering disabled)
      if (err.response?.status === 403) {
        setError(t('qrMenu.orderingDisabled'));
      } else {
        setError(err.response?.data?.message || 'Failed to submit order');
      }

      setIsSubmitting(false);
    }
  };

  if (items.length === 0 && !orderSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50 p-4 animate-in fade-in duration-500">
        <div className="relative">
          <div className="absolute inset-0 animate-pulse"
            style={{
              background: `radial-gradient(circle, ${settings.primaryColor}20 0%, transparent 70%)`
            }}
          ></div>
          <ShoppingBag className="h-28 w-28 mb-6 relative" style={{ color: settings.primaryColor, opacity: 0.4 }} />
        </div>
        <h2 className="text-3xl font-black mb-3"
          style={{
            color: settings.primaryColor
          }}
        >
          {t('cart.empty', 'Your cart is empty')}
        </h2>
        <p className="text-gray-600 mb-8 text-center text-lg font-medium">
          {t('cart.emptyDescription', 'Add some delicious items to get started')}
        </p>
        <button
          onClick={() => navigate(`/qr-menu/${tenantId}${tableId ? `?tableId=${tableId}` : ''}`)}
          className="px-8 py-4 rounded-xl font-bold text-white transition-all hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl"
          style={{ 
            background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`
          }}
        >
          {t('cart.backToMenu', 'Back to Menu')}
        </button>
      </div>
    );
  }

  if (orderSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-green-50 via-white to-green-50 p-4 animate-in fade-in zoom-in duration-500">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-green-400/20 rounded-full animate-ping"></div>
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-2xl relative">
            <Check className="h-14 w-14 text-white animate-in zoom-in duration-300" style={{ animationDelay: '200ms' }} />
          </div>
        </div>
        <h2 className="text-3xl font-black text-gray-900 mb-3">
          {t('cart.orderSuccess', 'Order Submitted!')}
        </h2>
        <p className="text-gray-600 text-center text-lg mb-6 max-w-md">
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
    <div className="min-h-screen bg-gray-50 animate-in fade-in duration-300">
      {/* Header - Fixed */}
      <div
        className="fixed top-0 left-0 right-0 z-20 shadow-2xl animate-in slide-in-from-top duration-300"
        style={{
          background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
        }}
      >
        <div className="px-4 py-5 flex items-center gap-4">
          <button
            onClick={() => navigate(`/qr-menu/${tenantId}${tableId ? `?tableId=${tableId}` : ''}`)}
            className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 transition-all duration-200 transform hover:scale-110 active:scale-95"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">
              {t('cart.title', 'Your Cart')}
            </h1>
            <p className="text-white/80 text-sm mt-0.5">
              {items.length} {t('cart.items', 'Items')}
            </p>
          </div>
          {/* My Orders Button */}
          {tableId && sessionId && (
            <button
              onClick={() => navigate(`/qr-menu/${tenantId}/orders?tableId=${tableId}&sessionId=${sessionId}`)}
              className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 transition-all duration-200 transform hover:scale-110 active:scale-95"
              title={t('orders.myOrders', 'My Orders')}
            >
              <ClipboardList className="h-5 w-5 text-white" />
            </button>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 pt-28 pb-40">
        {/* Cart Items - Enhanced Design */}
        <div className="space-y-3 mb-6">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="bg-white rounded-2xl shadow-lg hover:shadow-xl p-4 animate-in fade-in slide-in-from-bottom duration-300 transition-all border-l-4"
              style={{ 
                animationDelay: `${index * 30}ms`,
                borderLeftColor: settings.primaryColor
              }}
            >
              <div className="flex gap-4">
                <div className="flex-1">
                  <h3 className="font-bold text-lg mb-1" style={{ color: settings.secondaryColor }}>
                    {item.product.name}
                  </h3>
                  <p className="text-sm font-semibold mb-2" style={{ color: settings.primaryColor }}>
                    {formatCurrency(item.product.price, 'USD')}
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
                              +{formatCurrency(mod.priceAdjustment, 'USD')}
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

                  {/* Quantity Controls - Enhanced */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => updateItemQuantity(item.id, item.quantity - 1)}
                      className="p-2 rounded-lg border-2 transition-all hover:scale-110 active:scale-95"
                      style={{ 
                        borderColor: settings.primaryColor,
                        color: settings.primaryColor
                      }}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-10 text-center font-bold text-lg" style={{ color: settings.secondaryColor }}>
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateItemQuantity(item.id, item.quantity + 1)}
                      className="p-2 rounded-lg border-2 transition-all hover:scale-110 active:scale-95"
                      style={{ 
                        borderColor: settings.primaryColor,
                        color: settings.primaryColor
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col items-end justify-between">
                  <button
                    onClick={() => removeItem(item.id)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all hover:scale-110 active:scale-95"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                  <div className="text-right">
                    <div className="text-xs text-gray-500 mb-1">{t('cart.total')}</div>
                    <div className="font-black text-xl" style={{ 
                      color: settings.primaryColor
                    }}>
                      {formatCurrency(item.itemTotal, 'USD')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Customer Phone - Enhanced */}
        <div className="bg-white rounded-2xl shadow-lg p-5 mb-4 border-l-4 hover:shadow-xl transition-all"
          style={{ borderLeftColor: settings.primaryColor }}
        >
          <label className="block text-sm font-bold mb-3 flex items-center gap-2" style={{ color: settings.secondaryColor }}>
            <Phone className="h-5 w-5" style={{ color: settings.primaryColor }} />
            {t('cart.phoneNumber', 'Phone Number (Optional)')}
          </label>
          <input
            type="tel"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="+90 555 123 4567"
            className="w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-opacity-50 transition-all"
            style={{ 
              '--tw-ring-color': settings.primaryColor,
              borderColor: customerPhone ? settings.primaryColor : '#e5e7eb'
            } as React.CSSProperties}
          />
        </div>

        {/* Order Notes - Enhanced */}
        <div className="bg-white rounded-2xl shadow-lg p-5 mb-4 border-l-4 hover:shadow-xl transition-all"
          style={{ borderLeftColor: settings.secondaryColor }}
        >
          <label className="block text-sm font-bold mb-3 flex items-center gap-2" style={{ color: settings.secondaryColor }}>
            <MessageSquare className="h-5 w-5" style={{ color: settings.secondaryColor }} />
            {t('cart.orderNotes', 'Order Notes (Optional)')}
          </label>
          <textarea
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            placeholder={t('cart.notesPlaceholder', 'Any special requests?')}
            className="w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-opacity-50 resize-none transition-all"
            style={{ '--tw-ring-color': settings.primaryColor } as React.CSSProperties}
            rows={3}
          />
        </div>

        {/* Tableless Mode Warning */}
        {/* Ordering Disabled Warning */}
        {!enableCustomerOrdering && (
          <div className="bg-blue-50 border-l-4 border-blue-500 rounded-xl p-4 mb-4 shadow-lg animate-in slide-in-from-top">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-blue-800 font-semibold text-sm mb-1">
                  {t('qrMenu.orderingDisabled', 'Ordering Currently Disabled')}
                </p>
                <p className="text-blue-700 text-xs">
                  {t('qrMenu.orderingDisabledDescription', 'Online ordering is temporarily disabled. Please contact staff to place your order.')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error Message - Enhanced */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-xl p-4 mb-4 shadow-lg animate-in slide-in-from-top">
            <p className="text-red-700 font-semibold text-sm flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full"></span>
              {error}
            </p>
          </div>
        )}

        {/* Summary and Checkout - Enhanced */}
        <div className="bg-white shadow-2xl rounded-2xl p-6 mt-6 border-2"
          style={{ borderColor: settings.primaryColor }}
        >
          {/* Summary */}
          <div className="space-y-3 mb-6">
            <div className="flex justify-between text-base">
              <span className="text-gray-600 font-medium">{t('cart.subtotal', 'Subtotal')}</span>
              <span className="font-bold text-gray-900">{formatCurrency(getSubtotal(), 'USD')}</span>
            </div>
            <div className="h-px bg-gradient-to-r opacity-30"
              style={{ 
                backgroundImage: `linear-gradient(90deg, ${settings.primaryColor}, ${settings.secondaryColor})`
              }}
            ></div>
            <div className="flex justify-between text-xl font-black">
              <span style={{ color: settings.secondaryColor }}>{t('cart.total', 'Total')}</span>
              <span style={{ 
                color: settings.primaryColor
              }}>
                {formatCurrency(getTotal(), 'USD')}
              </span>
            </div>
          </div>

          {/* Checkout Button - Enhanced */}
          <button
            onClick={handleSubmitOrder}
            disabled={isSubmitting || !enableCustomerOrdering}
            className="w-full py-4 rounded-xl font-black text-white text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl"
            style={{
              background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`
            }}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner size="sm" />
                {t('cart.submitting', 'Submitting...')}
              </span>
            ) : !enableCustomerOrdering ? (
              t('cart.orderingDisabled', 'Ordering Disabled')
            ) : (
              t('cart.placeOrder', 'Place Order')
            )}
          </button>
          {enableCustomerOrdering && (
            <p className="text-xs text-center text-gray-500 mt-2">
              {t('cart.approvalNote', 'Your order will be sent to staff for approval')}
            </p>
          )}
        </div>
      </div>

      {/* Mobile Bottom Menu */}
      <MobileBottomMenu
        tenantId={tenantId}
        tableId={tableId}
        primaryColor={settings.primaryColor}
        secondaryColor={settings.secondaryColor}
        currentPage="cart"
      />

      {/* Table Selection Modal */}
      {showTableSelection && tenantId && (
        <TableSelectionModal
          isOpen={showTableSelection}
          onClose={() => setShowTableSelection(false)}
          onSelectTable={(selectedTableId) => {
            setTableId(selectedTableId);
            setShowTableSelection(false);
            // Auto-retry order submission after table selection
            setTimeout(() => handleSubmitOrder(), 300);
          }}
          tenantId={tenantId}
          primaryColor={settings.primaryColor}
          secondaryColor={settings.secondaryColor}
        />
      )}
    </div>
  );
};

export default CartPage;
