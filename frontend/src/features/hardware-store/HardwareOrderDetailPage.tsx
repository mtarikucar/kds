import { Link, useParams } from 'react-router-dom';
import { useGetHardwareOrder, type ShippingAddress } from './storeApi';

/**
 * v2.8.84 — single hardware order view.
 *
 * Pulls GET /v1/hardware-orders/:id (HardwareOrdersService.findOne,
 * compound (id, tenantId) WHERE — IDOR-safe). Renders items, totals,
 * shipping address, installation status, and shipment tracking when
 * available.
 */

const STATUS_LABEL: Record<string, string> = {
  draft: 'Taslak',
  pending_payment: 'Ödeme bekleniyor',
  paid: 'Ödendi',
  fulfillment: 'Hazırlanıyor',
  shipped: 'Kargoda',
  delivered: 'Teslim edildi',
  installed: 'Kurulum tamamlandı',
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
  refunded: 'İade edildi',
};

export default function HardwareOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useGetHardwareOrder(id);

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">Yükleniyor…</div>;
  }

  if (error || !order) {
    return (
      <div className="p-6">
        <div className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Sipariş bulunamadı veya erişim yetkiniz yok.
        </div>
        <Link
          to="/admin/hardware-orders"
          className="mt-4 inline-block text-sm text-blue-600 hover:underline"
        >
          ← Sipariş listesine dön
        </Link>
      </div>
    );
  }

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString('tr-TR', { style: 'currency', currency: order.currency });
  const date = new Date(order.createdAt).toLocaleString('tr-TR');

  return (
    <div className="space-y-4 p-6">
      <Link
        to="/admin/hardware-orders"
        className="inline-block text-sm text-blue-600 hover:underline"
      >
        ← Sipariş listesine dön
      </Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Sipariş #{order.id.slice(0, 8)}</h1>
          <p className="mt-1 text-sm text-gray-500">{date}</p>
          {order.paymentRef && (
            <p className="mt-1 text-xs text-gray-500">
              Ödeme referansı: <code className="rounded bg-gray-100 px-1">{order.paymentRef}</code>
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold">{fmt(order.totalCents)}</div>
          <div className="mt-1 text-sm">
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
              {STATUS_LABEL[order.status] ?? order.status}
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="space-y-2 rounded border bg-white p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold">Ürünler</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="py-1">Ürün</th>
                <th className="py-1">Tür</th>
                <th className="py-1 text-right">Adet</th>
                <th className="py-1 text-right">Birim</th>
                <th className="py-1 text-right">Toplam</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td className="py-2">
                    <div className="font-medium">{it.name}</div>
                    <div className="text-xs text-gray-500">SKU: {it.sku}</div>
                    {it.serials.length > 0 && (
                      <div className="mt-1 text-xs text-gray-500">
                        Seri: {it.serials.join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-xs">
                    {it.acquisition === 'rent' ? 'Kira' : 'Satın alma'}
                  </td>
                  <td className="py-2 text-right">{it.qty}</td>
                  <td className="py-2 text-right">{fmt(it.unitCents)}</td>
                  <td className="py-2 text-right font-medium">
                    {fmt(it.unitCents * it.qty)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 space-y-1 border-t pt-3 text-sm">
            <Row label="Ara toplam" value={fmt(order.subtotalCents)} />
            {order.taxCents > 0 && <Row label="KDV" value={fmt(order.taxCents)} />}
            {order.shippingCents > 0 && <Row label="Kargo" value={fmt(order.shippingCents)} />}
            <Row label="Genel toplam" value={fmt(order.totalCents)} bold />
          </div>
        </section>

        <aside className="space-y-4">
          <AddressBox title="Teslimat adresi" address={order.shippingAddress} />

          {order.installation && (
            <div className="rounded border bg-white p-4">
              <h3 className="text-sm font-semibold">Kurulum</h3>
              <p className="mt-1 text-xs text-gray-600">
                {order.installation === 'requested'
                  ? 'Kurulum talebi alındı. Ekibimiz randevu için sizinle iletişime geçecektir.'
                  : order.installation === 'scheduled'
                    ? 'Kurulum planlandı.'
                    : order.installation === 'done'
                      ? 'Kurulum tamamlandı.'
                      : order.installation}
              </p>
            </div>
          )}

          {order.shipments.length > 0 && (
            <div className="rounded border bg-white p-4">
              <h3 className="text-sm font-semibold">Kargo</h3>
              <ul className="mt-2 space-y-2 text-xs">
                {order.shipments.map((s) => (
                  <li key={s.id} className="rounded border p-2">
                    <div className="font-medium uppercase">{s.carrier}</div>
                    {s.trackingNo && <div className="text-gray-600">Takip: {s.trackingNo}</div>}
                    <div className="text-gray-500">Durum: {s.status}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'border-t pt-2 font-semibold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AddressBox({
  title,
  address,
}: {
  title: string;
  address: ShippingAddress | string | null;
}) {
  if (!address) return null;
  const lines = formatAddress(address);
  if (lines.length === 0) return null;
  return (
    <div className="rounded border bg-white p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 space-y-0.5 text-xs text-gray-700">
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

function formatAddress(raw: ShippingAddress | string): string[] {
  if (typeof raw === 'string') {
    return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const lines: string[] = [];
  const push = (v: string | undefined) => {
    if (v && v.trim()) lines.push(v.trim());
  };
  push(raw.recipientName);
  push(raw.line1);
  push(raw.line2);
  const district = [raw.district, raw.city].filter(Boolean).join(', ');
  if (district) lines.push(district);
  push(raw.postalCode);
  push(raw.country);
  push(raw.phone);
  return lines;
}
