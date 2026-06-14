import {
  Building2,
  Users,
  CreditCard,
  TrendingUp,
  TrendingDown,
  AlertCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useDashboardStats,
  useGrowthMetrics,
  useDashboardAlerts,
  usePlanDistribution,
} from '../../features/superadmin/api/superAdminApi';

function MetricCard({
  label,
  value,
  change,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  change?: number;
  icon: any;
}) {
  const { t } = useTranslation('superadmin');
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-zinc-500">{label}</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">{value}</p>
          {change !== undefined && (
            <div className="flex items-center gap-1 mt-2">
              {change >= 0 ? (
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 text-red-500" />
              )}
              <span
                className={`text-xs font-medium ${
                  change >= 0 ? 'text-emerald-600' : 'text-red-500'
                }`}
              >
                {Math.abs(change)}%
              </span>
              <span className="text-xs text-zinc-400">{t('dashboard.vsLastMonth')}</span>
            </div>
          )}
        </div>
        <div className="w-10 h-10 bg-zinc-100 rounded-lg flex items-center justify-center">
          <Icon className="w-5 h-5 text-zinc-600" strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}

function AlertBanner({
  message,
  type = 'warning',
}: {
  message: string;
  type?: 'warning' | 'error';
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
        type === 'error'
          ? 'bg-red-50 border-red-100 text-red-700'
          : 'bg-amber-50 border-amber-100 text-amber-700'
      }`}
    >
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export default function SuperAdminDashboardPage() {
  const { t } = useTranslation('superadmin');
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: growth } = useGrowthMetrics();
  const { data: alerts } = useDashboardAlerts();
  const { data: planDistribution } = usePlanDistribution();

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{t('dashboard.title')}</h1>
        <p className="text-sm text-zinc-500 mt-1">{t('dashboard.subtitle')}</p>
      </div>

      {/* Alerts */}
      {alerts && (alerts.expiringTrials > 0 || alerts.suspendedTenants > 0 || alerts.failedPayments > 0) && (
        <div className="space-y-2">
          {alerts.expiringTrials > 0 && (
            <AlertBanner message={t('dashboard.alerts.expiringTrials', { count: alerts.expiringTrials })} />
          )}
          {alerts.suspendedTenants > 0 && (
            <AlertBanner message={t('dashboard.alerts.suspendedTenants', { count: alerts.suspendedTenants })} />
          )}
          {alerts.failedPayments > 0 && (
            <AlertBanner message={t('dashboard.alerts.failedPayments', { count: alerts.failedPayments })} type="error" />
          )}
        </div>
      )}

      {/* Primary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label={t('dashboard.metrics.totalTenants')}
          value={stats?.tenants.total || 0}
          change={growth?.tenants.growth}
          icon={Building2}
        />
        <MetricCard
          label={t('dashboard.metrics.activeTenants')}
          value={stats?.tenants.active || 0}
          icon={Building2}
        />
        <MetricCard
          label={t('dashboard.metrics.totalUsers')}
          value={stats?.users.total || 0}
          change={growth?.users.growth}
          icon={Users}
        />
        <MetricCard
          label={t('dashboard.metrics.monthlyRevenue')}
          value={`₺${(stats?.revenue.mrr || 0).toLocaleString()}`}
          icon={CreditCard}
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Subscriptions */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900">{t('dashboard.subscriptions')}</h3>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">{t('dashboard.active')}</span>
              <span className="text-sm font-medium text-zinc-900">
                {stats?.subscriptions.active || 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">{t('dashboard.trial')}</span>
              <span className="text-sm font-medium text-zinc-900">
                {stats?.subscriptions.trial || 0}
              </span>
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-zinc-100">
              <span className="text-sm text-zinc-500">{t('dashboard.total')}</span>
              <span className="text-sm font-medium text-zinc-900">
                {stats?.subscriptions.total || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Orders */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900">{t('dashboard.orders')}</h3>
          <div className="mt-4">
            <p className="text-3xl font-semibold text-zinc-900">
              {(stats?.orders.total || 0).toLocaleString()}
            </p>
            <p className="text-sm text-zinc-500 mt-1">{t('dashboard.totalCompletedOrders')}</p>
            {growth && (
              <div className="flex items-center gap-1 mt-3">
                {growth.orders.growth >= 0 ? (
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                )}
                <span
                  className={`text-xs font-medium ${
                    growth.orders.growth >= 0 ? 'text-emerald-600' : 'text-red-500'
                  }`}
                >
                  {t('dashboard.thisMonth', { percent: Math.abs(growth.orders.growth) })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Plan Distribution */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900">{t('dashboard.planDistribution')}</h3>
          <div className="mt-4 space-y-3">
            {planDistribution?.map((plan: any) => (
              <div key={plan.planId} className="flex items-center justify-between">
                <span className="text-sm text-zinc-500">{plan.planDisplayName}</span>
                <span className="text-sm font-medium text-zinc-900">{plan.count}</span>
              </div>
            ))}
            {(!planDistribution || planDistribution.length === 0) && (
              <p className="text-sm text-zinc-400">{t('dashboard.noDataAvailable')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
