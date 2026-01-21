import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Spinner from '../ui/Spinner';
import { useOrdersByHour, HourlyData } from '../../api/enhancedReportsApi';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

interface HourlyOrdersChartProps {
  date?: string;
}

const HourlyOrdersChart = ({ date }: HourlyOrdersChartProps) => {
  const { t } = useTranslation('reports');
  const formatCurrency = useFormatCurrency();
  const { data, isLoading, error } = useOrdersByHour(date);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex justify-center">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-slate-500">{t('reports.noData')}</p>
        </CardContent>
      </Card>
    );
  }

  const maxOrders = Math.max(...data.hourlyData.map((h: HourlyData) => h.orderCount), 1);

  // Format hour for display (e.g., "9 AM", "2 PM")
  const formatHour = (hour: number): string => {
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
  };

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
                      {hourData.orderCount} orders
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
            <span className="text-slate-600">Total Orders: </span>
            <span className="font-bold">
              {data.hourlyData.reduce((sum: number, h: HourlyData) => sum + h.orderCount, 0)}
            </span>
          </div>
          <div>
            <span className="text-slate-600">Total Sales: </span>
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
