import { Order, OrderStatus } from '../../types';
import OrderCard from './OrderCard';

interface OrderQueueProps {
  title: string;
  status: OrderStatus;
  orders: Order[];
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  updatingOrderId?: string;
}

const OrderQueue = ({
  title,
  status,
  orders,
  onUpdateStatus,
  updatingOrderId,
}: OrderQueueProps) => {
  const filteredOrders = orders.filter((order) => order.status === status);

  const getColumnColor = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING:
        return 'bg-yellow-50 border-yellow-200';
      case OrderStatus.PREPARING:
        return 'bg-blue-50 border-blue-200';
      case OrderStatus.READY:
        return 'bg-green-50 border-green-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className={`rounded-lg border-2 ${getColumnColor(status)} p-4 h-full`}>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">
          {title}
          <span className="ml-2 text-sm font-normal text-gray-600">
            ({filteredOrders.length})
          </span>
        </h2>
      </div>

      <div className="overflow-y-auto h-[calc(100vh-250px)] pr-2">
        {filteredOrders.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400">
            <p>No orders</p>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onUpdateStatus={onUpdateStatus}
              isUpdating={updatingOrderId === order.id}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default OrderQueue;
