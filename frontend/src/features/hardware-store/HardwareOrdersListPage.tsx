import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useListHardwareOrders, type HardwareOrderSummary } from './storeApi';

/**
 * v2.8.84 — tenant-facing hardware order history.
 *
 * Pulls GET /v1/hardware-orders (HardwareOrdersService.list, tenant-scoped
 * server-side). Status filter is opt-in: empty filter shows all orders.
 * Each row links to /admin/hardware-orders/:id for the detail view.
 */

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Tüm siparişler' },
  { value: 'pending_payment', label: 'Ödeme bekleniyor' },
  { value: 'paid', label: 'Ödendi' },
  { value: 'fulfillment', label: 'Hazırlanıyor' },
  { value: 'shipped', label: 'Kargoda' },
  { value: 'delivered', label: 'Teslim edildi' },
  { value: 'installed', label: 'Kurulum tamamlandı' },
  { value: 'completed', label: 'Tamamlandı' },
  { value: 'cancelled', label: 'İptal edildi' },
  { value: 'refunded', label: 'İade edildi' },
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
  const [status, setStatus] = useState<string>('');
  const { data: orders = [], isLoading, error } = useListHardwareOrders(status || undefined);

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Donanım Siparişleri</h1>
          <p className="mt-1 text-sm text-gray-500">
            Verdiğiniz tüm donanım siparişlerini buradan takip edebilirsiniz.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">Durum:</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value || 'all'} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <Link
            to="/admin/store"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Yeni sipariş
          </Link>
        </div>
      </header>

      {isLoading ? (
        <div className="text-sm text-gray-500">Yükleniyor…</div>
      ) : error ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Siparişler yüklenemedi. Sayfayı yenileyin veya destek ile iletişime geçin.
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center">
          <p className="text-sm text-gray-600">Henüz sipariş vermediniz.</p>
          <Link
            to="/admin/store"
            className="mt-3 inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Mağazaya git
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Sipariş No</th>
                <th className="px-4 py-2">Tarih</th>
                <th className="px-4 py-2">Ürün adedi</th>
                <th className="px-4 py-2">Tutar</th>
                <th className="px-4 py-2">Durum</th>
                <th className="px-4 py-2">Kurulum</th>
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
          {STATUS_FILTERS.find((s) => s.value === order.status)?.label ?? order.status}
        </span>
      </td>
      <td className="px-4 py-2 text-xs text-gray-600">
        {order.installation === 'requested'
          ? 'Talep edildi'
          : order.installation === 'scheduled'
            ? 'Planlandı'
            : order.installation === 'done'
              ? 'Tamamlandı'
              : '—'}
      </td>
      <td className="px-4 py-2 text-right">
        <Link
          to={`/admin/hardware-orders/${order.id}`}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          Detay →
        </Link>
      </td>
    </tr>
  );
}
