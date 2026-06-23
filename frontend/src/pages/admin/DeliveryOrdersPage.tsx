import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bike, AlertTriangle, Clock, RefreshCw, Inbox } from 'lucide-react';
import { useOrders } from '../../features/orders/ordersApi';
import { Order, OrderStatus } from '../../types';
import FeatureGate from '../../components/subscriptions/FeatureGate';
import UpsellCard from '../../components/subscriptions/UpsellCard';
import DeliveryOrderBadge from '../../components/delivery-platforms/DeliveryOrderBadge';
import { PLATFORM_DISPLAY } from '../../components/delivery-platforms/platformDisplay';
import DeliveryOrderModerationPanel from '../../components/delivery-platforms/DeliveryOrderModerationPanel';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import Spinner from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';

/**
 * Operator-facing delivery-orders queue. Surfaces every incoming order that
 * came from an external delivery platform (source set) so staff can ACCEPT /
 * REJECT(reason) / set PREP-TIME from one place — the moderation actions live
 * in DeliveryOrderModerationPanel (wired to deliveryOrderActionsApi.ts).
 *
 * Pulls from the existing /orders list (the same source the KDS board uses) and
 * filters client-side to delivery orders, so it stays in sync with realtime
 * order invalidations. Gated behind the deliveryIntegration plan feature.
 */

const ACTIVE_STATUSES = [
  OrderStatus.PENDING_APPROVAL,
  OrderStatus.PENDING,
  OrderStatus.PREPARING,
  OrderStatus.READY,
].join(',');

const PLATFORM_FILTERS = ['ALL', ...Object.keys(PLATFORM_DISPLAY)];

const DeliveryOrdersPage = () => {
  const { t } = useTranslation(['deliveryOrders', 'common']);
  const formatPrice = useFormatCurrency();
  const [platform, setPlatform] = useState<string>('ALL');

  const {
    data: orders,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useOrders(
    { status: ACTIVE_STATUSES },
    { refetchInterval: 15_000, keepPreviousData: true },
  );

  // Only orders that came from a delivery platform (source + externalOrderId).
  const deliveryOrders = useMemo(
    () =>
      (orders || [])
        .filter((o) => !!o.source && !!o.externalOrderId)
        .filter((o) => platform === 'ALL' || o.source?.toUpperCase() === platform)
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
    [orders, platform],
  );

  const pendingApprovalCount = useMemo(
    () =>
      (orders || []).filter(
        (o) => !!o.source && o.status === OrderStatus.PENDING_APPROVAL,
      ).length,
    [orders],
  );

  return (
    <FeatureGate
      feature="deliveryIntegration"
      fallback={<UpsellCard addOnCode="delivery_yemeksepeti" planName="PRO" />}
    >
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
              <Bike className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-slate-900 text-2xl">
                {t('title')}
              </h1>
              <p className="text-slate-500 mt-0.5">{t('description')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            {t('common:buttons.refresh', 'Yenile')}
          </button>
        </div>

        {/* Awaiting-approval banner */}
        {pendingApprovalCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium">
            <Clock className="h-4 w-4 flex-shrink-0" />
            <span>{t('awaitingApproval', { count: pendingApprovalCount })}</span>
          </div>
        )}

        {/* Platform filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          {PLATFORM_FILTERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                platform === p
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
              )}
            >
              {p === 'ALL'
                ? t('filters.all')
                : PLATFORM_DISPLAY[p]?.label ?? p}
            </button>
          ))}
        </div>

        {/* Error banner — keep last-known orders on screen */}
        {isError && (
          <div
            role="alert"
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-300 text-red-800 text-sm font-medium"
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{t('loadError')}</span>
            <button
              type="button"
              onClick={() => refetch()}
              className="ml-auto underline underline-offset-2 hover:no-underline"
            >
              {t('common:buttons.refresh', 'Yenile')}
            </button>
          </div>
        )}

        {/* List */}
        {isLoading && !orders ? (
          <div className="flex items-center justify-center py-24">
            <Spinner size="lg" />
          </div>
        ) : deliveryOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <Inbox className="h-8 w-8 text-slate-300" />
            </div>
            <p className="text-lg font-medium text-slate-500">{t('empty.title')}</p>
            <p className="text-sm text-slate-400 mt-1">{t('empty.description')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {deliveryOrders.map((order) => (
              <DeliveryOrderRow
                key={order.id}
                order={order}
                idLabel={t('externalIdLabel')}
                formatPrice={formatPrice}
              />
            ))}
          </div>
        )}
      </div>
    </FeatureGate>
  );
};

interface DeliveryOrderRowProps {
  order: Order;
  idLabel: string;
  formatPrice: (amount: number) => string;
}

const STATUS_PILL: Record<string, string> = {
  [OrderStatus.PENDING_APPROVAL]: 'bg-amber-100 text-amber-700',
  [OrderStatus.PENDING]: 'bg-blue-100 text-blue-700',
  [OrderStatus.PREPARING]: 'bg-indigo-100 text-indigo-700',
  [OrderStatus.READY]: 'bg-emerald-100 text-emerald-700',
};

const DeliveryOrderRow = ({ order, idLabel, formatPrice }: DeliveryOrderRowProps) => {
  const { t } = useTranslation('deliveryOrders');
  const items = order.orderItems || order.items || [];

  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-lg font-bold text-slate-900">#{order.orderNumber}</span>
          <DeliveryOrderBadge
            source={order.source}
            externalOrderId={order.externalOrderId}
            idLabel={idLabel}
          />
        </div>
        <span
          className={cn(
            'px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap',
            STATUS_PILL[order.status] ?? 'bg-slate-100 text-slate-600',
          )}
        >
          {t(`status.${order.status}`)}
        </span>
      </div>

      {/* Body */}
      <div className="p-4 flex-1 space-y-2">
        {order.customerName && (
          <p className="text-sm text-slate-600">{order.customerName}</p>
        )}
        <div className="space-y-1">
          {items.map((item) => (
            <div key={item.id} className="flex items-baseline justify-between text-sm">
              <span className="text-slate-700">
                <span className="font-semibold">{item.quantity}x</span>{' '}
                {item.product?.name}
              </span>
            </div>
          ))}
        </div>
        {order.notes && (
          <div className="p-2 bg-amber-50 border border-amber-100 rounded-lg">
            <p className="text-xs text-amber-800 whitespace-pre-line">{order.notes}</p>
          </div>
        )}
        <div className="flex justify-between items-center pt-1">
          <span className="text-xs text-slate-400">
            {new Date(order.createdAt).toLocaleTimeString()}
          </span>
          <span className="font-bold text-slate-900">
            {formatPrice(Number(order.finalAmount))}
          </span>
        </div>
      </div>

      {/* Moderation controls */}
      <div className="px-4 py-3 bg-slate-50/70 border-t border-slate-100">
        <DeliveryOrderModerationPanel order={order} compact />
      </div>
    </div>
  );
};

export default DeliveryOrdersPage;
