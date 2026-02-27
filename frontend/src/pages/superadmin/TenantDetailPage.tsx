import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, X, RotateCcw, Save } from 'lucide-react';
import {
  useTenant,
  useTenantUsers,
  useTenantOrders,
  useTenantStats,
  useUpdateTenantStatus,
  usePlans,
  useChangeSubscriptionPlan,
  useTenantOverrides,
  useUpdateTenantOverrides,
  useResetTenantOverrides,
} from '../../features/superadmin/api/superAdminApi';

const statusStyles = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  SUSPENDED: 'bg-amber-50 text-amber-700 border-amber-100',
  DELETED: 'bg-red-50 text-red-700 border-red-100',
};

const FEATURE_LABELS: Record<string, string> = {
  advancedReports: 'Advanced Reports',
  multiLocation: 'Multi-Location',
  customBranding: 'Custom Branding',
  apiAccess: 'API Access',
  prioritySupport: 'Priority Support',
  inventoryTracking: 'Inventory Tracking',
  kdsIntegration: 'KDS Integration',
  reservationSystem: 'Reservation System',
  personnelManagement: 'Personnel Management',
};

const LIMIT_LABELS: Record<string, string> = {
  maxUsers: 'Max Users',
  maxTables: 'Max Tables',
  maxProducts: 'Max Products',
  maxCategories: 'Max Categories',
  maxMonthlyOrders: 'Max Monthly Orders',
};

