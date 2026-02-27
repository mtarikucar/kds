import { Clock, MoreVertical, X } from 'lucide-react';
import { Order, OrderStatus } from '../../types';
import Button from '../ui/Button';
import { getOrderUrgency, getUrgencyStyles, cn } from '../../lib/utils';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface OrderCardProps {
  order: Order;
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onCancelOrder?: (orderId: string) => void;
  isUpdating?: boolean;
}

const OrderCard = ({ order, onUpdateStatus, onCancelOrder, isUpdating }: OrderCardProps) => {
  const [elapsedTime, setElapsedTime] = useState('');
  const [urgency, setUrgency] = useState(getOrderUrgency(order.createdAt));
  const { t } = useTranslation('kitchen');

  // Update elapsed time and urgency every second
  useEffect(() => {
    const updateTimeAndUrgency = () => {
      const now = Date.now();
      const created = new Date(order.createdAt).getTime();
      const diffMs = now - created;
      const diffMins = Math.floor(diffMs / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);

      if (diffMins > 0) {
        setElapsedTime(`${diffMins}m ${diffSecs}s`);
      } else {
        setElapsedTime(`${diffSecs}s`);
      }

      setUrgency(getOrderUrgency(order.createdAt));
    };

    updateTimeAndUrgency();
    const interval = setInterval(updateTimeAndUrgency, 1000);

    return () => clearInterval(interval);
  }, [order.createdAt]);

  const urgencyStyles = getUrgencyStyles(urgency);

  const getNextStatus = (currentStatus: OrderStatus): OrderStatus | null => {
    switch (currentStatus) {
      case OrderStatus.PENDING:
        return OrderStatus.PREPARING;
      case OrderStatus.PREPARING:
        return OrderStatus.READY;
      case OrderStatus.READY:
        return OrderStatus.SERVED;
      default:
        return null;
    }
  };

  const getActionButtonConfig = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING:
        return {
          label: t('kitchen.actions.startPreparing'),
          variant: 'primary' as const,
          className: 'bg-blue-600 hover:bg-blue-700',
        };
      case OrderStatus.PREPARING:
        return {
          label: t('kitchen.actions.markReady'),
          variant: 'primary' as const,
          className: 'bg-emerald-600 hover:bg-emerald-700',
        };
      case OrderStatus.READY:
        return {
          label: t('kitchen.actions.markServed'),
          variant: 'outline' as const,
          className: '',
        };
      default:
        return null;
    }
  };

  const nextStatus = getNextStatus(order.status);
  const actionConfig = getActionButtonConfig(order.status);
  const isCritical = urgency === 'critical';

  return (
    <div
      className={cn(
        'bg-white rounded-xl shadow-sm border-l-4 transition-all hover:shadow-md',
        urgencyStyles.border,
        isCritical && 'animate-pulse'
      )}
    >
      {/* Header */}
      <div className="p-3 md:p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {/* Order Number */}
            <span className="text-xl md:text-2xl font-bold text-slate-900">
              #{order.orderNumber}
            </span>
            {/* Table Badge */}
            {order.table && (
              <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-full whitespace-nowrap">
                {t('kitchen.table')} {order.table.number}
              </span>
            )}
            {/* Delivery Platform Badge */}
            {order.source && (() => {
              const PLATFORM_DISPLAY: Record<string, { label: string; className: string }> = {
                GETIR: { label: 'Getir', className: 'bg-purple-100 text-purple-700' },
                YEMEKSEPETI: { label: 'Yemeksepeti', className: 'bg-pink-100 text-pink-700' },
                TRENDYOL: { label: 'Trendyol', className: 'bg-orange-100 text-orange-700' },
                MIGROS: { label: 'Migros', className: 'bg-green-100 text-green-700' },
              };
              const display = PLATFORM_DISPLAY[order.source] || { label: order.source, className: 'bg-slate-100 text-slate-700' };
              return (
                <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap', display.className)}>
                  {display.label}
                </span>
              );
            })()}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Time Badge */}
            <div
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold',
                urgencyStyles.badge
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>{elapsedTime}</span>
            </div>

            {/* Dropdown Menu for Cancel */}
            {order.status === OrderStatus.PENDING && onCancelOrder && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                    aria-label={t('kitchen.moreOptions')}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => onCancelOrder(order.id)}
                    className="text-red-600 focus:text-red-600"
                  >
                    <X className="h-4 w-4 mr-2" />
                    {t('kitchen.cancelOrder')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Order Items */}
        <div className="space-y-1.5 mb-3">
          {(order.orderItems || order.items || []).map((item) => (
            <div key={item.id} className="flex items-start justify-between text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-slate-900 truncate">
                    {item.product?.name}
                  </span>
                </div>
                {/* Modifiers */}
                {item.modifiers && item.modifiers.length > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    {item.modifiers.map((mod: any) => (
                      <p key={mod.id} className="text-xs text-blue-600 pl-2">
                        + {mod.modifier?.name || mod.name}
                        {mod.quantity > 1 && ` x${mod.quantity}`}
                      </p>
                    ))}
                  </div>
                )}
                {/* Item Notes */}
                {item.notes && (
                  <p className="text-xs text-slate-500 italic mt-0.5 pl-2">
                    {item.notes}
                  </p>
                )}
              </div>
              <span className="font-bold text-slate-900 ml-2 tabular-nums">
                x{item.quantity}
              </span>
            </div>
          ))}
        </div>

        {/* Order Notes */}
        {order.notes && (
          <div className="mb-3 p-2 bg-amber-50 border border-amber-100 rounded-lg">
            <p className="text-xs text-amber-800">
              <span className="font-semibold">{t('kitchen.orderNoteLabel')}:</span>{' '}
              {order.notes}
            </p>
          </div>
        )}

        {/* Action Button */}
        {nextStatus && actionConfig && (
          <Button
            variant={actionConfig.variant}
            className={cn('w-full', actionConfig.className)}
            onClick={() => onUpdateStatus(order.id, nextStatus)}
            isLoading={isUpdating}
            size="sm"
          >
            {actionConfig.label}
          </Button>
        )}
      </div>
    </div>
  );
};

export default OrderCard;
