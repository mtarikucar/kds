import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, ChefHat, CheckCircle2 } from 'lucide-react';
import { Order, OrderStatus } from '../../types';
import OrderCard from './OrderCard';
import {
  sortOrdersByAge,
  countUrgentOrders,
  calculateAverageWaitTime,
  formatWaitTime,
  cn,
} from '../../lib/utils';
import { kioskColumnShell } from './kioskTheme';

// Live average wait of the column's orders. The 1s ticker is isolated here so
// only this chip re-renders every second, never the order cards below.
const ColumnWaitChip = ({ orders }: { orders: Order[] }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-bold bg-white/20 text-white rounded-full">
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="tabular-nums">{formatWaitTime(calculateAverageWaitTime(orders))}</span>
    </span>
  );
};

interface OrderQueueProps {
  title: string;
  status: OrderStatus;
  orders: Order[];
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onCancelOrder?: (orderId: string) => void;
  updatingOrderId?: string;
  dataTour?: string;
  // Tag the first card's action button with data-tour="order-actions" so the
  // onboarding tour can spotlight a concrete button instead of the column.
  tagFirstActionForTour?: boolean;
  // Dark high-contrast theme for kiosk mode. Default false = today's look.
  kiosk?: boolean;
}

const OrderQueue = ({
  title,
  status,
  orders,
  onUpdateStatus,
  onCancelOrder,
  updatingOrderId,
  dataTour,
  tagFirstActionForTour,
  kiosk = false,
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
    <div className={kioskColumnShell(kiosk, config.bg)} data-tour={dataTour}>
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
          {/* Live Average Wait */}
          {filteredOrders.length > 0 && <ColumnWaitChip orders={filteredOrders} />}
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
            <div className={cn('p-4 rounded-full mb-3', kiosk ? 'bg-neutral-800' : 'bg-white/60')}>
              <EmptyIcon className={cn('h-8 w-8', kiosk ? 'text-neutral-500' : 'text-slate-400')} />
            </div>
            <p className={cn('text-sm font-medium', kiosk ? 'text-neutral-300' : 'text-slate-600')}>{config.emptyTitle}</p>
            {config.emptyDescription && (
              <p className={cn('text-xs mt-1', kiosk ? 'text-neutral-500' : 'text-slate-400')}>{config.emptyDescription}</p>
            )}
          </div>
        ) : (
          filteredOrders.map((order, idx) => (
            <OrderCard
              key={order.id}
              order={order}
              onUpdateStatus={onUpdateStatus}
              onCancelOrder={onCancelOrder}
              isUpdating={updatingOrderId === order.id}
              actionTourTag={tagFirstActionForTour && idx === 0 ? 'order-actions' : undefined}
              kiosk={kiosk}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default OrderQueue;
