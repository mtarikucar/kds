import { useState } from 'react';
import { useOrders, useUpdateOrderStatus, useCancelKdsOrder } from '../../features/orders/ordersApi';
import { useKitchenSocket } from '../../features/kds/useKitchenSocket';
import OrderQueue from '../../components/kitchen/OrderQueue';
import { OrderStatus } from '../../types';
import { RefreshCw } from 'lucide-react';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';

const KitchenDisplayPage = () => {
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);

  // Filter to only show active kitchen orders
  const { data: orders, refetch, isLoading } = useOrders({
    status: [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY].join(',') as any,
  });

  const { mutate: updateOrderStatus } = useUpdateOrderStatus();
  const { mutate: cancelOrder } = useCancelKdsOrder();
  const { isConnected } = useKitchenSocket();

  const handleUpdateStatus = (orderId: string, status: OrderStatus) => {
    setUpdatingOrderId(orderId);
    updateOrderStatus(
      { id: orderId, data: { status } },
      {
        onSettled: () => {
          setUpdatingOrderId(null);
        },
      }
    );
  };

  const handleCancelOrder = (orderId: string) => {
    setUpdatingOrderId(orderId);
    cancelOrder(orderId, {
      onSettled: () => {
        setUpdatingOrderId(null);
      },
    });
  };

  const handleRefresh = () => {
    refetch();
  };

  return (
    <div className="h-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Kitchen Display</h1>
          <p className="text-gray-600">Real-time order tracking and management</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">WebSocket:</span>
            <Badge variant={isConnected ? 'success' : 'danger'}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            isLoading={isLoading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 h-[calc(100vh-200px)]">
        <OrderQueue
          title="Pending"
          status={OrderStatus.PENDING}
          orders={orders || []}
          onUpdateStatus={handleUpdateStatus}
          onCancelOrder={handleCancelOrder}
          updatingOrderId={updatingOrderId || undefined}
        />

        <OrderQueue
          title="Preparing"
          status={OrderStatus.PREPARING}
          orders={orders || []}
          onUpdateStatus={handleUpdateStatus}
          updatingOrderId={updatingOrderId || undefined}
        />

        <OrderQueue
          title="Ready"
          status={OrderStatus.READY}
          orders={orders || []}
          onUpdateStatus={handleUpdateStatus}
          updatingOrderId={updatingOrderId || undefined}
        />
      </div>
    </div>
  );
};

export default KitchenDisplayPage;
