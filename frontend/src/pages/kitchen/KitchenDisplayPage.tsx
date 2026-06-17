import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { useOrders, useUpdateOrderStatus, useCancelKdsOrder } from '../../features/orders/ordersApi';
import { useKitchenSocket } from '../../features/kds/useKitchenSocket';
import { useKioskMode } from '../../hooks/useKioskMode';
import OrderQueue from '../../components/kitchen/OrderQueue';
import KitchenStatsHeader from '../../components/kitchen/KitchenStatsHeader';
import { OrderStatus } from '../../types';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { countUrgentOrders, sortOrdersByAge, cn } from '../../lib/utils';
import { kioskPage } from '../../components/kitchen/kioskTheme';

const KitchenDisplayPage = () => {
  const { t } = useTranslation('kitchen');
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(OrderStatus.PENDING);
  const rootRef = useRef<HTMLDivElement>(null);
  const { kiosk, toggle: toggleKiosk } = useKioskMode(rootRef);

  const { isConnected } = useKitchenSocket();

  // Filter to only show active kitchen orders. When the live socket is down
  // we engage a ~10s polling fallback so the board keeps updating; once the
  // socket reconnects we stop polling (socket invalidations take over again).
  // keepPreviousData retains the last-known orders across refetches/errors so
  // the board never blanks out under a transient failure.
  const {
    data: orders,
    refetch,
    isLoading,
    isError,
    dataUpdatedAt,
  } = useOrders(
    {
      status: [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY].join(',') as any,
    },
    {
      refetchInterval: isConnected ? false : 10_000,
      keepPreviousData: true,
    }
  );

  const { mutate: updateOrderStatus } = useUpdateOrderStatus();
  const { mutate: cancelOrder } = useCancelKdsOrder();

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
    // deep-review FM5: the cancel is deferred behind a 5s Undo window in
    // OrderCard, so by the time it commits another station may have already
    // advanced/served/cancelled this order. Re-validate against the latest
    // cache and only proceed if it is STILL PENDING — this closes the window
    // where a stale closure would wrongfully void work-in-progress (CANCELLED
    // is terminal server-side and reverses stock).
    const current = (orders || []).find((o) => o.id === orderId);
    if (!current || current.status !== OrderStatus.PENDING) {
      toast.warning(
        t(
          'kitchen.cancelStale',
          'Sipariş artık beklemede değil; iptal edilmedi.'
        )
      );
      return;
    }
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

  // Surface the moment the board last successfully synced, so a stale/error
  // banner can tell the cook how old the on-screen data is.
  const lastUpdatedLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : '—';

  // First paint with no data yet: show a real skeleton instead of empty
  // columns, so "still loading" is never mistaken for "kitchen is empty".
  const showFirstLoadSkeleton = isLoading && !orders;

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
    <div ref={rootRef} className={cn('h-full flex flex-col', kioskPage(kiosk))}>
      {/* Stats Header */}
      <div data-tour="kitchen-stats">
        <KitchenStatsHeader
          orders={orders || []}
          isConnected={isConnected}
          onRefresh={handleRefresh}
          isLoading={isLoading}
          kiosk={kiosk}
          onToggleKiosk={toggleKiosk}
        />
      </div>

      {/* Persistent error / stale banner — distinct from the empty-kitchen
          state. Shown whenever a fetch failed; the last-known orders stay on
          screen (keepPreviousData) so the cook isn't left blind. */}
      {isError && (
        <div
          role="alert"
          className={cn(
            'flex items-center gap-2 px-4 py-3 mb-3 rounded-lg text-sm font-medium border flex-shrink-0',
            kiosk
              ? 'bg-red-500/20 border-red-500 text-red-200'
              : 'bg-red-50 border-red-300 text-red-800'
          )}
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>
            {t('kitchen.loadError', 'Siparişler yüklenemedi — son güncelleme {{time}}', {
              time: lastUpdatedLabel,
            })}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            className={cn(
              'ml-auto underline underline-offset-2 hover:no-underline',
              kiosk ? 'text-red-100' : 'text-red-700'
            )}
          >
            {t('common:buttons.refresh', 'Yenile')}
          </button>
        </div>
      )}

      {showFirstLoadSkeleton ? (
        <KdsLoadingSkeleton kiosk={kiosk} />
      ) : (
      <>
      {/* Desktop: 3-Column Grid */}
      <div className="hidden lg:grid lg:grid-cols-3 gap-4 md:gap-6 flex-1 min-h-0" data-tour="order-queues">
        <OrderQueue
          title={t('kitchen.pending')}
          status={OrderStatus.PENDING}
          orders={orders || []}
          onUpdateStatus={handleUpdateStatus}
          onCancelOrder={handleCancelOrder}
          updatingOrderId={updatingOrderId || undefined}
          tagFirstActionForTour
          kiosk={kiosk}
        />

        <OrderQueue
          title={t('kitchen.preparing')}
          status={OrderStatus.PREPARING}
          orders={orders || []}
          onUpdateStatus={handleUpdateStatus}
          updatingOrderId={updatingOrderId || undefined}
          kiosk={kiosk}
        />

        <OrderQueue
          title={t('kitchen.ready')}
          status={OrderStatus.READY}
          orders={orders || []}
          onUpdateStatus={handleUpdateStatus}
          updatingOrderId={updatingOrderId || undefined}
          kiosk={kiosk}
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
              kiosk={kiosk}
            />
          </TabsContent>

          <TabsContent value={OrderStatus.PREPARING} className="flex-1 min-h-0 mt-3">
            <MobileOrderList
              orders={(orders || []).filter(o => o.status === OrderStatus.PREPARING)}
              onUpdateStatus={handleUpdateStatus}
              updatingOrderId={updatingOrderId || undefined}
              status={OrderStatus.PREPARING}
              kiosk={kiosk}
            />
          </TabsContent>

          <TabsContent value={OrderStatus.READY} className="flex-1 min-h-0 mt-3">
            <MobileOrderList
              orders={(orders || []).filter(o => o.status === OrderStatus.READY)}
              onUpdateStatus={handleUpdateStatus}
              updatingOrderId={updatingOrderId || undefined}
              status={OrderStatus.READY}
              kiosk={kiosk}
            />
          </TabsContent>
        </Tabs>
      </div>
      </>
      )}
    </div>
  );
};

