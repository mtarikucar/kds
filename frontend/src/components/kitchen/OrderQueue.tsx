import { useTranslation } from 'react-i18next';
import { Order, OrderStatus } from '../../types';
import OrderCard from './OrderCard';

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
  const filteredOrders = orders.filter((order) => order.status === status);

  const getColumnColor = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING:
        return 'bg-yellow-50 border-yellow-200';
      case OrderStatus.PREPARING:
        return 'bg-primary-50 border-primary-200';
      case OrderStatus.READY:
        return 'bg-green-50 border-green-200';
      default:
        return 'bg-neutral-50 border-neutral-200';
    }
  };

  return (
    <div className={`rounded-lg border-2 ${getColumnColor(status)} p-3 md:p-4 h-full flex flex-col min-h-0`}>
      <div className="mb-3 md:mb-4 flex-shrink-0">
        <h2 className="text-lg md:text-xl font-bold font-heading text-foreground">
          {title}
          <span className="ml-2 text-sm font-normal text-gray-600">
            ({filteredOrders.length})
          </span>
        </h2>
      </div>

      <div className="overflow-y-auto flex-1 min-h-0 pr-2 space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400">
            <p>{t('kitchen.noOrders')}</p>
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
