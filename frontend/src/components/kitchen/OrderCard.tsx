import { Clock } from 'lucide-react';
import { Order, OrderStatus } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { formatTimeAgo, formatTime } from '../../lib/utils';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface OrderCardProps {
  order: Order;
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onCancelOrder?: (orderId: string) => void;
  isUpdating?: boolean;
}

const OrderCard = ({ order, onUpdateStatus, onCancelOrder, isUpdating }: OrderCardProps) => {
  const [elapsedTime, setElapsedTime] = useState('');
  const { t } = useTranslation('kitchen');

  // Update elapsed time every second
  useEffect(() => {
    const updateElapsedTime = () => {
      const now = new Date().getTime();
      const created = new Date(order.createdAt).getTime();
      const diffMs = now - created;
      const diffMins = Math.floor(diffMs / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);

      if (diffMins > 0) {
        setElapsedTime(`${diffMins}m ${diffSecs}s`);
      } else {
        setElapsedTime(`${diffSecs}s`);
      }
    };

    updateElapsedTime();
    const interval = setInterval(updateElapsedTime, 1000);

    return () => clearInterval(interval);
  }, [order.createdAt]);
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

  const getStatusVariant = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING:
        return 'warning';
      case OrderStatus.PREPARING:
        return 'primary';
      case OrderStatus.READY:
        return 'success';
      default:
        return 'default';
    }
  };

  const nextStatus = getNextStatus(order.status);
  const statusKey = order.status.toLowerCase();
  const statusLabel = t(`kitchen.${statusKey}`);

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg">#{order.orderNumber}</CardTitle>
            <p className="text-sm text-gray-600">
              {t('kitchen.table')} {order.table?.number}
            </p>
          </div>
          <Badge variant={getStatusVariant(order.status)}>
            {statusLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-2 mb-4">
          {(order.orderItems || order.items || []).map((item) => (
            <div
              key={item.id}
              className="flex justify-between items-start py-2 border-b border-gray-100 last:border-0"
            >
              <div className="flex-1">
                <p className="font-medium">{item.product?.name}</p>
                {/* Modifier'ları göster */}
                {item.modifiers && item.modifiers.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {item.modifiers.map((mod: any) => (
                      <p key={mod.id} className="text-sm text-blue-600 pl-2">
                        + {mod.modifier?.name || mod.name}
                        {mod.quantity > 1 && ` x${mod.quantity}`}
                      </p>
                    ))}
                  </div>
                )}
                {item.notes && (
                  <p className="text-sm text-gray-600 italic mt-1">
                    {t('kitchen.noteLabel')}: {item.notes}
                  </p>
                )}
              </div>
              <span className="font-bold text-lg ml-2">x{item.quantity}</span>
            </div>
          ))}
        </div>

        {order.notes && (
          <div className="mb-4 p-2 bg-yellow-50 border border-yellow-200 rounded">
            <p className="text-sm text-yellow-800">
              <strong>{t('kitchen.orderNoteLabel')}:</strong> {order.notes}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between text-sm mb-4">
          <div className="flex items-center gap-1 text-blue-600 font-semibold">
            <Clock className="h-4 w-4" />
            <span>{elapsedTime}</span>
          </div>
          <span className="text-gray-600">{formatTime(order.createdAt)}</span>
        </div>

        {nextStatus && (
          <Button
            variant="primary"
            className="w-full"
            onClick={() => onUpdateStatus(order.id, nextStatus)}
            isLoading={isUpdating}
          >
            {t('kitchen.markAs', { status: t(`kitchen.${nextStatus.toLowerCase()}`) })}
          </Button>
        )}

        {order.status === OrderStatus.PENDING && onCancelOrder && (
          <Button
            variant="danger"
            className="w-full mt-2"
            onClick={() => onCancelOrder(order.id)}
            isLoading={isUpdating}
          >
            {t('kitchen.cancelOrder')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default OrderCard;
