import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  ChefHat,
  Utensils,
  Phone,
  Receipt,
  User
} from 'lucide-react';
import { Order } from '../../types';
import { formatCurrency } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';
import MobileBottomMenu from '../../components/qr-menu/MobileBottomMenu';
import { useCustomerSocket } from '../../features/qr-menu/useCustomerSocket';

interface MenuSettings {
  primaryColor: string;
  secondaryColor: string;
}

const OrderTrackingPage = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');
  const sessionId = searchParams.get('sessionId');

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<MenuSettings>({
    primaryColor: '#FF6B6B',
    secondaryColor: '#4ECDC4',
  });

  // Fetch data function
  const fetchData = useCallback(async () => {
    if (!tenantId || !sessionId) {
      setError('Missing required information');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

      // Fetch menu settings
      const settingsResponse = await axios.get(`${API_URL}/qr-menu/${tenantId}`);
      setSettings({
        primaryColor: settingsResponse.data.settings.primaryColor,
        secondaryColor: settingsResponse.data.settings.secondaryColor,
      });

      // Fetch session orders
      const ordersResponse = await axios.get(
        `${API_URL}/customer-orders/session/${sessionId}?tenantId=${tenantId}`
      );
      setOrders(ordersResponse.data);
      setIsLoading(false);
    } catch (err: any) {
      console.error('Error fetching orders:', err);
      setError(err.response?.data?.message || 'Failed to load orders');
      setIsLoading(false);
    }
  }, [tenantId, sessionId]);

  // Socket.IO event handlers
  const handleOrderCreated = useCallback(() => {
    fetchData();
    toast.success('New order created!', { position: 'top-center' });
  }, [fetchData]);

  const handleOrderApproved = useCallback(() => {
    fetchData();
    toast.success('Order approved! Sending to kitchen...', { position: 'top-center' });
  }, [fetchData]);

  const handleOrderStatusUpdated = useCallback((data: any) => {
    fetchData();
    const statusMessages: Record<string, string> = {
      PREPARING: 'Your order is being prepared',
      READY: 'Your order is ready!',
      SERVED: 'Bon appétit!',
    };
    if (statusMessages[data.status]) {
      toast.info(statusMessages[data.status], { position: 'top-center' });
    }
  }, [fetchData]);

  const handleLoyaltyEarned = useCallback((data: any) => {
    toast.success(`You earned ${data.pointsEarned} loyalty points!`, {
      position: 'top-center',
      duration: 5000,
    });
  }, []);

  // Setup Socket.IO for real-time updates
  useCustomerSocket({
    sessionId: sessionId || '',
    onOrderCreated: handleOrderCreated,
    onOrderApproved: handleOrderApproved,
    onOrderStatusUpdated: handleOrderStatusUpdated,
    onLoyaltyEarned: handleLoyaltyEarned,
  });

  // Initial data fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'PENDING_APPROVAL':
        return {
          icon: Clock,
          color: 'text-yellow-600',
          bg: 'bg-yellow-50',
          border: 'border-yellow-200',
          label: t('orderStatus.pendingApproval', 'Awaiting Approval'),
        };
      case 'PENDING':
        return {
          icon: Clock,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          label: t('orderStatus.pending', 'Confirmed'),
        };
      case 'PREPARING':
        return {
          icon: ChefHat,
          color: 'text-orange-600',
          bg: 'bg-orange-50',
          border: 'border-orange-200',
          label: t('orderStatus.preparing', 'Preparing'),
        };
      case 'READY':
        return {
          icon: CheckCircle2,
          color: 'text-green-600',
          bg: 'bg-green-50',
          border: 'border-green-200',
          label: t('orderStatus.ready', 'Ready'),
        };
      case 'SERVED':
        return {
          icon: Utensils,
          color: 'text-purple-600',
          bg: 'bg-purple-50',
          border: 'border-purple-200',
          label: t('orderStatus.served', 'Served'),
        };
      default:
        return {
          icon: Clock,
          color: 'text-gray-600',
          bg: 'bg-gray-50',
          border: 'border-gray-200',
          label: status,
        };
    }
  };

  const handleCallWaiter = async () => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      await axios.post(`${API_URL}/customer-orders/waiter-requests`, {
        tenantId,
        tableId,
        sessionId,
      });
      alert(t('waiter.callSuccess', 'Waiter has been notified!'));
    } catch (err) {
      console.error('Error calling waiter:', err);
      alert(t('waiter.callError', 'Failed to call waiter'));
    }
  };

  const handleRequestBill = async () => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      await axios.post(`${API_URL}/customer-orders/bill-requests`, {
        tenantId,
        tableId,
        sessionId,
      });
      alert(t('bill.requestSuccess', 'Bill request sent!'));
    } catch (err) {
      console.error('Error requesting bill:', err);
      alert(t('bill.requestError', 'Failed to request bill'));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => navigate(`/qr-menu/${tenantId}${tableId ? `?tableId=${tableId}` : ''}`)}
          className="px-6 py-3 rounded-lg font-semibold text-white"
          style={{ backgroundColor: settings.primaryColor }}
        >
          {t('common.backToMenu', 'Back to Menu')}
        </button>
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
              {t('orders.title', 'My Orders')}
            </h1>
            <p className="text-white/80 text-sm mt-0.5">
              {t('orders.trackYourOrders', 'Track your orders in real-time')}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 pt-28 pb-40">
        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={handleCallWaiter}
            className="bg-white rounded-2xl shadow-md p-5 flex flex-col items-center gap-3 hover:shadow-lg transition-all duration-200 transform hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom"
            style={{ animationDelay: '100ms' }}
          >
            <div
              className="p-3 rounded-full"
              style={{ backgroundColor: `${settings.primaryColor}15` }}
            >
              <User className="h-6 w-6" style={{ color: settings.primaryColor }} />
            </div>
            <span className="font-semibold text-gray-900 text-center">
              {t('waiter.call', 'Call Waiter')}
            </span>
          </button>
          <button
            onClick={handleRequestBill}
            className="bg-white rounded-2xl shadow-md p-5 flex flex-col items-center gap-3 hover:shadow-lg transition-all duration-200 transform hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom"
            style={{ animationDelay: '150ms' }}
          >
            <div
              className="p-3 rounded-full"
              style={{ backgroundColor: `${settings.secondaryColor}15` }}
            >
              <Receipt className="h-6 w-6" style={{ color: settings.secondaryColor }} />
            </div>
            <span className="font-semibold text-gray-900 text-center">
              {t('bill.request', 'Request Bill')}
            </span>
          </button>
        </div>

        {/* Orders List */}
        {orders.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center animate-in fade-in zoom-in-95 duration-300">
            <Clock className="h-16 w-16 text-gray-300 mx-auto mb-4 animate-pulse" />
            <h2 className="text-xl font-semibold text-gray-700 mb-2">
              {t('orders.noOrders', 'No orders yet')}
            </h2>
            <p className="text-gray-500 mb-6">
              {t('orders.noOrdersDescription', 'Start by browsing our menu')}
            </p>
            <button
              onClick={() => navigate(`/qr-menu/${tenantId}${tableId ? `?tableId=${tableId}` : ''}`)}
              className="px-6 py-3 rounded-lg font-semibold text-white transition-all duration-200 transform hover:scale-105 active:scale-95"
              style={{ backgroundColor: settings.primaryColor }}
            >
              {t('common.browseMenu', 'Browse Menu')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order, index) => {
              const statusInfo = getStatusInfo(order.status);
              const StatusIcon = statusInfo.icon;

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl shadow-md overflow-hidden animate-in fade-in slide-in-from-bottom transition-all duration-200 hover:shadow-lg"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {/* Order Header */}
                  <div className={`p-4 border-b-2 ${statusInfo.border} ${statusInfo.bg}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <StatusIcon className={`h-5 w-5 ${statusInfo.color}`} />
                        <span className={`font-semibold ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </div>
                      <span className="text-sm text-gray-600">
                        #{order.orderNumber}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(order.createdAt).toLocaleString()}
                    </div>
                  </div>

                  {/* Order Items */}
                  <div className="p-4">
                    {order.orderItems?.map(item => (
                      <div key={item.id} className="mb-3 last:mb-0">
                        <div className="flex justify-between items-start mb-1">
                          <div className="flex-1">
                            <span className="font-medium text-gray-900">
                              {item.quantity}x {item.product?.name}
                            </span>
                            {item.modifiers && item.modifiers.length > 0 && (
                              <div className="ml-4 mt-1 space-y-1">
                                {item.modifiers.map(mod => (
                                  <div key={mod.id} className="text-xs text-gray-500">
                                    • {mod.modifier?.displayName}
                                  </div>
                                ))}
                              </div>
                            )}
                            {item.notes && (
                              <div className="ml-4 mt-1 text-xs text-gray-500 italic">
                                Note: {item.notes}
                              </div>
                            )}
                          </div>
                          <span className="text-sm font-semibold text-gray-700">
                            {formatCurrency(Number(item.subtotal), 'USD')}
                          </span>
                        </div>
                      </div>
                    ))}

                    {/* Order Total */}
                    <div className="border-t pt-3 mt-3 flex justify-between items-center">
                      <span className="font-bold text-gray-900">{t('orders.total', 'Toplam')}</span>
                      <span
                        className="text-xl font-bold"
                        style={{ color: settings.primaryColor }}
                      >
                        {formatCurrency(Number(order.finalAmount), 'USD')}
                      </span>
                    </div>

                    {/* Order Notes */}
                    {order.notes && (
                      <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-600">
                          <strong>{t('orders.note', 'Not')}:</strong> {order.notes}
                        </p>
                      </div>
                    )}

                    {/* Customer Phone */}
                    {order.customerPhone && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                        <Phone className="h-3 w-3" />
                        <span>{order.customerPhone}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>



      {/* Mobile Bottom Menu */}
      <MobileBottomMenu
        tenantId={tenantId}
        tableId={tableId}
        primaryColor={settings.primaryColor}
        secondaryColor={settings.secondaryColor}
        currentPage="orders"
      />
    </div>
  );
};

export default OrderTrackingPage;
