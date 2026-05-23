import { useTranslation } from 'react-i18next';
import { useGetHealthOverview } from './healthApi';

/**
 * Tenant-wide health dashboard. One card per branch with the composite
 * score colour pill. The breakdown row exposes the three sub-signals so
 * ops can drill down: device-online%, last-fiscal-age, last-order-age.
 */
export default function HealthPage() {
  const { t } = useTranslation('common');
  const { data: branches = [], isLoading } = useGetHealthOverview();

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('hummytummy.health.title')}</h1>
        <p className="text-sm text-gray-600">{t('hummytummy.health.subtitle')}</p>
      </header>

      {isLoading ? (
        <div className="text-sm text-gray-500">{t('hummytummy.common.loading')}</div>
      ) : branches.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('hummytummy.health.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <article key={b.id} className="rounded-lg border bg-white p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{b.name}</h3>
                <span className={pillClass(b.health.pill)}>{b.health.pill}</span>
              </div>
              <div className="my-3 text-4xl font-light tabular-nums">
                {b.health.score}
                <span className="text-base text-gray-500"> / 100</span>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-xs text-gray-600">
                <div>
                  <dt>{t('hummytummy.health.devicesOnline')}</dt>
                  <dd className="font-medium text-gray-900">{b.health.breakdown.devicesOnlinePct}%</dd>
                </div>
                <div>
                  <dt>{t('hummytummy.health.fiscalAge')}</dt>
                  <dd className="font-medium text-gray-900">{formatAge(b.health.breakdown.fiscalAgeMinutes)}</dd>
                </div>
                <div>
                  <dt>{t('hummytummy.health.orderAge')}</dt>
                  <dd className="font-medium text-gray-900">{formatAge(b.health.breakdown.orderAgeMinutes)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function pillClass(pill: 'green' | 'yellow' | 'red'): string {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
  if (pill === 'green') return `${base} bg-green-100 text-green-800`;
  if (pill === 'yellow') return `${base} bg-amber-100 text-amber-800`;
  return `${base} bg-red-100 text-red-800`;
}

function formatAge(min: number | null): string {
  if (min == null) return '—';
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 24 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / (24 * 60))}d`;
}
