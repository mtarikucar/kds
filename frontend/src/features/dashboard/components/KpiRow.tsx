import { useTranslation } from 'react-i18next';
import { Banknote, Receipt, ShoppingBag, Table as TableIcon } from 'lucide-react';
import StatCard from '../../../components/ui/StatCard';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { useSalesReport, useSalesComparison, metricTrend } from '../../reports/reportsApi';
import { useTables } from '../../tables/tablesApi';
import { todayRange } from '../lib';

// Gate wrapper: tenants without advancedReports must never fire the /reports
// queries (they would 403). Inner component calls hooks unconditionally.
export function SalesKpis() {
  const { hasFeature } = useSubscription();
  if (!hasFeature('advancedReports')) return null;
  return <SalesKpisInner />;
}

function SalesKpisInner() {
  const { t } = useTranslation('common');
  const formatCurrency = useFormatCurrency();
  const range = todayRange();
  const { data: sales, isLoading, isError } = useSalesReport(range);
  const { data: comparison } = useSalesComparison(range);

  if (isError) return null; // KPI row fails soft; ops tiles still tell the story

  return (
    <>
      <StatCard
        title={t('dashboard.todaysSales')}
        value={formatCurrency(sales?.totalSales ?? 0)}
        icon={Banknote}
        color="bg-green-500"
        trend={metricTrend(comparison, 'totalSales')}
        trendLabel={t('dashboard.vsYesterday')}
        isLoading={isLoading}
      />
      <StatCard
        title={t('dashboard.todaysOrders')}
        value={String(sales?.totalOrders ?? 0)}
        icon={Receipt}
        color="bg-blue-500"
        trend={metricTrend(comparison, 'totalOrders')}
        trendLabel={t('dashboard.vsYesterday')}
        isLoading={isLoading}
      />
      <StatCard
        title={t('dashboard.avgBasket')}
        value={formatCurrency(sales?.averageOrderValue ?? 0)}
        icon={ShoppingBag}
        color="bg-purple-500"
        trend={metricTrend(comparison, 'averageOrderValue')}
        trendLabel={t('dashboard.vsYesterday')}
        isLoading={isLoading}
      />
    </>
  );
}

export function OpenTablesKpi() {
  const { t } = useTranslation('common');
  const { data: tables, isLoading, isError } = useTables();

  if (isError) return null;
  const occupied = (tables ?? []).filter((tb) => tb.status === 'OCCUPIED').length;
  const total = (tables ?? []).length;

  return (
    <StatCard
      title={t('dashboard.openTables')}
      value={`${occupied}/${total}`}
      icon={TableIcon}
      color="bg-orange-500"
      isLoading={isLoading}
    />
  );
}
