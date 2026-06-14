import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useListHardwareOrders, type HardwareOrderSummary } from './storeApi';

/**
 * v2.8.84 — tenant-facing hardware order history.
 *
 * Pulls GET /v1/hardware-orders (HardwareOrdersService.list, tenant-scoped
 * server-side). Status filter is opt-in: empty filter shows all orders.
 * Each row links to /admin/hardware-orders/:id for the detail view.
 */

const STATUS_FILTER_VALUES: string[] = [
  '',
  'pending_payment',
  'paid',
  'fulfillment',
  'shipped',
  'delivered',
  'installed',
  'completed',
  'cancelled',
  'refunded',
];

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_payment: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  fulfillment: 'bg-blue-100 text-blue-700',
  shipped: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  installed: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
  refunded: 'bg-rose-100 text-rose-700',
};

export default function HardwareOrdersListPage() {
  const { t } = useTranslation('hardware');
  const [status, setStatus] = useState<string>('');
  const { data: orders = [], isLoading, error } = useListHardwareOrders(status || undefined);

  const statusFilterLabel = (value: string) =>
    value === '' ? t('ordersList.allOrders') : t(`orderStatus.${value}`, value);

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{t('ordersList.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('ordersList.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">{t('ordersList.statusLabel')}</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          >
            {STATUS_FILTER_VALUES.map((value) => (
              <option key={value || 'all'} value={value}>
                {statusFilterLabel(value)}
              </option>
            ))}
          </select>
          <Link
            to="/admin/store"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t('ordersList.newOrder')}
          </Link>
        </div>
      </header>

      {isLoading ? (
        <div className="text-sm text-gray-500">{t('ordersList.loading')}</div>
      ) : error ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {t('ordersList.loadError')}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center">
          <p className="text-sm text-gray-600">{t('ordersList.empty')}</p>
          <Link
            to="/admin/store"
            className="mt-3 inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t('ordersList.goToStore')}
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('ordersList.col.orderNo')}</th>
                <th className="px-4 py-2">{t('ordersList.col.date')}</th>
                <th className="px-4 py-2">{t('ordersList.col.itemCount')}</th>
                <th className="px-4 py-2">{t('ordersList.col.amount')}</th>
                <th className="px-4 py-2">{t('ordersList.col.status')}</th>
                <th className="px-4 py-2">{t('ordersList.col.installation')}</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((o) => (
                <OrderRow key={o.id} order={o} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrderRow({ order }: { order: HardwareOrderSummary }) {
  const { t } = useTranslation('hardware');
  const date = new Date(order.createdAt).toLocaleDateString('tr-TR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 font-mono text-xs">#{order.id.slice(0, 8)}</td>
      <td className="px-4 py-2 text-gray-700">{date}</td>
      <td className="px-4 py-2 text-gray-700">{order.itemCount}</td>
      <td className="px-4 py-2 font-medium">
        {(order.totalCents / 100).toLocaleString('tr-TR', {
          style: 'currency',
          currency: order.currency,
        })}
      </td>
      <td className="px-4 py-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            STATUS_BADGE[order.status] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {t(`orderStatus.${order.status}`, order.status)}
        </span>
      </td>
      <td className="px-4 py-2 text-xs text-gray-600">
        {order.installation === 'requested'
          ? t('installation.requested')
          : order.installation === 'scheduled'
            ? t('installation.scheduled')
            : order.installation === 'done'
              ? t('installation.done')
              : '—'}
      </td>
      <td className="px-4 py-2 text-right">
        <Link
          to={`/admin/hardware-orders/${order.id}`}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          {t('ordersList.detail')}
        </Link>
      </td>
    </tr>
  );
}
