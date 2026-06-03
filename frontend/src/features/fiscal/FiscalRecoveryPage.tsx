import { useTranslation } from 'react-i18next';
import { useListPendingReceipts, useRetryReceipt, type FiscalReceipt } from './fiscalApi';

/**
 * Manual recovery panel for fiscal receipts.
 *
 * Surfaces every receipt that hasn't successfully issued. Operators click
 * Retry; the backend re-dispatches against the original idempotency key so
 * the device will not double-issue.
 *
 * Polls every 20s — the table is cheap (limited to the latest 100 pending
 * rows) and the live status feedback matters for ops during incidents.
 */
export default function FiscalRecoveryPage() {
  const { t } = useTranslation('common');
  const { data: rows = [], isLoading, refetch } = useListPendingReceipts();
  const retry = useRetryReceipt();

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('hummytummy.fiscalRecovery.title')}</h1>
          <p className="text-sm text-gray-600">{t('hummytummy.fiscalRecovery.subtitle')}</p>
        </div>
        <button onClick={() => refetch()} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">
          {t('hummytummy.fiscalRecovery.refresh')}
        </button>
      </header>

      {isLoading ? (
        <div className="text-sm text-gray-500">{t('hummytummy.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('hummytummy.fiscalRecovery.empty')}
        </div>
      ) : (
        <table className="w-full divide-y rounded border text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.created')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.provider')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.order')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.status')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.total')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.lastError')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r: FiscalReceipt) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2 text-xs">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.providerId}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.orderId ?? '—'}</td>
                <td className="px-3 py-2">
                  <StatusPill status={r.status} attempts={r.attempts} />
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {(r.totalCents / 100).toLocaleString('tr-TR', { style: 'currency', currency: r.currency })}
                </td>
                <td className="px-3 py-2 text-xs text-red-700 max-w-sm break-words">
                  {r.lastError ?? '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(r.id)}
                  >
                    {t('hummytummy.fiscalRecovery.retry')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusPill({ status, attempts }: { status: string; attempts: number }) {
  const colors: Record<string, string> = {
    queued: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100'}`}>
      {status}
      {attempts > 0 && <span className="opacity-60">×{attempts}</span>}
    </span>
  );
}
