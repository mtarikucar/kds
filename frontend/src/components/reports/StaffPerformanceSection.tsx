import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Spinner from '../ui/Spinner';
import { useStaffPerformance } from '../../api/enhancedReportsApi';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { Users, ShoppingCart, TrendingUp, Award } from 'lucide-react';

interface StaffPerformanceSectionProps {
  startDate?: string;
  endDate?: string;
}

const StaffPerformanceSection = ({ startDate, endDate }: StaffPerformanceSectionProps) => {
  const { t } = useTranslation('reports');
  const formatCurrency = useFormatCurrency();
  const { data, isLoading, error } = useStaffPerformance({ startDate, endDate });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-gray-500">{t('reports.noData')}</p>
        </CardContent>
      </Card>
    );
  }

  // Sort staff by total sales (best performers first)
  const sortedStaff = [...data.staffPerformance].sort((a, b) => b.totalSales - a.totalSales);
  const topPerformer = sortedStaff[0];

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">{t('staffPerformance.totalStaff')}</p>
                <p className="text-2xl font-bold">{data.summary.totalStaff}</p>
              </div>
              <div className="p-3 rounded-full bg-primary-500">
                <Users className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">{t('staffPerformance.totalOrders')}</p>
                <p className="text-2xl font-bold">{data.summary.totalOrders}</p>
              </div>
              <div className="p-3 rounded-full bg-green-500">
                <ShoppingCart className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">{t('staffPerformance.averageOrdersPerStaff')}</p>
                <p className="text-2xl font-bold">{data.summary.averageOrdersPerStaff.toFixed(1)}</p>
              </div>
              <div className="p-3 rounded-full bg-purple-500">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">{t('staffPerformance.averageSalesPerStaff')}</p>
                <p className="text-2xl font-bold">{formatCurrency(data.summary.averageSalesPerStaff)}</p>
              </div>
              <div className="p-3 rounded-full bg-amber-500">
                <Award className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Performer Highlight */}
      {topPerformer && (
        <Card className="border-yellow-200 bg-gradient-to-r from-yellow-50 to-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-4 rounded-full bg-yellow-500">
                <Award className="h-8 w-8 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-amber-700 font-medium">Top Performer</p>
                <p className="text-xl font-bold text-gray-900">{topPerformer.staffName}</p>
                <p className="text-sm text-gray-600 capitalize">{topPerformer.role.toLowerCase()}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(topPerformer.totalSales)}
                </p>
                <p className="text-sm text-gray-500">
                  {topPerformer.totalOrders} orders
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Staff Performance Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('staffPerformance.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.staffPerformance.length === 0 ? (
            <p className="text-center text-gray-500 py-4">{t('reports.noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4">#</th>
                    <th className="text-left py-3 px-4">{t('staffPerformance.staffName')}</th>
                    <th className="text-left py-3 px-4">{t('staffPerformance.role')}</th>
                    <th className="text-right py-3 px-4">{t('staffPerformance.totalOrders')}</th>
                    <th className="text-right py-3 px-4">{t('staffPerformance.totalSales')}</th>
                    <th className="text-right py-3 px-4">{t('staffPerformance.averageOrderValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStaff.map((staff, index) => (
                    <tr key={staff.userId} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4">
                        {index === 0 ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-500 text-white text-sm font-bold">
                            1
                          </span>
                        ) : index === 1 ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-400 text-white text-sm font-bold">
                            2
                          </span>
                        ) : index === 2 ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-600 text-white text-sm font-bold">
                            3
                          </span>
                        ) : (
                          <span className="text-gray-500 font-medium">{index + 1}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-medium">{staff.staffName}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">
                          {staff.role.toLowerCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">{staff.totalOrders}</td>
                      <td className="py-3 px-4 text-right font-semibold text-green-600">
                        {formatCurrency(staff.totalSales)}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-600">
                        {formatCurrency(staff.averageOrderValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Sales Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sortedStaff.map((staff, index) => {
              const maxSales = sortedStaff[0]?.totalSales || 1;
              const percentage = (staff.totalSales / maxSales) * 100;

              return (
                <div key={staff.userId} className="flex items-center gap-4">
                  <div className="w-32 truncate">
                    <p className="font-medium text-sm">{staff.staffName}</p>
                  </div>
                  <div className="flex-1">
                    <div className="relative h-8 bg-gray-100 rounded overflow-hidden">
                      <div
                        className={`absolute inset-y-0 left-0 rounded transition-all duration-500 ${
                          index === 0
                            ? 'bg-yellow-500'
                            : index === 1
                            ? 'bg-gray-400'
                            : index === 2
                            ? 'bg-amber-600'
                            : 'bg-primary-500'
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                      <div className="absolute inset-0 flex items-center px-3">
                        <span className="text-sm font-medium text-gray-700">
                          {formatCurrency(staff.totalSales)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StaffPerformanceSection;
