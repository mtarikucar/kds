import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrders, useUpdateOrderStatus, useCancelKdsOrder } from '../../features/orders/ordersApi';
import { useKitchenSocket } from '../../features/kds/useKitchenSocket';
import OrderQueue from '../../components/kitchen/OrderQueue';
import KitchenStatsHeader from '../../components/kitchen/KitchenStatsHeader';
import { OrderStatus } from '../../types';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { countUrgentOrders, sortOrdersByAge } from '../../lib/utils';

const KitchenDisplayPage = () => {
  const { t } = useTranslation('kitchen');
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(OrderStatus.PENDING);

  // Filter to only show active kitchen orders
  const { data: orders, refetch, isLoading } = useOrders({
    status: [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY].join(',') as any,
  });

  const { mutate: updateOrderStatus } = useUpdateOrderStatus();
  const { mutate: cancelOrder } = useCancelKdsOrder();
  const { isConnected } = useKitchenSocket();

  // Calculate counts for each status
  const orderCounts = useMemo(() => {
    const allOrders = orders || [];
    return {
      [OrderStatus.PENDING]: allOrders.filter(o => o.status === OrderStatus.PENDING).length,
      [OrderStatus.PREPARING]: allOrders.filter(o => o.status === OrderStatus.PREPARING).length,
      [OrderStatus.READY]: allOrders.filter(o => o.status === OrderStatus.READY).length,
    };
  }, [orders]);

  // Count urgent orders for tab badge
  const urgentPendingCount = useMemo(() => {
    const pendingOrders = (orders || []).filter(o => o.status === OrderStatus.PENDING);
    return countUrgentOrders(pendingOrders);
  }, [orders]);

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

  const tabConfig = [
    {
      value: OrderStatus.PENDING,
      label: t('kitchen.pending'),
      count: orderCounts[OrderStatus.PENDING],
      urgentCount: urgentPendingCount,
      className: 'data-[state=active]:bg-amber-100 data-[state=active]:text-amber-900',
    },
    {
      value: OrderStatus.PREPARING,
      label: t('kitchen.preparing'),
      count: orderCounts[OrderStatus.PREPARING],
      urgentCount: 0,
      className: 'data-[state=active]:bg-blue-100 data-[state=active]:text-blue-900',
    },
    {
      value: OrderStatus.READY,
      label: t('kitchen.ready'),
      count: orderCounts[OrderStatus.READY],
      urgentCount: 0,
      className: 'data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-900',
    },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Stats Header */}
      <div data-tour="kitchen-stats">
        <KitchenStatsHeader
          orders={orders || []}
          isConnected={isConnected}
          onRefresh={handleRefresh}
          isLoading={isLoading}
        />
      </div>

      {/* Desktop: 3-Column Grid */}
      <div className="hidden lg:grid lg:grid-cols-3 gap-4 md:gap-6 flex-1 min-h-0" data-tour="order-queues">
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

      {/* Mobile/Tablet: Tab Navigation */}
      <div className="lg:hidden flex-1 min-h-0 flex flex-col">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="w-full grid grid-cols-3 p-1 bg-slate-100 rounded-xl">
            {tabConfig.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={`relative flex items-center justify-center gap-1.5 py-2 ${tab.className}`}
              >
                <span className="font-medium text-sm">{tab.label}</span>
                <span className="min-w-[1.25rem] px-1.5 py-0.5 text-xs font-bold bg-black/10 rounded-full">
                  {tab.count}
                </span>
                {tab.urgentCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={OrderStatus.PENDING} className="flex-1 min-h-0 mt-3">
            <MobileOrderList
              orders={(orders || []).filter(o => o.status === OrderStatus.PENDING)}
              onUpdateStatus={handleUpdateStatus}
              onCancelOrder={handleCancelOrder}
              updatingOrderId={updatingOrderId || undefined}
              status={OrderStatus.PENDING}
            />
          </TabsContent>

          <TabsContent value={OrderStatus.PREPARING} className="flex-1 min-h-0 mt-3">
            <MobileOrderList
              orders={(orders || []).filter(o => o.status === OrderStatus.PREPARING)}
              onUpdateStatus={handleUpdateStatus}
              updatingOrderId={updatingOrderId || undefined}
              status={OrderStatus.PREPARING}
            />
          </TabsContent>

          <TabsContent value={OrderStatus.READY} className="flex-1 min-h-0 mt-3">
            <MobileOrderList
              orders={(orders || []).filter(o => o.status === OrderStatus.READY)}
              onUpdateStatus={handleUpdateStatus}
              updatingOrderId={updatingOrderId || undefined}
              status={OrderStatus.READY}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

// Mobile Order List Component
import OrderCard from '../../components/kitchen/OrderCard';
import { Clock, ChefHat, CheckCircle2 } from 'lucide-react';
import { Order } from '../../types';

interface MobileOrderListProps {
  orders: Order[];
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onCancelOrder?: (orderId: string) => void;
  updatingOrderId?: string;
  status: OrderStatus;
}

const MobileOrderList = ({
  orders,
  onUpdateStatus,
  onCancelOrder,
  updatingOrderId,
  status,
}: MobileOrderListProps) => {
  const { t } = useTranslation('kitchen');
  const sortedOrders = sortOrdersByAge(orders);

  const getEmptyConfig = () => {
    switch (status) {
      case OrderStatus.PENDING:
        return {
          icon: Clock,
          title: t('kitchen.empty.pendingTitle'),
          description: t('kitchen.empty.pendingDescription'),
        };
      case OrderStatus.PREPARING:
        return {
          icon: ChefHat,
          title: t('kitchen.empty.preparingTitle'),
          description: t('kitchen.empty.preparingDescription'),
        };
      case OrderStatus.READY:
        return {
          icon: CheckCircle2,
          title: t('kitchen.empty.readyTitle'),
          description: t('kitchen.empty.readyDescription'),
        };
      default:
        return {
          icon: Clock,
          title: t('kitchen.noOrders'),
          description: '',
        };
    }
  };

  const emptyConfig = getEmptyConfig();
  const EmptyIcon = emptyConfig.icon;

  if (sortedOrders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-4">
        <div className="p-4 rounded-full bg-slate-100 mb-3">
          <EmptyIcon className="h-10 w-10 text-slate-400" />
        </div>
        <p className="text-base font-medium text-slate-600">{emptyConfig.title}</p>
        {emptyConfig.description && (
          <p className="text-sm text-slate-400 mt-1">{emptyConfig.description}</p>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full space-y-3 pb-4">
      {sortedOrders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          onUpdateStatus={onUpdateStatus}
          onCancelOrder={onCancelOrder}
          isUpdating={updatingOrderId === order.id}
        />
      ))}
    </div>
  );
};

export default KitchenDisplayPage;
