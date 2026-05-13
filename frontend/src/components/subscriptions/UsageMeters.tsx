import { useTranslation } from 'react-i18next';
import { useSubscription } from '../../contexts/SubscriptionContext';

interface UsageRow {
  label: string;
  current: number;
  /** -1 = unlimited (BUSINESS plan). */
  limit: number;
}

interface UsageMetersProps {
  /** Current resource counts pulled by the caller (the dashboard usually
   *  has these from sidebar / page-level queries). */
  usage: {
    users?: number;
    tables?: number;
    products?: number;
    categories?: number;
    monthlyOrders?: number;
  };
}

/**
 * Renders a list of "Kullanıcılar 8/15 ████░░" rows for the resources
 * the current plan limits. Rows whose limit is `-1` (unlimited) are
 * skipped to avoid drawing a misleading 0% bar. When approaching 80%
 * of any limit we tint the bar amber, and red at 95%+.
 */
export default function UsageMeters({ usage }: UsageMetersProps) {
  const { t } = useTranslation('subscriptions');
  const { plan, checkLimit } = useSubscription();
  if (!plan) return null;

  const rows: UsageRow[] = [
    { label: t('subscriptions.usage.users'), current: usage.users ?? 0, limit: plan.limits.maxUsers },
    { label: t('subscriptions.usage.tables'), current: usage.tables ?? 0, limit: plan.limits.maxTables },
    { label: t('subscriptions.usage.products'), current: usage.products ?? 0, limit: plan.limits.maxProducts },
    {
      label: t('subscriptions.usage.categories'),
      current: usage.categories ?? 0,
      limit: plan.limits.maxCategories,
    },
    {
      label: t('subscriptions.usage.monthlyOrders'),
      current: usage.monthlyOrders ?? 0,
      limit: plan.limits.maxMonthlyOrders,
    },
  ];

  // checkLimit honors per-tenant overrides — preferred over plan.limits
  // directly when computing % full.
  const finiteRows = rows
    .map((row) => ({ ...row, check: checkLimit(rowToResource(row.label, t) as any, row.current) }))
    .filter((r) => r.check.limit !== -1);

  if (finiteRows.length === 0) return null;

  return (
    <div className="space-y-3">
      {finiteRows.map(({ label, current, check }) => {
        const pct = check.limit > 0 ? Math.min(100, (current / check.limit) * 100) : 0;
        const tone =
          pct >= 95
            ? 'bg-red-500'
            : pct >= 80
              ? 'bg-amber-500'
              : 'bg-emerald-500';
        return (
          <div key={label}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-700">{label}</span>
              <span className="font-medium text-slate-900">
                {current.toLocaleString('tr-TR')} / {check.limit.toLocaleString('tr-TR')}
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded overflow-hidden">
              <div
                className={`h-full ${tone} transition-all`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {pct >= 80 && (
              <p className="mt-1 text-xs text-amber-700">
                {t('subscriptions.usage.nearingLimit', {
                  pct: Math.round(pct),
                  defaultValue: `%${Math.round(pct)} dolu — plan yükseltme gerekebilir`,
                })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Translate row label back to the canonical resource key
// (`PlanLimits` field) — checkLimit needs the resource enum, not the
// localized label. We keep this local because i18n labels aren't stable.
function rowToResource(label: string, t: (k: string) => string): string {
  if (label === t('subscriptions.usage.users')) return 'maxUsers';
  if (label === t('subscriptions.usage.tables')) return 'maxTables';
  if (label === t('subscriptions.usage.products')) return 'maxProducts';
  if (label === t('subscriptions.usage.categories')) return 'maxCategories';
  if (label === t('subscriptions.usage.monthlyOrders')) return 'maxMonthlyOrders';
  return 'maxUsers';
}
