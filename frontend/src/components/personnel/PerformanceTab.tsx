import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import {
  usePerformanceMetrics,
  usePerformanceTrends,
} from '../../features/personnel/personnelApi';

const PerformanceTab = () => {
  const { t } = useTranslation('personnel');

  const [dateRange, setDateRange] = useState<{ startDate?: string; endDate?: string }>({});
  const { data: metrics, isLoading: metricsLoading } = usePerformanceMetrics(dateRange);
  const { data: trends, isLoading: trendsLoading } = usePerformanceTrends();

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-100';
    if (score >= 60) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const getScoreBarColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return t('performance.excellent');
    if (score >= 60) return t('performance.good');
    return t('performance.needsImprovement');
  };

  const maxTrendOrders = trends ? Math.max(...trends.map((trend) => trend.totalOrders), 1) : 1;

  return (
    <div className="space-y-6">
      {/* Date Filter */}
      <div className="flex items-center gap-4">
        <input
          type="date"
          value={dateRange.startDate || ''}
          onChange={(e) => setDateRange((r) => ({ ...r, startDate: e.target.value }))}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        <span className="text-gray-400">-</span>
        <input
          type="date"
          value={dateRange.endDate || ''}
          onChange={(e) => setDateRange((r) => ({ ...r, endDate: e.target.value }))}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </div>

      {/* Performance Table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">{t('performance.title')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.employee')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.role')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('performance.totalOrders')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('performance.totalSales')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('performance.avgOrderValue')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('performance.avgPrepTime')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('performance.ordersPerHour')}</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">{t('performance.performanceScore')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {metricsLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">{t('common.loading')}</td>
                </tr>
              ) : metrics && metrics.length > 0 ? (
                metrics.map((m) => (
                  <tr key={m.user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {m.user.firstName} {m.user.lastName}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{m.user.role}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900">{m.totalOrders}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900">{m.totalSales.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{m.avgOrderValue.toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{m.avgPrepTime.toFixed(1)} {t('performance.minutes')}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{m.ordersPerHour}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${getScoreBarColor(m.performanceScore)}`}
                            style={{ width: `${m.performanceScore}%` }}
                          />
                        </div>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${getScoreColor(m.performanceScore)}`}>
                          {m.performanceScore}
                        </span>
                      </div>
                      <div className="text-center mt-1">
                        <span className="text-xs text-gray-400">{getScoreLabel(m.performanceScore)}</span>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">{t('performance.noData')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly Trends */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-blue-600" />
          {t('performance.trends')}
        </h3>
        {trendsLoading ? (
          <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>
        ) : trends && trends.length > 0 ? (
          <div className="space-y-4">
            {/* Orders bar chart */}
            <div className="flex items-end gap-2 h-40">
              {trends.map((trend) => (
                <div key={trend.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-500">{trend.totalOrders}</span>
                  <div
                    className="w-full bg-blue-500 rounded-t-md transition-all"
                    style={{ height: `${(trend.totalOrders / maxTrendOrders) * 100}%`, minHeight: '4px' }}
                  />
                  <span className="text-xs text-gray-400">{trend.label}</span>
                </div>
              ))}
            </div>

            {/* Trend summary cards */}
            <div className="grid grid-cols-3 gap-4 mt-4">
              {trends.length > 0 && (
                <>
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <div className="text-sm text-gray-500">{t('performance.totalOrders')}</div>
                    <div className="text-lg font-semibold text-blue-600">
                      {trends.reduce((sum, trend) => sum + trend.totalOrders, 0)}
                    </div>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <div className="text-sm text-gray-500">{t('performance.totalSales')}</div>
                    <div className="text-lg font-semibold text-green-600">
                      {trends.reduce((sum, trend) => sum + trend.totalSales, 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-center p-3 bg-purple-50 rounded-lg">
                    <div className="text-sm text-gray-500">{t('performance.totalHours')}</div>
                    <div className="text-lg font-semibold text-purple-600">
                      {trends.reduce((sum, trend) => sum + trend.totalHours, 0).toFixed(0)}h
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">{t('performance.noData')}</div>
        )}
      </div>
    </div>
  );
};

export default PerformanceTab;
