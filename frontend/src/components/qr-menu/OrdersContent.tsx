import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, ChefHat, CheckCircle2, Utensils, User, Receipt } from 'lucide-react';
import { Order } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { MenuSettings } from '../../pages/qr-menu/QRMenuLayout';

interface OrdersContentProps {
  orders: Order[];
  settings: MenuSettings;
  tenantId: string | undefined;
  tableId: string | null;
  onCallWaiter: () => void;
  onRequestBill: () => void;
  onBrowseMenu: () => void;
}

const OrdersContent: React.FC<OrdersContentProps> = ({
  orders,
  settings,
  tenantId,
  tableId,
  onCallWaiter,
  onRequestBill,
  onBrowseMenu,
}) => {
  const { t } = useTranslation('common');

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
          color: 'text-primary-600',
          bg: 'bg-primary-50',
          border: 'border-primary-200',
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

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 mb-20 md:mb-0">
      <div className="max-w-2xl mx-auto">
        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={onCallWaiter}
            className="bg-white rounded-2xl shadow-md p-5 flex flex-col items-center gap-3 hover:shadow-lg transition-all duration-200 transform hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom"
            style={{ animationDelay: '100ms' }}
          >
            <div className="p-3 rounded-full" style={{ backgroundColor: `${settings.primaryColor}15` }}>
              <User className="h-6 w-6" style={{ color: settings.primaryColor }} />
            </div>
            <span className="font-semibold text-gray-900 text-center">
              {t('waiter.call', 'Call Waiter')}
            </span>
          </button>
          <button
            onClick={onRequestBill}
            className="bg-white rounded-2xl shadow-md p-5 flex flex-col items-center gap-3 hover:shadow-lg transition-all duration-200 transform hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom"
            style={{ animationDelay: '150ms' }}
          >
            <div className="p-3 rounded-full" style={{ backgroundColor: `${settings.secondaryColor}15` }}>
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
              onClick={onBrowseMenu}
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
                          </div>
                          <span className="text-sm font-semibold text-gray-600">
                            {formatCurrency(item.subtotal, 'TRY')}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div className="border-t pt-3 mt-3 flex justify-between font-bold">
                      <span>{t('cart.total', 'Total')}</span>
                      <span style={{ color: settings.primaryColor }}>
                        {formatCurrency(order.totalAmount, 'TRY')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrdersContent;

