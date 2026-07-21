import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Lightbulb } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import Skeleton from '../../../components/ui/Skeleton';
import { cn } from '../../../lib/utils';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useLowStockItems } from '../../stock-management/stockManagementApi';
import { useActionableInsights } from '../../analytics/analyticsApi';
import { WidgetEmpty, WidgetError } from './WidgetStates';

// A query-result shape shared by the sections. `undefined` = that section's
// plan gate is off (its hook was never mounted, so it can never 403).
type QueryLike<T> = { data?: T; isLoading: boolean; isError: boolean } | undefined;

// 403 safety: the gated hooks live in three tiny inner variants so exactly
// the entitled hooks mount — never an `if` around a hook, never a query a
// gated tenant would 403 on.
export default function AttentionCard() {
  const { hasFeature } = useSubscription();
  const stockGate = hasFeature('inventoryTracking');
  const insightGate = hasFeature('advancedReports');
  if (!stockGate && !insightGate) return null;
  if (stockGate && insightGate) return <InnerBoth />;
  if (stockGate) return <InnerStock />;
  return <InnerInsights />;
}

function InnerBoth() {
  const low = useLowStockItems();
  const ins = useActionableInsights();
  return <AttentionBody low={low} ins={ins} />;
}
function InnerStock() {
  const low = useLowStockItems();
  return <AttentionBody low={low} />;
}
function InnerInsights() {
  const ins = useActionableInsights();
  return <AttentionBody ins={ins} />;
}

const isEmpty = (q: QueryLike<unknown[]>) =>
  !q || (!q.isLoading && !q.isError && (q.data ?? []).length === 0);

function AttentionBody({ low, ins }: { low?: QueryLike<any[]>; ins?: QueryLike<any[]> }) {
  const { t } = useTranslation('common');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.attention')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="attention-body">
        {low && <LowStockSection query={low} />}
        {ins && <InsightsSection query={ins} />}
        {isEmpty(low) && isEmpty(ins) && <WidgetEmpty text={t('dashboard.allClear')} />}
      </CardContent>
    </Card>
  );
}

function LowStockSection({ query }: { query: NonNullable<QueryLike<any[]>> }) {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = query;
  if (isError) return <WidgetError />;
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  const items = (data ?? []).slice(0, 5);
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600 mb-2">
        <AlertTriangle className="h-3.5 w-3.5" />
        {t('dashboard.lowStock')}
      </div>
      <ul className="space-y-1">
        {items.map((it: { id: string; name: string; currentStock: number; minStock: number; unit: string }) => (
          <li key={it.id} data-testid="low-stock-row">
            <Link
              to="/admin/stock"
              className="flex items-center justify-between rounded-lg bg-rose-50 px-3 py-1.5 text-sm hover:bg-rose-100 transition-colors"
            >
              <span className="text-slate-800 truncate">{it.name}</span>
              <span className="text-rose-700 tabular-nums shrink-0">
                {it.currentStock}/{it.minStock} {it.unit}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SEVERITY_DOT: Record<string, string> = {
  CRITICAL: 'bg-rose-500',
  WARNING: 'bg-amber-500',
  INFO: 'bg-slate-400',
};

function InsightsSection({ query }: { query: NonNullable<QueryLike<any[]>> }) {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = query;
  if (isError) return <WidgetError />;
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  const insights = (data ?? []).slice(0, 3);
  if (insights.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
        <Lightbulb className="h-3.5 w-3.5" />
        {t('dashboard.insightsTitle')}
      </div>
      <ul className="space-y-1">
        {insights.map((ins) => (
          <li key={ins.id} data-testid="insight-row">
            <Link
              to="/admin/reports"
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors"
            >
              <span className={cn('h-2 w-2 rounded-full shrink-0', SEVERITY_DOT[ins.severity] ?? 'bg-slate-400')} />
              <span className="text-slate-800 truncate">{ins.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
