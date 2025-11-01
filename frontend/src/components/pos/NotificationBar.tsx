import { Bell, Clock, Receipt, User } from 'lucide-react';
import { usePendingOrders, useWaiterRequests, useBillRequests } from '../../features/orders/ordersApi';

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
    <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 animate-pulse" />
            <span className="font-semibold">
              {totalCount} Pending {totalCount === 1 ? 'Notification' : 'Notifications'}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Pending Orders */}
            {pendingCount > 0 && (
              <button
                onClick={onShowPendingOrders}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-colors"
              >
                <Clock className="h-4 w-4" />
                <span className="font-medium">{pendingCount} Order{pendingCount !== 1 ? 's' : ''}</span>
              </button>
            )}

            {/* Waiter Requests */}
            {waiterCount > 0 && (
              <button
                onClick={onShowWaiterRequests}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-colors"
              >
                <User className="h-4 w-4" />
                <span className="font-medium">{waiterCount} Call{waiterCount !== 1 ? 's' : ''}</span>
              </button>
            )}

            {/* Bill Requests */}
            {billCount > 0 && (
              <button
                onClick={onShowBillRequests}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-colors"
              >
                <Receipt className="h-4 w-4" />
                <span className="font-medium">{billCount} Bill{billCount !== 1 ? 's' : ''}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationBar;
