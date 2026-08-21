import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatCurrencyExtended } from '../../hooks/useFormatCurrency';
import { useFormatDate } from '../../hooks/useFormatDate';
import {
  useSaCreateShipment,
  useSaGetPrint3dJob,
  useSaListPrint3dJobs,
  useSaMarkShipmentDelivered,
  useSaUpdatePrint3dJobItem,
  useSaUpdatePrint3dJobStatus,
  type SaPrint3dJob,
} from '../../features/superadmin/api/superadminPrint3dApi';
import { print3dManifestCsv } from './print3dManifestCsv';

const TABS = ['queued', 'in_production', 'produced', 'cancelled'] as const;

/**
 * Mirrors backend/src/modules/print3d/print3d.service.ts
 * `Print3dService.TRANSITIONS` EXACTLY — this is the single reason the
 * panel is allowed to render an "Advance" / "Cancel" control at all. If the
 * two ever drift, the panel starts offering a button the server answers
 * with PRINT3D_INVALID_TRANSITION: that is a UI bug, not something a
 * try/catch on the mutation papers over. `produced` and `cancelled` are
 * TERMINAL — no outgoing edge, ever.
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  queued: ['in_production', 'cancelled'],
  in_production: ['produced', 'cancelled'],
  produced: [],
  cancelled: [],
};

/**
 * /superadmin/print3d — Figurunica production queue.
 *
 * No new backend endpoint for shipping: calls the existing
 * POST /v1/superadmin/shipments/:orderId. Manifest export is client-side CSV.
 */
