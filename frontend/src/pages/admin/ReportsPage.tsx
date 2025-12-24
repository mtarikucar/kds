import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { format, subDays } from 'date-fns';
import { useSalesReport, useTopProducts } from '../../features/reports/reportsApi';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Spinner from '../../components/ui/Spinner';
import HourlyOrdersChart from '../../components/reports/HourlyOrdersChart';
import CustomerAnalyticsSection from '../../components/reports/CustomerAnalyticsSection';
import InventorySection from '../../components/reports/InventorySection';
import StaffPerformanceSection from '../../components/reports/StaffPerformanceSection';
import ZReportsSection from '../../components/reports/ZReportsSection';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  CreditCard,
  BarChart3,
  Clock,
  Users,
  Package,
  UserCog,
  FileText,
} from 'lucide-react';

interface DateRangeForm {
  startDate: string;
  endDate: string;
}

type TabType = 'sales' | 'hourly' | 'customers' | 'inventory' | 'staff' | 'zreports';

const ReportsPage = () => {
  const { t } = useTranslation('reports');
  const formatCurrency = useFormatCurrency();
  const today = format(new Date(), 'yyyy-MM-dd');
  const lastWeek = format(subDays(new Date(), 7), 'yyyy-MM-dd');

  const [activeTab, setActiveTab] = useState<TabType>('sales');
  const [dateRange, setDateRange] = useState({
    startDate: lastWeek,
    endDate: today,
  });

  const { register, handleSubmit } = useForm<DateRangeForm>({
    defaultValues: {
      startDate: lastWeek,
      endDate: today,
    },
  });

  const { data: salesReport, isLoading: salesLoading } = useSalesReport(dateRange);
  const { data: topProducts, isLoading: productsLoading } = useTopProducts(dateRange);

  const onSubmit = (data: DateRangeForm) => {
    setDateRange(data);
  };

  const tabs = [
    { id: 'sales' as TabType, label: t('reports.sales'), icon: BarChart3 },
    { id: 'hourly' as TabType, label: t('reports.hourlyBreakdown'), icon: Clock },
    { id: 'customers' as TabType, label: t('customerAnalytics.title'), icon: Users },
    { id: 'inventory' as TabType, label: t('inventoryReport.title'), icon: Package },
    { id: 'staff' as TabType, label: t('staffPerformance.title'), icon: UserCog },
    { id: 'zreports' as TabType, label: t('zReports.title', 'Z-Reports'), icon: FileText },
  ];

  const StatCard = ({
    title,
    value,
    icon: Icon,
    color,
  }: {
    title: string;
    value: string | number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }) => (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 mb-1">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
          <div className={`p-3 rounded-full ${color}`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div>
      <div className="mb-4 md:mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('reports.title')}</h1>
        <p className="text-sm md:text-base text-gray-600">{t('reports.viewReports')}</p>
      </div>

      {/* Tabs */}
      <div className="mb-4 md:mb-6 border-b border-gray-200 overflow-x-auto">
        <nav className="flex space-x-4 min-w-max" aria-label="Report tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Date Range Filter - shown for sales, hourly, customers, and staff tabs */}
      {(activeTab === 'sales' || activeTab === 'hourly' || activeTab === 'customers' || activeTab === 'staff') && (
        <Card className="mb-4 md:mb-6">
          <CardContent className="pt-4 md:pt-6">
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end">
              <div className="flex-1">
                <Input
                  label={t('reports.from')}
                  type="date"
                  {...register('startDate')}
                />
              </div>
              <div className="flex-1">
                <Input
                  label={t('reports.to')}
                  type="date"
                  {...register('endDate')}
                />
              </div>
              <Button type="submit" className="w-full sm:w-auto">{t('common:buttons.apply')}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Tab Content */}
      {activeTab === 'sales' && (
        <>
          {salesLoading ? (
            <Spinner />
          ) : (
            <>
              {/* Stats Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-6 mb-4 md:mb-6">
                <StatCard
                  title={t('reports.totalSales')}
                  value={formatCurrency(salesReport?.totalSales || 0)}
                  icon={DollarSign}
                  color="bg-green-500"
                />
                <StatCard
                  title={t('reports.totalOrders')}
                  value={salesReport?.totalOrders || 0}
                  icon={ShoppingCart}
                  color="bg-blue-500"
                />
                <StatCard
                  title={t('reports.averageOrderValue')}
                  value={formatCurrency(salesReport?.averageOrderValue || 0)}
                  icon={TrendingUp}
                  color="bg-purple-500"
                />
                <StatCard
                  title={t('reports.totalDiscounts')}
                  value={formatCurrency(salesReport?.totalDiscount || 0)}
                  icon={CreditCard}
                  color="bg-orange-500"
                />
              </div>

              {/* Payment Methods Breakdown */}
              <Card className="mb-4 md:mb-6">
                <CardHeader>
                  <CardTitle>{t('reports.salesByPaymentMethod')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {salesReport?.paymentMethodBreakdown?.map((method) => (
                      <div
                        key={method.method}
                        className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                      >
                        <div>
                          <p className="font-semibold capitalize">{method.method}</p>
                          <p className="text-sm text-gray-600">
                            {method.count} transactions
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-blue-600">
                            {formatCurrency(method.total)}
                          </p>
                          <p className="text-sm text-gray-600">
                            {salesReport?.totalSales
                              ? (
                                  (method.total / salesReport.totalSales) *
                                  100
                                ).toFixed(1)
                              : 0}
                            %
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Daily Sales Chart */}
              <Card className="mb-4 md:mb-6">
                <CardHeader>
                  <CardTitle>{t('reports.dailyBreakdown')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {salesReport?.dailySales?.map((day) => (
                      <div
                        key={day.date}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-gray-50 rounded gap-2"
                      >
                        <div>
                          <p className="font-medium text-sm sm:text-base">
                            {format(new Date(day.date), 'MMM dd, yyyy')}
                          </p>
                          <p className="text-xs sm:text-sm text-gray-600">
                            {day.orders} {t('reports.orders')}
                          </p>
                        </div>
                        <div className="sm:text-right">
                          <p className="font-bold text-blue-600">
                            {formatCurrency(day.sales)}
                          </p>
                          <div className="w-full sm:w-32 md:w-48 bg-gray-200 rounded-full h-2 mt-1">
                            <div
                              className="bg-blue-600 h-2 rounded-full"
                              style={{
                                width: `${
                                  salesReport?.totalSales
                                    ? (day.sales / salesReport.totalSales) * 100
                                    : 0
                                }%`,
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Top Products */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('reports.topSellingProducts')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {productsLoading ? (
                    <Spinner />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4">{t('reports.rank')}</th>
                            <th className="text-left py-3 px-4">{t('reports.product')}</th>
                            <th className="text-left py-3 px-4">{t('reports.category')}</th>
                            <th className="text-right py-3 px-4">{t('reports.quantitySold')}</th>
                            <th className="text-right py-3 px-4">{t('reports.revenue')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topProducts?.map((product, index) => (
                            <tr key={product.productId} className="border-b">
                              <td className="py-3 px-4">
                                <span className="font-bold text-blue-600">
                                  #{index + 1}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-medium">
                                {product.productName}
                              </td>
                              <td className="py-3 px-4 text-gray-600">
                                {product.categoryName}
                              </td>
                              <td className="py-3 px-4 text-right">
                                {product.quantitySold}
                              </td>
                              <td className="py-3 px-4 text-right font-semibold text-green-600">
                                {formatCurrency(product.revenue)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {activeTab === 'hourly' && (
        <HourlyOrdersChart date={dateRange.endDate} />
      )}

      {activeTab === 'customers' && (
        <CustomerAnalyticsSection
          startDate={dateRange.startDate}
          endDate={dateRange.endDate}
        />
      )}

      {activeTab === 'inventory' && (
        <InventorySection />
      )}

      {activeTab === 'staff' && (
        <StaffPerformanceSection
          startDate={dateRange.startDate}
          endDate={dateRange.endDate}
        />
      )}

      {activeTab === 'zreports' && (
        <ZReportsSection />
      )}
    </div>
  );
};

export default ReportsPage;
