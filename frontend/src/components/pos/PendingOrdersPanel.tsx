import { useMemo, useState } from 'react';
import { X, Check, Clock, Phone, MapPin, Inbox } from 'lucide-react';
import {
  useOrders,
  useApproveOrder,
  useCancelOrder,
} from '../../features/orders/ordersApi';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { Order, OrderStatus } from '../../types';
import { cn } from '../../lib/utils';
import Spinner from '../ui/Spinner';
import { useTranslation } from 'react-i18next';
import DeliveryOrderBadge from '../delivery-platforms/DeliveryOrderBadge';
import DeliveryOrderModerationPanel from '../delivery-platforms/DeliveryOrderModerationPanel';
import { PLATFORM_DISPLAY } from '../delivery-platforms/platformDisplay';

interface PendingOrdersPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// Delivery orders travel a wider lifecycle (accepted → preparing → ready)
// than the internal QR/in-house approve queue (which only lives in
// PENDING_APPROVAL). Fetch the full active window so the POS panel is the
// single "Paket Siparişleri" inbox — the standalone /admin/delivery-orders
// page was folded in here.
const ACTIVE_STATUSES = [
  OrderStatus.PENDING_APPROVAL,
  OrderStatus.PENDING,
  OrderStatus.PREPARING,
  OrderStatus.READY,
].join(',');

const PLATFORM_FILTERS = ['ALL', ...Object.keys(PLATFORM_DISPLAY)];

const STATUS_PILL: Record<string, string> = {
  [OrderStatus.PENDING_APPROVAL]: 'bg-amber-100 text-amber-700',
  [OrderStatus.PENDING]: 'bg-blue-100 text-blue-700',
  [OrderStatus.PREPARING]: 'bg-indigo-100 text-indigo-700',
  [OrderStatus.READY]: 'bg-emerald-100 text-emerald-700',
};

const isDelivery = (o: Order) => !!o.source && !!o.externalOrderId;

