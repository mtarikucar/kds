import { Clock, Truck, QrCode, ShoppingBag } from 'lucide-react';
import { Order, OrderStatus, OrderSource } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { formatTimeAgo, formatTime } from '../../lib/utils';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

// Platform colors for source badges
const SourceColors: Record<string, string> = {
  POS: '#6B7280',
  QR_MENU: '#10B981',
  TRENDYOL: '#F27A1A',
  YEMEKSEPETI: '#FA0050',
  GETIR: '#5D3EBC',
  MIGROS: '#F27405',
  FUUDY: '#FF6B35',
};

const SourceLabels: Record<string, string> = {
  POS: 'POS',
  QR_MENU: 'QR',
  TRENDYOL: 'Trendyol',
  YEMEKSEPETI: 'Yemeksepeti',
  GETIR: 'Getir',
  MIGROS: 'Migros',
  FUUDY: 'Fuudy',
};

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

  // Determine if this is a delivery platform order
  const source = order.source || 'POS';
  const isDeliveryPlatform = ['TRENDYOL', 'YEMEKSEPETI', 'GETIR', 'MIGROS', 'FUUDY'].includes(source);
  const sourceColor = SourceColors[source] || SourceColors.POS;
  const sourceLabel = SourceLabels[source] || source;

  const getSourceIcon = () => {
    if (source === 'QR_MENU') return <QrCode className="h-3 w-3" />;
    if (isDeliveryPlatform) return <Truck className="h-3 w-3" />;
    return <ShoppingBag className="h-3 w-3" />;
  };

  return (
    <Card className={`mb-4 ${isDeliveryPlatform ? 'ring-2' : ''}`} style={isDeliveryPlatform ? { '--tw-ring-color': sourceColor } as React.CSSProperties : undefined}>
      {/* Source indicator strip */}
      {source !== 'POS' && (
        <div
          className="h-1 rounded-t-lg"
          style={{ backgroundColor: sourceColor }}
        />
      )}
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">#{order.orderNumber}</CardTitle>
              {/* Source badge */}
              {source !== 'POS' && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white"
                  style={{ backgroundColor: sourceColor }}
                >
                  {getSourceIcon()}
                  {sourceLabel}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600">
              {order.table?.number ? (
                <>{t('kitchen.table')} {order.table.number}</>
              ) : isDeliveryPlatform ? (
                <span className="text-orange-600">{t('kitchen.delivery')}</span>
              ) : order.type === 'TAKEAWAY' ? (
                <span className="text-blue-600">{t('kitchen.takeaway')}</span>
              ) : null}
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
              className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0"
            >
              <div>
                <p className="font-medium">{item.product?.name}</p>
                {item.notes && (
                  <p className="text-sm text-gray-600 italic">
                    {t('kitchen.noteLabel')}: {item.notes}
                  </p>
                )}
              </div>
              <span className="font-bold text-lg">x{item.quantity}</span>
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
