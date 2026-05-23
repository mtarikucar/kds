import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useListCallerEvents, type CallerEvent } from './callerApi';

/**
 * Recent inbound calls feed.
 *
 * Polls every 10s so the operator sees fresh calls without manual refresh.
 * Matched customers link to the customer detail page; unmatched calls show
 * the e164 as plain text so the operator can choose to create a customer
 * record from the call.
 */
export default function CallerFeedPage() {
  const { t } = useTranslation('common');
  const { data: events = [], isLoading } = useListCallerEvents(100);

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('hummytummy.callerFeed.title')}</h1>
        <p className="text-sm text-gray-600">{t('hummytummy.callerFeed.subtitle')}</p>
      </header>

      {isLoading ? (
        <div className="text-sm text-gray-500">{t('hummytummy.common.loading')}</div>
      ) : events.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('hummytummy.callerFeed.empty')}
        </div>
      ) : (
        <table className="w-full divide-y rounded border text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{t('hummytummy.callerFeed.col.time')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.callerFeed.col.provider')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.callerFeed.col.kind')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.callerFeed.col.phone')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.callerFeed.col.customer')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.callerFeed.col.duration')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.callerFeed.col.order')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.map((e: CallerEvent) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-600">{new Date(e.occurredAt).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.providerId}</td>
                <td className="px-3 py-2">
                  <KindPill kind={e.kind} />
                </td>
                <td className="px-3 py-2 font-mono">{e.e164 ?? '—'}</td>
                <td className="px-3 py-2">
                  {e.customerId ? (
                    <Link to={`/customers/${e.customerId}`} className="text-blue-600 hover:underline">
                      {t('hummytummy.callerFeed.view')}
                    </Link>
                  ) : (
                    <span className="text-gray-400">{t('hummytummy.callerFeed.unmatched')}</span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-xs">
                  {e.durationMs != null ? `${Math.round(e.durationMs / 1000)}s` : '—'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {e.orderId ? (
                    <Link to={`/pos?orderId=${e.orderId}`} className="text-blue-600 hover:underline">
                      {t('hummytummy.callerFeed.open')}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function KindPill({ kind }: { kind: string }) {
  const colors: Record<string, string> = {
    incoming: 'bg-blue-100 text-blue-800',
    answered: 'bg-green-100 text-green-800',
    ended: 'bg-gray-100 text-gray-700',
    missed: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${colors[kind] ?? 'bg-gray-100'}`}>
      {kind}
    </span>
  );
}
