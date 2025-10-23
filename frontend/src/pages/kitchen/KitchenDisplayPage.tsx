import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrders, useUpdateOrderStatus, useCancelKdsOrder } from '../../features/orders/ordersApi';
import { useKitchenSocket } from '../../features/kds/useKitchenSocket';
import OrderQueue from '../../components/kitchen/OrderQueue';
import { OrderStatus } from '../../types';
import { RefreshCw } from 'lucide-react';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';

const KitchenDisplayPage = () => {
  const { t } = useTranslation('kitchen');
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
      <div className="mb-4 md:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('kitchen.title')}</h1>
          <p className="text-sm md:text-base text-gray-600">{t('kitchen.realtimeTracking')}</p>
        </div>

        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs md:text-sm text-gray-600">WebSocket:</span>
            <Badge variant={isConnected ? 'success' : 'danger'}>
              {isConnected ? t('kitchen.connected') : t('kitchen.disconnected')}
            </Badge>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            isLoading={isLoading}
          >
            <RefreshCw className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">{t('common:buttons.refresh')}</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6 h-[calc(100vh-250px)] md:h-[calc(100vh-200px)]">
        <OrderQueue
          title={t('kitchen.pending')}
          status={OrderStatus.PENDING}
          orders={orders || []}
          onUpdateStatus={handleUpdateStatus}
          onCancelOrder={handleCancelOrder}
          updatingOrderId={updatingOrderId || undefined}
        />

        <OrderQueue
          title={t('kitchen.preparing')}
          status={OrderStatus.PREPARING}
          orders={orders || []}
          onUpdateStatus={handleUpdateStatus}
          updatingOrderId={updatingOrderId || undefined}
        />

        <OrderQueue
          title={t('kitchen.ready')}
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
