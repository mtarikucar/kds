import { useTranslation } from 'react-i18next';
import { Clock, ChefHat, CheckCircle2 } from 'lucide-react';
import { Order, OrderStatus } from '../../types';
import OrderCard from './OrderCard';
import { sortOrdersByAge, countUrgentOrders, cn } from '../../lib/utils';

interface OrderQueueProps {
  title: string;
  status: OrderStatus;
  orders: Order[];
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onCancelOrder?: (orderId: string) => void;
  updatingOrderId?: string;
}

const OrderQueue = ({
  title,
  status,
  orders,
  onUpdateStatus,
  onCancelOrder,
  updatingOrderId,
}: OrderQueueProps) => {
  const { t } = useTranslation('kitchen');

  // Filter orders by status and sort by age (oldest first)
  const filteredOrders = sortOrdersByAge(orders.filter((order) => order.status === status));
  const urgentCount = countUrgentOrders(filteredOrders);

  const getColumnConfig = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING:
        return {
          bg: 'bg-amber-50/80',
          headerBg: 'bg-amber-500',
          headerIcon: Clock,
          emptyIcon: Clock,
          emptyTitle: t('kitchen.empty.pendingTitle'),
          emptyDescription: t('kitchen.empty.pendingDescription'),
        };
      case OrderStatus.PREPARING:
        return {
          bg: 'bg-blue-50/80',
          headerBg: 'bg-blue-500',
          headerIcon: ChefHat,
          emptyIcon: ChefHat,
          emptyTitle: t('kitchen.empty.preparingTitle'),
          emptyDescription: t('kitchen.empty.preparingDescription'),
        };
      case OrderStatus.READY:
        return {
          bg: 'bg-emerald-50/80',
          headerBg: 'bg-emerald-500',
          headerIcon: CheckCircle2,
          emptyIcon: CheckCircle2,
          emptyTitle: t('kitchen.empty.readyTitle'),
          emptyDescription: t('kitchen.empty.readyDescription'),
        };
      default:
        return {
          bg: 'bg-slate-50/80',
          headerBg: 'bg-slate-500',
          headerIcon: Clock,
          emptyIcon: Clock,
          emptyTitle: t('kitchen.noOrders'),
          emptyDescription: '',
        };
    }
  };

  const config = getColumnConfig(status);
  const HeaderIcon = config.headerIcon;
  const EmptyIcon = config.emptyIcon;

  return (
    <div className={cn('rounded-xl border border-slate-200/60 h-full flex flex-col min-h-0', config.bg)}>
      {/* Column Header */}
      <div className={cn('flex items-center justify-between px-4 py-3 rounded-t-xl', config.headerBg)}>
        <div className="flex items-center gap-2">
          <HeaderIcon className="h-5 w-5 text-white" />
          <h2 className="text-base md:text-lg font-heading font-bold text-white">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Urgent Badge */}
          {urgentCount > 0 && status === OrderStatus.PENDING && (
            <span className="px-2 py-0.5 text-xs font-bold bg-red-100 text-red-700 rounded-full animate-pulse">
              {urgentCount} {t('kitchen.stats.urgent')}
            </span>
          )}
          {/* Count Badge */}
          <span className="px-2.5 py-0.5 text-sm font-bold bg-white/20 text-white rounded-full">
            {filteredOrders.length}
          </span>
        </div>
      </div>

      {/* Order Cards */}
      <div className="overflow-y-auto flex-1 min-h-0 p-3 space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center px-4">
            <div className="p-4 rounded-full bg-white/60 mb-3">
              <EmptyIcon className="h-8 w-8 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-600">{config.emptyTitle}</p>
            {config.emptyDescription && (
              <p className="text-xs text-slate-400 mt-1">{config.emptyDescription}</p>
            )}
          </div>
        ) : (
          filteredOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onUpdateStatus={onUpdateStatus}
              onCancelOrder={onCancelOrder}
              isUpdating={updatingOrderId === order.id}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default OrderQueue;
