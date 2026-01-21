import { Bell, Clock, Receipt, User } from 'lucide-react';
import { usePendingOrders, useWaiterRequests, useBillRequests } from '../../features/orders/ordersApi';
import { useTranslation } from 'react-i18next';

interface NotificationBarProps {
  onShowPendingOrders: () => void;
  onShowWaiterRequests: () => void;
  onShowBillRequests: () => void;
}

const NotificationBar = ({
  onShowPendingOrders,
  onShowWaiterRequests,
  onShowBillRequests,
}: NotificationBarProps) => {
  const { t } = useTranslation('pos');
  const { data: pendingOrders = [] } = usePendingOrders();
  const { data: waiterRequests = [] } = useWaiterRequests();
  const { data: billRequests = [] } = useBillRequests();

  const pendingCount = pendingOrders.length;
  const waiterCount = waiterRequests.length;
  const billCount = billRequests.length;
  const totalCount = pendingCount + waiterCount + billCount;

  if (totalCount === 0) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-amber-500 to-primary-500 text-white rounded-xl shadow-lg mb-6">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Bell className="h-5 w-5 animate-pulse" />
            </div>
            <span className="font-semibold">
              {totalCount} {t('notifications.pending')} {totalCount === 1 ? t('notifications.notification') : t('notifications.notifications')}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Pending Orders */}
            {pendingCount > 0 && (
              <button
                onClick={onShowPendingOrders}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-all duration-200 backdrop-blur-sm"
              >
                <Clock className="h-4 w-4" />
                <span className="font-medium">{pendingCount} {pendingCount !== 1 ? t('notifications.orders') : t('notifications.order')}</span>
              </button>
            )}

            {/* Waiter Requests */}
            {waiterCount > 0 && (
              <button
                onClick={onShowWaiterRequests}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-all duration-200 backdrop-blur-sm"
              >
                <User className="h-4 w-4" />
                <span className="font-medium">{waiterCount} {waiterCount !== 1 ? t('notifications.calls') : t('notifications.call')}</span>
              </button>
            )}

            {/* Bill Requests */}
            {billCount > 0 && (
              <button
                onClick={onShowBillRequests}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-all duration-200 backdrop-blur-sm"
              >
                <Receipt className="h-4 w-4" />
                <span className="font-medium">{billCount} {billCount !== 1 ? t('notifications.bills') : t('notifications.bill')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationBar;