export default function Print3dProductionPage() {
  const { t } = useTranslation('superadmin');
  const { formatWithCurrency } = useFormatCurrencyExtended();
  const { formatDateIntl } = useFormatDate();
  const [status, setStatus] = useState<string>('queued');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: jobs = [] } = useSaListPrint3dJobs({ status });
  // The single-job endpoint also carries the address + shipments; the list
  // endpoint doesn't.
  const { data: detail } = useSaGetPrint3dJob(openId ?? undefined);
  const updateStatus = useSaUpdatePrint3dJobStatus();
  const updateItem = useSaUpdatePrint3dJobItem();
  const createShipment = useSaCreateShipment();
  const markDelivered = useSaMarkShipmentDelivered();
  const [partnerRef, setPartnerRef] = useState('');
  const [carrier, setCarrier] = useState('');

  const open = useMemo(
    () => detail ?? jobs.find((j) => j.id === openId) ?? null,
    [detail, jobs, openId],
  );

  const allowedFromOpen = open ? (TRANSITIONS[open.status] ?? []) : [];
  const nextStatus = allowedFromOpen.find((s) => s !== 'cancelled') ?? null;
  const canCancel = allowedFromOpen.includes('cancelled');

  function downloadManifest(job: SaPrint3dJob) {
    const blob = new Blob([print3dManifestCsv(job)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `figurunica-${job.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">{t('print3d.title')}</h1>
        <p className="text-xs text-gray-500">{t('print3d.subtitle')}</p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {TABS.map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`print3d-tab-${s}`}
            onClick={() => {
              setStatus(s);
              setOpenId(null);
            }}
            className={`rounded px-3 py-1.5 text-sm ${
              status === s ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {t(`print3d.tabs.${s}`)}
          </button>
        ))}
      </nav>

      {jobs.length === 0 ? (
        <p className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('print3d.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('print3d.col.tenant')}</th>
                <th className="px-4 py-2">{t('print3d.col.items')}</th>
                <th className="px-4 py-2">{t('print3d.col.total')}</th>
                <th className="px-4 py-2">{t('print3d.col.date')}</th>
                <th className="px-4 py-2">{t('print3d.col.status')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map((j) => (
                <tr key={j.id} data-testid={`print3d-row-${j.id}`}>
                  <td className="px-4 py-2">{j.tenantName ?? j.tenantId}</td>
                  <td className="px-4 py-2">{j.itemCount}</td>
                  <td className="px-4 py-2">{formatWithCurrency(j.totalCents / 100, j.currency)}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {formatDateIntl(j.createdAt, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-2">{t(`print3d.tabs.${j.status}`)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      data-testid={`print3d-open-${j.id}`}
                      onClick={() => setOpenId(j.id)}
                      className="text-blue-600 hover:underline"
                    >
                      {t('print3d.manifest.title')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <section className="space-y-3 rounded border bg-white p-4">
          <h2 className="text-sm font-semibold">{t('print3d.manifest.title')}</h2>
          <ul className="divide-y text-sm">
            {open.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2">
                {i.productImageUrl && (
                  <img
                    src={i.productImageUrl}
                    alt={i.productName}
                    className="h-10 w-10 rounded object-cover"
                  />
                )}
                <span className="flex-1">{i.productName}</span>
                {i.model3dUrl && (
                  <a
                    href={i.model3dUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {t('print3d.manifest.model')}
                  </a>
                )}
                {/* Item status is the operator's signal: 'rejected' means a
                    figurine must be reprinted. Leaving it read-only would
                    leave PATCH /jobs/:id/items/:itemId dead. */}
                <select
                  aria-label={t('print3d.manifest.itemStatus')}
                  data-testid={`print3d-item-status-${i.id}`}
                  className="rounded border px-1 py-0.5 text-xs"
                  value={i.status}
                  onChange={(e) =>
                    updateItem.mutateAsync({
                      jobId: open.id,
                      itemId: i.id,
                      status: e.target.value,
                    })
                  }
                >
                  {(['pending', 'printed', 'rejected'] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`print3d.itemStatus.${s}`)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <input
              className="rounded border px-2 py-1 text-sm"
              placeholder={t('print3d.actions.partnerRef')}
              value={partnerRef}
              onChange={(e) => setPartnerRef(e.target.value)}
            />
            {/* disabled exactly when TRANSITIONS[open.status] has no
                non-cancel edge — queued/in_production only. */}
            <button
              type="button"
              data-testid="print3d-advance"
              disabled={!nextStatus}
              onClick={() =>
                nextStatus &&
                updateStatus.mutateAsync({
                  id: open.id,
                  status: nextStatus,
                  partnerRef: partnerRef || undefined,
                })
              }
              className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {t('print3d.actions.advance')}
            </button>
            {/* disabled exactly when TRANSITIONS[open.status] excludes
                'cancelled' — i.e. produced/cancelled (terminal). */}
            <button
              type="button"
              data-testid="print3d-cancel"
              disabled={!canCancel}
              onClick={() =>
                canCancel && updateStatus.mutateAsync({ id: open.id, status: 'cancelled' })
              }
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {t('print3d.actions.cancel')}
            </button>
            <button
              type="button"
              data-testid="print3d-csv"
              onClick={() => downloadManifest(open)}
              className="rounded border px-3 py-1.5 text-sm"
            >
              {t('print3d.actions.exportCsv')}
            </button>
          </div>

          {/* Delivery address + shipping. No NEW backend endpoint for
              shipping: this calls the existing superadmin/shipments rail,
              and this panel is that rail's first SPA surface. Address is
              only populated on the single-job endpoint. */}
          {open.hwOrder && (
            <div className="space-y-2 border-t pt-3 text-sm">
              <h3 className="text-xs font-semibold text-gray-700">
                {t('print3d.manifest.address')}
              </h3>
              <pre
                data-testid="print3d-address"
                className="whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700"
              >
                {typeof open.hwOrder.shippingAddress === 'string'
                  ? open.hwOrder.shippingAddress
                  : Object.values(open.hwOrder.shippingAddress ?? {})
                      .filter((v) => typeof v === 'string' && v)
                      .join('\n')}
              </pre>

              <ul className="space-y-1">
                {open.hwOrder.shipments.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-xs">
                    <span>
                      {s.carrier} {s.trackingNo ?? ''} — {s.status}
                    </span>
                    {!s.deliveredAt && (
                      <button
                        type="button"
                        data-testid={`print3d-delivered-${s.id}`}
                        onClick={() => markDelivered.mutateAsync(s.id)}
                        className="rounded border px-2 py-0.5"
                      >
                        {t('print3d.actions.markDelivered')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="rounded border px-2 py-1 text-sm"
                  placeholder="Yurtiçi Kargo"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                />
                <button
                  type="button"
                  data-testid="print3d-create-shipment"
                  disabled={!carrier.trim()}
                  onClick={() =>
                    createShipment.mutateAsync({
                      orderId: open.hwOrderId,
                      carrier: carrier.trim(),
                    })
                  }
                  className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {t('print3d.actions.createShipment')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
