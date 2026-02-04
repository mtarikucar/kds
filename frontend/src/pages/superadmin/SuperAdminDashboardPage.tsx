import {
  Building2,
  Users,
  CreditCard,
  TrendingUp,
  TrendingDown,
  AlertCircle,
} from 'lucide-react';
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
              <span className="text-xs text-zinc-400">vs last month</span>
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
        <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">Platform overview and key metrics</p>
      </div>

      {/* Alerts */}
      {alerts && (alerts.expiringTrials > 0 || alerts.suspendedTenants > 0 || alerts.failedPayments > 0) && (
        <div className="space-y-2">
          {alerts.expiringTrials > 0 && (
            <AlertBanner message={`${alerts.expiringTrials} trial(s) expiring soon`} />
          )}
          {alerts.suspendedTenants > 0 && (
            <AlertBanner message={`${alerts.suspendedTenants} suspended tenant(s)`} />
          )}
          {alerts.failedPayments > 0 && (
            <AlertBanner message={`${alerts.failedPayments} failed payment(s)`} type="error" />
          )}
        </div>
      )}

      {/* Primary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Tenants"
          value={stats?.tenants.total || 0}
          change={growth?.tenants.growth}
          icon={Building2}
        />
        <MetricCard
          label="Active Tenants"
          value={stats?.tenants.active || 0}
          icon={Building2}
        />
        <MetricCard
          label="Total Users"
          value={stats?.users.total || 0}
          change={growth?.users.growth}
          icon={Users}
        />
        <MetricCard
          label="Monthly Revenue"
          value={`₺${(stats?.revenue.mrr || 0).toLocaleString()}`}
          icon={CreditCard}
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Subscriptions */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900">Subscriptions</h3>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">Active</span>
              <span className="text-sm font-medium text-zinc-900">
                {stats?.subscriptions.active || 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">Trial</span>
              <span className="text-sm font-medium text-zinc-900">
                {stats?.subscriptions.trial || 0}
              </span>
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-zinc-100">
              <span className="text-sm text-zinc-500">Total</span>
              <span className="text-sm font-medium text-zinc-900">
                {stats?.subscriptions.total || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Orders */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900">Orders</h3>
          <div className="mt-4">
            <p className="text-3xl font-semibold text-zinc-900">
              {(stats?.orders.total || 0).toLocaleString()}
            </p>
            <p className="text-sm text-zinc-500 mt-1">Total completed orders</p>
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
                  {Math.abs(growth.orders.growth)}% this month
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Plan Distribution */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900">Plan Distribution</h3>
          <div className="mt-4 space-y-3">
            {planDistribution?.map((plan: any) => (
              <div key={plan.planId} className="flex items-center justify-between">
                <span className="text-sm text-zinc-500">{plan.planDisplayName}</span>
                <span className="text-sm font-medium text-zinc-900">{plan.count}</span>
              </div>
            ))}
            {(!planDistribution || planDistribution.length === 0) && (
              <p className="text-sm text-zinc-400">No data available</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
