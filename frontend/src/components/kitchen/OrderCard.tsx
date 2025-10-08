import { Clock } from 'lucide-react';
import { Order, OrderStatus } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { formatTimeAgo, formatTime } from '../../lib/utils';

interface OrderCardProps {
  order: Order;
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  isUpdating?: boolean;
}

const OrderCard = ({ order, onUpdateStatus, isUpdating }: OrderCardProps) => {
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

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg">#{order.orderNumber}</CardTitle>
            <p className="text-sm text-gray-600">
              Table {order.table?.number}
            </p>
          </div>
          <Badge variant={getStatusVariant(order.status)}>
            {order.status}
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
                    Note: {item.notes}
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
              <strong>Order Note:</strong> {order.notes}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            <span>{formatTimeAgo(order.createdAt)}</span>
          </div>
          <span>{formatTime(order.createdAt)}</span>
        </div>

        {nextStatus && (
          <Button
            variant="primary"
            className="w-full"
            onClick={() => onUpdateStatus(order.id, nextStatus)}
            isLoading={isUpdating}
          >
            Mark as {nextStatus}
          </Button>
        )}

        {order.status === OrderStatus.PENDING && (
          <Button
            variant="danger"
            className="w-full mt-2"
            onClick={() => onUpdateStatus(order.id, OrderStatus.CANCELLED)}
            isLoading={isUpdating}
          >
            Cancel Order
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default OrderCard;
