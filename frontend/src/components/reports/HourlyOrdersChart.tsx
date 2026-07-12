import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Spinner from '../ui/Spinner';
import { ErrorState } from '../ui/ErrorState';
import { useOrdersByHour, HourlyData } from '../../api/enhancedReportsApi';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { useDateTimeFormat } from '../../hooks/useLocale';

interface HourlyOrdersChartProps {
  date?: string;
}

const HourlyOrdersChart = ({ date }: HourlyOrdersChartProps) => {
  const { t } = useTranslation('reports');
  const formatCurrency = useFormatCurrency();
  // Locale-aware hour labels ("9 AM" in en, "09" in tr) instead of
  // hardcoded English AM/PM strings.
  const hourFormatter = useDateTimeFormat({ hour: 'numeric' });
  const { data, isLoading, error, refetch } = useOrdersByHour(date);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex justify-center">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  // A failed request gets an honest error + retry; only a clean-but-empty
  // response falls through to the "no data" card.
  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => refetch()} />
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-slate-500">{t('reports.noData')}</p>
        </CardContent>
      </Card>
    );
  }

  const maxOrders = Math.max(...data.hourlyData.map((h: HourlyData) => h.orderCount), 1);

  const formatHour = (hour: number): string =>
    hourFormatter.format(new Date(2000, 0, 1, hour));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('reports.hourlyBreakdown')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.hourlyData.map((hourData: HourlyData) => (
            <div
              key={hourData.hour}
              className="flex items-center gap-3 p-2 rounded hover:bg-slate-50"
            >
              <div className="w-16 text-sm text-slate-600 font-medium">
                {formatHour(hourData.hour)}
              </div>
              <div className="flex-1">
                <div className="relative h-6 bg-slate-100 rounded overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-500 rounded transition-all duration-300"
                    style={{
                      width: `${(hourData.orderCount / maxOrders) * 100}%`,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center px-2">
                    <span className="text-xs font-medium text-slate-700">
                      {t('reports.ordersCount', { count: hourData.orderCount })}
                    </span>
                  </div>
                </div>
              </div>
              <div className="w-24 text-right text-sm font-semibold text-green-600">
                {formatCurrency(hourData.totalSales)}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="mt-4 pt-4 border-t flex justify-between text-sm">
          <div>
            <span className="text-slate-600">{t('reports.totalOrders')}: </span>
            <span className="font-bold">
              {data.hourlyData.reduce((sum: number, h: HourlyData) => sum + h.orderCount, 0)}
            </span>
          </div>
          <div>
            <span className="text-slate-600">{t('reports.totalSales')}: </span>
            <span className="font-bold text-green-600">
              {formatCurrency(
                data.hourlyData.reduce((sum: number, h: HourlyData) => sum + h.totalSales, 0)
              )}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default HourlyOrdersChart;
