import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';
import {
  useSalesReport,
  useTopProducts,
  useSalesComparison,
  metricTrend,
  downloadSalesCsv,
} from '../../features/reports/reportsApi';
import FinanceTab from './reports/FinanceTab';
import {
  BudgetTab,
  ConsolidatedTab,
  ForecastTab,
} from './reports/AccountingReportsTabs';
import { useListBranches } from '../../features/branches/branchesApi';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { cn } from '../../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Spinner from '../../components/ui/Spinner';
import StatCard from '../../components/ui/StatCard';
import HourlyOrdersChart from '../../components/reports/HourlyOrdersChart';
import CustomerAnalyticsSection from '../../components/reports/CustomerAnalyticsSection';
import InventorySection from '../../components/reports/InventorySection';
import StaffPerformanceSection from '../../components/reports/StaffPerformanceSection';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { useFormatDate } from '../../hooks/useFormatDate';
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  CreditCard,
  BarChart3,
  Wallet,
  Clock,
  Users,
  Package,
  UserCog,
  PiggyBank,
  Building2,
  Download,
  LayoutGrid,
} from 'lucide-react';

interface DateRangeForm {
  startDate: string;
  endDate: string;
}

type TabType = 'sales' | 'finance' | 'budget' | 'consolidated' | 'forecast' | 'hourly' | 'customers' | 'inventory' | 'staff';

// Faz 5a: 9 sekme üç temaya gruplanır (Satış / Finans & Bütçe / Operasyon) —
// tema pill'leri sekme şeridinin üstünde, StockPage/FinancePage'deki grup
// anahtarıyla aynı desen. Tema DEĞİŞTİRME state'i (activeTab'tan ayrı) o
// temanın ilk görünür sekmesine geçer.
type Theme = 'sales' | 'financeBudget' | 'operation';
const THEME_TABS: Record<Theme, TabType[]> = {
  sales: ['sales', 'forecast', 'hourly'],
  financeBudget: ['finance', 'budget', 'consolidated'],
  operation: ['customers', 'inventory', 'staff'],
};

