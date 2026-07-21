import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import Skeleton from '../../../components/ui/Skeleton';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { useOrdersByHour } from '../../../api/enhancedReportsApi';
import { todayRange } from '../lib';
import { WidgetError, WidgetEmpty } from './WidgetStates';

const MIN_SPAN = 6;

export default function HourlySalesCard() {
  const { hasFeature } = useSubscription();
  if (!hasFeature('advancedReports')) return null;
  return <HourlySalesCardInner />;
}

function HourlySalesCardInner() {
  const { t } = useTranslation('common');
  const formatCurrency = useFormatCurrency();
  const { data, isLoading, isError } = useOrdersByHour(todayRange().startDate);

  const hours = data?.hourlyData ?? [];
  const active = hours.filter((h) => h.orderCount > 0);
  const nowHour = new Date().getHours();

  // Window: first hour with data → max(last hour with data, current hour),
  // padded to a minimum span so a single busy hour doesn't render one lonely bar.
  let windowed: typeof hours = [];
  if (active.length > 0) {
    const first = active[0].hour;
    let last = Math.max(active[active.length - 1].hour, nowHour);
    if (last - first + 1 < MIN_SPAN) last = Math.min(23, first + MIN_SPAN - 1);
    windowed = hours.filter((h) => h.hour >= first && h.hour <= last);
  }
  const maxSales = Math.max(1, ...windowed.map((h) => h.totalSales));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('dashboard.hourlySales')}</CardTitle>
        <Link
          to="/admin/reports"
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
        >
          {t('dashboard.detailedReport')}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent>
        {isError ? (
          <WidgetError />
        ) : isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : windowed.length === 0 ? (
          <WidgetEmpty text={t('dashboard.noSalesYet')} />
        ) : (
          <div className="flex items-end gap-1.5 h-40" role="img" aria-label={t('dashboard.hourlySales')}>
            {windowed.map((h) => (
              <div
                key={h.hour}
                data-testid="hour-bar"
                title={`${String(h.hour).padStart(2, '0')}:00 · ${h.orderCount} · ${formatCurrency(h.totalSales)}`}
                className="flex-1 flex flex-col items-center gap-1 min-w-0"
              >
                <div className="w-full h-32 flex items-end">
                  <div
                    className={`w-full rounded-t ${h.hour === nowHour ? 'bg-primary-500' : 'bg-primary-200'}`}
                    style={{ height: `${Math.max(h.totalSales > 0 ? 6 : 2, Math.round((h.totalSales / maxSales) * 100))}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 tabular-nums">{h.hour}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