type FeatureOverrideState = 'default' | 'on' | 'off';

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');

  const { data: tenant, isLoading } = useTenant(id!);
  const { data: users } = useTenantUsers(id!, 1, 10);
  const { data: orders } = useTenantOrders(id!, 1, 10);
  const { data: stats } = useTenantStats(id!);
  const { data: plans } = usePlans();
  const { data: overridesData } = useTenantOverrides(id!);
  const updateStatusMutation = useUpdateTenantStatus();
  const changePlanMutation = useChangeSubscriptionPlan();
  const updateOverridesMutation = useUpdateTenantOverrides();
  const resetOverridesMutation = useResetTenantOverrides();

  // Override form state
  const [featureStates, setFeatureStates] = useState<Record<string, FeatureOverrideState>>({});
  const [limitValues, setLimitValues] = useState<Record<string, string>>({});
  const [hasOverrideChanges, setHasOverrideChanges] = useState(false);

  // Initialize override form state from API data
  useEffect(() => {
    if (!overridesData) return;

    const fStates: Record<string, FeatureOverrideState> = {};
    for (const key of Object.keys(FEATURE_LABELS)) {
      if (overridesData.featureOverrides?.[key] === true) {
        fStates[key] = 'on';
      } else if (overridesData.featureOverrides?.[key] === false) {
        fStates[key] = 'off';
      } else {
        fStates[key] = 'default';
      }
    }
    setFeatureStates(fStates);

    const lValues: Record<string, string> = {};
    for (const key of Object.keys(LIMIT_LABELS)) {
      if (overridesData.limitOverrides?.[key] !== undefined && overridesData.limitOverrides?.[key] !== null) {
        lValues[key] = String(overridesData.limitOverrides[key]);
      } else {
        lValues[key] = '';
      }
    }
    setLimitValues(lValues);
    setHasOverrideChanges(false);
  }, [overridesData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-zinc-500">Tenant not found</p>
        <Link to="/superadmin/tenants" className="text-sm text-zinc-900 underline mt-2 inline-block">
          Back to Tenants
        </Link>
      </div>
    );
  }

  const handleStatusChange = (status: string) => {
    if (window.confirm(`Change status to ${status}?`)) {
      updateStatusMutation.mutate({ id: tenant.id, status });
    }
  };

  const activeSubscription = tenant.subscriptions?.find(
    (sub: any) => sub.status === 'ACTIVE' || sub.status === 'TRIALING'
  );

  const handleChangePlan = () => {
    if (!activeSubscription || !selectedPlanId) return;
    changePlanMutation.mutate(
      { subscriptionId: activeSubscription.id, planId: selectedPlanId },
      {
        onSuccess: () => {
          setShowPlanModal(false);
          setSelectedPlanId('');
        },
      }
    );
  };

  const openPlanModal = () => {
    setSelectedPlanId(tenant.currentPlan?.id || '');
    setShowPlanModal(true);
  };

  const cycleFeatureState = (key: string) => {
    setFeatureStates((prev) => {
      const current = prev[key] || 'default';
      const next: FeatureOverrideState =
        current === 'default' ? 'on' : current === 'on' ? 'off' : 'default';
      return { ...prev, [key]: next };
    });
    setHasOverrideChanges(true);
  };

  const handleLimitChange = (key: string, value: string) => {
    setLimitValues((prev) => ({ ...prev, [key]: value }));
    setHasOverrideChanges(true);
  };

  const handleSaveOverrides = () => {
    const featureOverrides: Record<string, boolean | null> = {};
    for (const [key, state] of Object.entries(featureStates)) {
      if (state === 'on') featureOverrides[key] = true;
      else if (state === 'off') featureOverrides[key] = false;
      else featureOverrides[key] = null; // Remove override
    }

    const limitOverrides: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(limitValues)) {
      if (value === '' || value === undefined) {
        limitOverrides[key] = null; // Remove override
      } else {
        limitOverrides[key] = Number(value);
      }
    }

    updateOverridesMutation.mutate(
      { tenantId: tenant.id, data: { featureOverrides, limitOverrides } },
      { onSuccess: () => setHasOverrideChanges(false) }
    );
  };

  const handleResetOverrides = () => {
    if (!window.confirm('Reset all overrides to plan defaults?')) return;
    resetOverridesMutation.mutate(tenant.id, {
      onSuccess: () => setHasOverrideChanges(false),
    });
  };

  const getEffectiveFeature = (key: string): boolean => {
    const state = featureStates[key];
    if (state === 'on') return true;
    if (state === 'off') return false;
    return overridesData?.planDefaults?.features?.[key] ?? false;
  };

  const getEffectiveLimit = (key: string): number => {
    const val = limitValues[key];
    if (val !== '' && val !== undefined) return Number(val);
    return overridesData?.planDefaults?.limits?.[key] ?? 0;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/superadmin/tenants"
          className="p-2 rounded-lg hover:bg-zinc-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-zinc-500" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-zinc-900">{tenant.name}</h1>
            <span
              className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${
                statusStyles[tenant.status as keyof typeof statusStyles] || statusStyles.ACTIVE
              }`}
            >
              {tenant.status}
            </span>
          </div>
          <p className="text-sm text-zinc-500 mt-0.5">{tenant.subdomain}</p>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Overview */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900 mb-4">Overview</h3>
          <dl className="space-y-3">
            <div className="flex justify-between items-center">
              <dt className="text-sm text-zinc-500">Plan</dt>
              <dd className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-900">
                  {tenant.currentPlan?.displayName || '—'}
                </span>
                {activeSubscription && (
                  <button
                    onClick={openPlanModal}
                    className="p-1 rounded hover:bg-zinc-100 transition-colors"
                    title="Change Plan"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                  </button>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">Currency</dt>
              <dd className="text-sm text-zinc-900">{tenant.currency}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">Region</dt>
              <dd className="text-sm text-zinc-900">{tenant.paymentRegion}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">Created</dt>
              <dd className="text-sm text-zinc-900">
                {new Date(tenant.createdAt).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </div>

        {/* Statistics */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900 mb-4">Statistics</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">Total Revenue</dt>
              <dd className="text-sm font-medium text-zinc-900">
                ₺{(stats?.revenue.total || 0).toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">Orders Today</dt>
              <dd className="text-sm text-zinc-900">{stats?.orders.today || 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">Orders This Month</dt>
              <dd className="text-sm text-zinc-900">{stats?.orders.thisMonth || 0}</dd>
            </div>
          </dl>
        </div>

        {/* Resources */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900 mb-4">Resources</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">Users</dt>
              <dd className="text-sm text-zinc-900">{tenant._count.users}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">Products</dt>
              <dd className="text-sm text-zinc-900">{tenant._count.products}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">Tables</dt>
              <dd className="text-sm text-zinc-900">{tenant._count.tables}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">Customers</dt>
              <dd className="text-sm text-zinc-900">{tenant._count.customers}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Subscription Info */}
      {activeSubscription && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900 mb-4">Active Subscription</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-zinc-500">Plan</p>
              <p className="text-sm font-medium text-zinc-900 mt-0.5">{activeSubscription.plan?.displayName}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Status</p>
              <p className="text-sm font-medium text-zinc-900 mt-0.5">{activeSubscription.status}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Billing Cycle</p>
              <p className="text-sm font-medium text-zinc-900 mt-0.5">{activeSubscription.billingCycle}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Period End</p>
              <p className="text-sm font-medium text-zinc-900 mt-0.5">
                {new Date(activeSubscription.currentPeriodEnd).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5">
        <h3 className="text-sm font-medium text-zinc-900 mb-4">Actions</h3>
        <div className="flex flex-wrap gap-3">
          {activeSubscription && (
            <button
              onClick={openPlanModal}
              className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Change Plan
            </button>
          )}
          {tenant.status === 'ACTIVE' && (
            <button
              onClick={() => handleStatusChange('SUSPENDED')}
              className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
            >
              Suspend
            </button>
          )}
          {tenant.status === 'SUSPENDED' && (
            <button
              onClick={() => handleStatusChange('ACTIVE')}
              className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
            >
              Activate
            </button>
          )}
          {tenant.status !== 'DELETED' && (
            <button
              onClick={() => handleStatusChange('DELETED')}
              className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Feature & Limit Overrides */}
      {overridesData && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-medium text-zinc-900">Feature & Limit Overrides</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Override plan defaults for this tenant</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleResetOverrides}
                disabled={resetOverridesMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg hover:bg-zinc-100 disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset All
              </button>
              <button
                onClick={handleSaveOverrides}
                disabled={!hasOverrideChanges || updateOverridesMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {updateOverridesMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Feature Overrides */}
          <div className="mb-6">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Features</h4>
            <div className="border border-zinc-200 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200">
                    <th className="text-left text-xs font-medium text-zinc-500 px-4 py-2">Feature</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">Plan Default</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">Override</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">Effective</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {Object.entries(FEATURE_LABELS).map(([key, label]) => {
                    const planDefault = overridesData.planDefaults?.features?.[key] ?? false;
                    const state = featureStates[key] || 'default';
                    const effective = getEffectiveFeature(key);

                    return (
                      <tr key={key}>
                        <td className="px-4 py-2.5 text-sm text-zinc-900">{label}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                            planDefault
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-zinc-100 text-zinc-500'
                          }`}>
                            {planDefault ? 'ON' : 'OFF'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={() => cycleFeatureState(key)}
                            className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                              state === 'default'
                                ? 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-100'
                                : state === 'on'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                            }`}
                          >
                            {state === 'default' ? 'Default' : state === 'on' ? 'Force ON' : 'Force OFF'}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex w-5 h-5 items-center justify-center rounded-full text-xs font-bold ${
                            effective
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-zinc-100 text-zinc-400'
                          }`}>
                            {effective ? '✓' : '✗'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Limit Overrides */}
          <div>
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Limits</h4>
            <div className="border border-zinc-200 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200">
                    <th className="text-left text-xs font-medium text-zinc-500 px-4 py-2">Limit</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">Plan Default</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">Override</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">Effective</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {Object.entries(LIMIT_LABELS).map(([key, label]) => {
                    const planDefault = overridesData.planDefaults?.limits?.[key] ?? 0;
                    const effective = getEffectiveLimit(key);

                    return (
                      <tr key={key}>
                        <td className="px-4 py-2.5 text-sm text-zinc-900">{label}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-sm text-zinc-600">
                            {planDefault === -1 ? 'Unlimited' : planDefault}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <input
                            type="number"
                            value={limitValues[key] || ''}
                            onChange={(e) => handleLimitChange(key, e.target.value)}
                            placeholder={String(planDefault === -1 ? '∞' : planDefault)}
                            className="w-24 px-2.5 py-1 text-sm text-center bg-white border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-sm font-medium ${
                            limitValues[key] !== '' ? 'text-blue-700' : 'text-zinc-600'
                          }`}>
                            {effective === -1 ? 'Unlimited' : effective}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-zinc-400 mt-2">Empty = use plan default. Enter -1 for unlimited.</p>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100">
          <h3 className="text-sm font-medium text-zinc-900">Users</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Name
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Email
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Role
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {users?.data.map((user: any) => (
              <tr key={user.id}>
                <td className="px-5 py-3 text-sm text-zinc-900">
                  {user.firstName} {user.lastName}
                </td>
                <td className="px-5 py-3 text-sm text-zinc-500">{user.email}</td>
                <td className="px-5 py-3 text-sm text-zinc-500">{user.role}</td>
                <td className="px-5 py-3 text-sm text-zinc-500">{user.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Plan Change Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-zinc-900/50" onClick={() => setShowPlanModal(false)} />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-zinc-900">Change Plan</h2>
                <button
                  onClick={() => setShowPlanModal(false)}
                  className="p-1 rounded-lg hover:bg-zinc-100 transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>

              <p className="text-sm text-zinc-500 mb-4">
                Select a new plan for <span className="font-medium text-zinc-900">{tenant.name}</span>
              </p>

              <div className="space-y-2 mb-6">
                {plans?.map((plan: any) => (
                  <label
                    key={plan.id}
                    className={`flex items-center justify-between p-4 border rounded-xl cursor-pointer transition-colors ${
                      selectedPlanId === plan.id
                        ? 'border-zinc-900 bg-zinc-50'
                        : 'border-zinc-200 hover:border-zinc-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="plan"
                        value={plan.id}
                        checked={selectedPlanId === plan.id}
                        onChange={(e) => setSelectedPlanId(e.target.value)}
                        className="w-4 h-4 text-zinc-900 border-zinc-300 focus:ring-zinc-900"
                      />
                      <div>
                        <p className="text-sm font-medium text-zinc-900">{plan.displayName}</p>
                        <p className="text-xs text-zinc-500">
                          {plan.maxUsers} users · {plan.maxTables} tables · {plan.maxProducts} products
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-zinc-900">
                        ₺{Number(plan.monthlyPrice).toLocaleString()}/mo
                      </p>
                      {plan.id === tenant.currentPlan?.id && (
                        <span className="text-xs text-zinc-500">Current</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>

              {changePlanMutation.isError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-sm text-red-600">
                    {(changePlanMutation.error as any)?.response?.data?.message || 'Failed to change plan'}
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowPlanModal(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleChangePlan}
                  disabled={!selectedPlanId || selectedPlanId === tenant.currentPlan?.id || changePlanMutation.isPending}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {changePlanMutation.isPending ? 'Changing...' : 'Change Plan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