const PendingOrdersPanel = ({ isOpen, onClose }: PendingOrdersPanelProps) => {
  const { t } = useTranslation('pos');
  const { t: td } = useTranslation('deliveryOrders');
  const formatPrice = useFormatCurrency();
  const [platform, setPlatform] = useState<string>('ALL');

  // Single query for both surfaces; refetch keeps the inbox live like the
  // old standalone page did.
  const { data: orders = [], isLoading } = useOrders(
    { status: ACTIVE_STATUSES },
    { refetchInterval: 15_000, keepPreviousData: true, enabled: isOpen },
  );
  const approveOrder = useApproveOrder();
  const cancelOrder = useCancelOrder();

  // Delivery-platform orders across their whole active lifecycle.
  const deliveryOrders = useMemo(
    () =>
      orders
        .filter(isDelivery)
        .filter(
          (o) => platform === 'ALL' || o.source?.toUpperCase() === platform,
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
    [orders, platform],
  );

  // Internal (QR / in-house) orders that still need staff approval — these
  // NEVER appear once approved (the kitchen owns them after that).
  const internalPending = useMemo(
    () =>
      orders.filter(
        (o) => !isDelivery(o) && o.status === OrderStatus.PENDING_APPROVAL,
      ),
    [orders],
  );

  const hasDelivery = orders.some(isDelivery);
  const pendingApprovalCount = useMemo(
    () =>
      orders.filter(
        (o) => isDelivery(o) && o.status === OrderStatus.PENDING_APPROVAL,
      ).length,
    [orders],
  );

  const total = deliveryOrders.length + internalPending.length;

  const handleApprove = async (orderId: string) => {
    try {
      await approveOrder.mutateAsync(orderId);
    } catch {
      /* mutation surfaces the error */
    }
  };
  const handleReject = async (orderId: string) => {
    if (window.confirm(t('pendingOrders.confirmReject'))) {
      try {
        await cancelOrder.mutateAsync(orderId);
      } catch {
        /* mutation surfaces the error */
      }
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 bottom-0 w-full md:w-[600px] bg-white shadow-2xl z-50 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-primary-500 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-heading font-bold">
                {t('pendingOrders.title')}
              </h2>
              <p className="text-sm text-white/80">
                {total} {t('pendingOrders.awaitingApproval')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50 space-y-4">
          {isLoading && orders.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" />
            </div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                <Inbox className="h-8 w-8 text-slate-300" />
              </div>
              <p className="text-lg font-medium text-slate-500">
                {t('pendingOrders.noOrders')}
              </p>
              <p className="text-sm text-slate-400">
                {t('pendingOrders.allApproved')}
              </p>
            </div>
          ) : (
            <>
              {/* ── Delivery / package orders ── */}
              {hasDelivery && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                      {td('title')}
                    </h3>
                  </div>

                  {pendingApprovalCount > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium">
                      <Clock className="h-4 w-4 flex-shrink-0" />
                      <span>
                        {td('awaitingApproval', { count: pendingApprovalCount })}
                      </span>
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
                          'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                          platform === p
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                        )}
                      >
                        {p === 'ALL'
                          ? td('filters.all')
                          : (PLATFORM_DISPLAY[p]?.label ?? p)}
                      </button>
                    ))}
                  </div>

                  {deliveryOrders.length === 0 ? (
                    <p className="text-sm text-slate-400 py-2">
                      {td('empty.title')}
                    </p>
                  ) : (
                    deliveryOrders.map((order) => (
                      <div
                        key={order.id}
                        className="bg-white rounded-xl border border-slate-200/60 shadow-sm overflow-hidden"
                      >
                        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="text-lg font-bold text-slate-900">
                              #{order.orderNumber}
                            </span>
                            <DeliveryOrderBadge
                              source={order.source}
                              externalOrderId={order.externalOrderId}
                              idLabel={td('externalIdLabel')}
                            />
                          </div>
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap',
                              STATUS_PILL[order.status] ??
                                'bg-slate-100 text-slate-600',
                            )}
                          >
                            {td(`status.${order.status}`)}
                          </span>
                        </div>
                        <div className="p-4 space-y-2">
                          {order.customerName && (
                            <p className="text-sm text-slate-600">
                              {order.customerName}
                            </p>
                          )}
                          <div className="space-y-1">
                            {(order.orderItems || order.items || []).map(
                              (item) => (
                                <div
                                  key={item.id}
                                  className="flex items-baseline justify-between text-sm"
                                >
                                  <span className="text-slate-700">
                                    <span className="font-semibold">
                                      {item.quantity}x
                                    </span>{' '}
                                    {item.product?.name}
                                  </span>
                                </div>
                              ),
                            )}
                          </div>
                          {order.notes && (
                            <div className="p-2 bg-amber-50 border border-amber-100 rounded-lg">
                              <p className="text-xs text-amber-800 whitespace-pre-line">
                                {order.notes}
                              </p>
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
                        <div className="px-4 py-3 bg-slate-50/70 border-t border-slate-100">
                          <DeliveryOrderModerationPanel order={order} compact />
                        </div>
                      </div>
                    ))
                  )}
                </section>
              )}

              {/* ── Internal (QR / in-house) approval queue ── */}
              {internalPending.length > 0 && (
                <section className="space-y-3">
                  {hasDelivery && (
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                      {t('pendingOrders.title')}
                    </h3>
                  )}
                  {internalPending.map((order) => (
                    <div
                      key={order.id}
                      className="bg-white rounded-xl border border-amber-200/60 shadow-sm overflow-hidden"
                    >
                      <div className="bg-amber-50/80 px-5 py-4 border-b border-amber-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-lg font-bold text-slate-900">
                            #{order.orderNumber}
                          </span>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Clock className="h-3.5 w-3.5" />
                            {new Date(order.createdAt).toLocaleTimeString()}
                          </div>
                        </div>
                        {order.table && (
                          <div className="flex items-center gap-1 text-sm text-slate-600">
                            <MapPin className="h-3.5 w-3.5" />
                            <span>
                              {t('tableLabel')} {order.table.number}
                            </span>
                          </div>
                        )}
                        {order.customerPhone && (
                          <div className="flex items-center gap-1.5 text-sm text-slate-600">
                            <Phone className="h-3.5 w-3.5" />
                            <span>{order.customerPhone}</span>
                          </div>
                        )}
                      </div>
                      <div className="p-5">
                        <div className="space-y-2.5 mb-4">
                          {order.orderItems?.map((item) => (
                            <div
                              key={item.id}
                              className="flex justify-between items-start"
                            >
                              <div className="flex-1">
                                <div className="font-medium text-slate-900">
                                  {item.quantity}x{' '}
                                  {item.product?.name ||
                                    t('billRequests.unknownProduct')}
                                </div>
                                {item.notes && (
                                  <div className="ml-4 mt-1 text-xs text-slate-500 italic">
                                    {t('notes')}: {item.notes}
                                  </div>
                                )}
                              </div>
                              <span className="text-sm font-semibold text-slate-700 ml-2">
                                {formatPrice(Number(item.subtotal))}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-slate-100 pt-4 flex justify-between items-center">
                          <span className="font-bold text-slate-900">
                            {t('pendingOrders.totalAmount')}
                          </span>
                          <span className="text-xl font-bold text-amber-600">
                            {formatPrice(Number(order.finalAmount))}
                          </span>
                        </div>
                      </div>
                      <div className="bg-slate-50/80 px-5 py-4 border-t border-slate-100 flex gap-3">
                        <button
                          onClick={() => handleReject(order.id)}
                          disabled={cancelOrder.isPending}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white border border-red-200 text-red-600 rounded-xl hover:bg-red-50 font-semibold transition-all disabled:opacity-50"
                        >
                          <X className="h-5 w-5" />
                          {t('pendingOrders.reject')}
                        </button>
                        <button
                          onClick={() => handleApprove(order.id)}
                          disabled={approveOrder.isPending}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-semibold transition-all shadow-sm disabled:opacity-50"
                        >
                          {approveOrder.isPending ? (
                            <Spinner size="sm" color="white" />
                          ) : (
                            <>
                              <Check className="h-5 w-5" />
                              {t('pendingOrders.approve')}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default PendingOrdersPanel;