const ReportsPage = ({ embedded = false }: { embedded?: boolean }) => {
  const { t } = useTranslation('reports');
  const formatCurrency = useFormatCurrency();
  const { formatDate } = useFormatDate();
  const today = format(new Date(), 'yyyy-MM-dd');
  const lastWeek = format(subDays(new Date(), 7), 'yyyy-MM-dd');

  const [activeTab, setActiveTab] = useState<TabType>('sales');
  const [theme, setTheme] = useState<Theme>('sales');
  // dateRange carries branchId too — undefined means "all branches" which
  // matches the backend's tenant-wide default.
  const [dateRange, setDateRange] = useState<{ startDate: string; endDate: string; branchId?: string }>({
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
  // Period-over-period trends for the headline cards. Decorative enhancement:
  // while loading (or on failure) the cards simply render without a trend
  // badge — the absolute numbers must never be blocked by the comparison call.
  const { data: comparison } = useSalesComparison(dateRange);

  const onSubmit = (data: DateRangeForm) => {
    setDateRange((prev) => ({ ...prev, ...data }));
  };

  const [csvDownloading, setCsvDownloading] = useState(false);
  const onDownloadCsv = async () => {
    setCsvDownloading(true);
    try {
      await downloadSalesCsv(dateRange);
    } catch {
      toast.error(t('reports.csvDownloadError'));
    } finally {
      setCsvDownloading(false);
    }
  };

  // v2.8.91: inventory + staff tabs are feature-gated server-side (the
  // /reports/* endpoints carry @RequiresFeature(INVENTORY_TRACKING) or
  // PERSONNEL_MANAGEMENT). Pre-v2.8.91 the tabs rendered for every
  // tenant and clicking returned 403 with no warning. Now we hide the
  // tab when the matching feature isn't granted. Sales/Hourly/Customers
  // remain because they use advancedReports which gates the whole page.
  const { hasFeature } = useSubscription();
  const allTabs = [
    { id: 'sales' as TabType, label: t('reports.sales'), icon: BarChart3, gate: undefined as keyof import('../../types').PlanFeatures | undefined },
    { id: 'finance' as TabType, label: t('reports.finance', 'Finans (Kâr-Zarar)'), icon: Wallet, gate: undefined },
    { id: 'budget' as TabType, label: t('reports.budget', 'Bütçe vs Fiili'), icon: PiggyBank, gate: undefined },
    { id: 'consolidated' as TabType, label: t('reports.consolidated', 'Tüm Şubeler Kâr-Zarar'), icon: Building2, gate: undefined },
    { id: 'forecast' as TabType, label: t('reports.forecast', 'Satış Tahmini'), icon: TrendingUp, gate: undefined },
    { id: 'hourly' as TabType, label: t('reports.hourlyBreakdown'), icon: Clock, gate: undefined },
    { id: 'customers' as TabType, label: t('customerAnalytics.title'), icon: Users, gate: undefined },
    { id: 'inventory' as TabType, label: t('inventoryReport.title'), icon: Package, gate: 'inventoryTracking' as const },
    { id: 'staff' as TabType, label: t('staffPerformance.title'), icon: UserCog, gate: 'personnelManagement' as const },
  ];
  const tabs = allTabs.filter((t) => !t.gate || hasFeature(t.gate));

  // Tema filtresi: mevcut feature-filtreli `tabs`ın üstüne uygulanır. Boş
  // temaların pill'i gizlenir (`themes`); tema değişince o temanın `tabs`
  // sırasındaki ilk görünür sekmesine geçilir.
  const themeTabs = tabs.filter((tb) => THEME_TABS[theme].includes(tb.id));
  const switchTheme = (th: Theme) => {
    setTheme(th);
    const first = tabs.find((tb) => THEME_TABS[th].includes(tb.id));
    if (first) setActiveTab(first.id);
  };
  const themes = (['sales', 'financeBudget', 'operation'] as Theme[]).filter((th) =>
    tabs.some((tb) => THEME_TABS[th].includes(tb.id)),
  );
  const themeMeta: Record<Theme, { label: string; icon: typeof BarChart3 }> = {
    sales: { label: t('reports.themes.sales', 'Satış'), icon: BarChart3 },
    financeBudget: { label: t('reports.themes.financeBudget', 'Finans & Bütçe'), icon: Wallet },
    operation: { label: t('reports.themes.operation', 'Operasyon'), icon: LayoutGrid },
  };

  return (
    <div>
      {!embedded && (
        <div className="mb-8">
          <h1 className="text-2xl font-heading font-bold text-slate-900">{t('reports.title')}</h1>
          <p className="text-slate-500 mt-1">{t('reports.viewReports')}</p>
        </div>
      )}

      {/* Theme pills */}
      <div className="mb-4 inline-flex rounded-xl bg-slate-100 p-1">
        {themes.map((th) => {
          const { label, icon: Icon } = themeMeta[th];
          return (
            <button
              key={th}
              onClick={() => switchTheme(th)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                theme === th
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="mb-4 md:mb-6 border-b border-slate-200/60 overflow-x-auto">
        <nav className="flex space-x-4 min-w-max" aria-label="Report tabs">
          {themeTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Date Range Filter - shown for sales, finance, hourly, customers, and staff tabs */}
      {(activeTab === 'sales' || activeTab === 'finance' || activeTab === 'hourly' || activeTab === 'customers' || activeTab === 'staff') && (
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
              <BranchFilter
                value={dateRange.branchId}
                onChange={(branchId) => setDateRange((d) => ({ ...d, branchId }))}
              />
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
                  trend={metricTrend(comparison, 'totalSales')}
                  trendLabel={t('reports.vsPreviousPeriod')}
                />
                <StatCard
                  title={t('reports.totalOrders')}
                  value={salesReport?.totalOrders || 0}
                  icon={ShoppingCart}
                  color="bg-blue-500"
                  trend={metricTrend(comparison, 'totalOrders')}
                  trendLabel={t('reports.vsPreviousPeriod')}
                />
                <StatCard
                  title={t('reports.averageOrderValue')}
                  value={formatCurrency(salesReport?.averageOrderValue || 0)}
                  icon={TrendingUp}
                  color="bg-purple-500"
                  trend={metricTrend(comparison, 'averageOrderValue')}
                  trendLabel={t('reports.vsPreviousPeriod')}
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
                        className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                      >
                        <div>
                          <p className="font-semibold capitalize">{method.method}</p>
                          <p className="text-sm text-slate-500">
                            {method.count} {t('reports.transactions')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-blue-600">
                            {formatCurrency(method.total)}
                          </p>
                          <p className="text-sm text-slate-500">
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
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>{t('reports.dailyBreakdown')}</CardTitle>
                  {/* CSV of exactly these daily rows (GET /reports/sales.csv) —
                      accountant export for the selected window/branch. */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onDownloadCsv}
                    disabled={csvDownloading}
                    className="flex items-center gap-1.5"
                  >
                    <Download className="h-4 w-4" />
                    {csvDownloading ? t('reports.downloading') : t('reports.downloadCsv')}
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {salesReport?.dailySales?.map((day) => (
                      <div
                        key={day.date}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50 rounded gap-2"
                      >
                        <div>
                          <p className="font-medium text-sm sm:text-base">
                            {formatDate(day.date, 'PP')}
                          </p>
                          <p className="text-xs sm:text-sm text-slate-500">
                            {day.orders} {t('reports.orders')}
                          </p>
                        </div>
                        <div className="sm:text-right">
                          <p className="font-bold text-blue-600">
                            {formatCurrency(day.sales)}
                          </p>
                          <div className="w-full sm:w-32 md:w-48 bg-slate-200 rounded-full h-2 mt-1">
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
                              <td className="py-3 px-4 text-slate-600">
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

      {activeTab === 'finance' && <FinanceTab dateRange={dateRange} />}
      {activeTab === 'budget' && <BudgetTab />}
      {activeTab === 'consolidated' && <ConsolidatedTab />}
      {activeTab === 'forecast' && <ForecastTab />}

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
    </div>
  );
};

/**
 * Branch filter dropdown used inline by the date-range form. Inline so it
 * lives next to the date pickers — operators expect to refine "this date
 * range" and "this branch" in the same gesture. Renders only when the
 * tenant has more than one branch; single-branch tenants see nothing and
 * the request stays tenant-wide.
 */
function BranchFilter({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const { t } = useTranslation('common');
  const { data: branches = [] } = useListBranches();
  if (branches.length <= 1) return null;
  return (
    <div className="flex-1">
      <label className="block text-sm font-medium mb-1">{t('hummytummy.reportsBranchFilter.label')}</label>
      <select
        className="w-full rounded border px-2 py-2 text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{t('hummytummy.reportsBranchFilter.all')}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
    </div>
  );
}

export default ReportsPage;