// First-load skeleton: three placeholder columns so empty columns are never
// confused with "still loading". Respects the kiosk dark theme.
const KdsLoadingSkeleton = ({ kiosk }: { kiosk: boolean }) => (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 flex-1 min-h-0" aria-busy="true">
    {[0, 1, 2].map((col) => (
      <div
        key={col}
        className={cn(
          'rounded-xl border h-full flex flex-col min-h-0 overflow-hidden',
          kiosk ? 'border-neutral-800 bg-neutral-900' : 'border-slate-200/60 bg-slate-50/80'
        )}
      >
        <div className={cn('h-12 animate-pulse', kiosk ? 'bg-neutral-800' : 'bg-slate-200')} />
        <div className="p-3 space-y-3">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className={cn(
                'h-28 rounded-xl animate-pulse',
                kiosk ? 'bg-neutral-800' : 'bg-white'
              )}
            />
          ))}
        </div>
      </div>
    ))}
  </div>
);

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
  kiosk?: boolean;
}

const MobileOrderList = ({
  orders,
  onUpdateStatus,
  onCancelOrder,
  updatingOrderId,
  status,
  kiosk = false,
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
        <div className={cn('p-4 rounded-full mb-3', kiosk ? 'bg-neutral-800' : 'bg-slate-100')}>
          <EmptyIcon className={cn('h-10 w-10', kiosk ? 'text-neutral-500' : 'text-slate-400')} />
        </div>
        <p className={cn('text-base font-medium', kiosk ? 'text-neutral-300' : 'text-slate-600')}>{emptyConfig.title}</p>
        {emptyConfig.description && (
          <p className={cn('text-sm mt-1', kiosk ? 'text-neutral-500' : 'text-slate-400')}>{emptyConfig.description}</p>
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
          kiosk={kiosk}
        />
      ))}
    </div>
  );
};

export default KitchenDisplayPage;
