import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, RefreshCw, RotateCcw, Save } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import {
  useTenant,
  useTenantUsers,
  useTenantStats,
  useUpdateTenantStatus,
  usePlans,
  useChangeSubscriptionPlan,
  useTenantOverrides,
  useUpdateTenantOverrides,
  useResetTenantOverrides,
} from '../../features/superadmin/api/superAdminApi';
import {
  FeatureOverrideState,
  buildFeatureOverridesPayload,
  buildLimitOverridesPayload,
  cycleFeatureOverrideState,
  getEffectiveFeature as resolveEffectiveFeature,
  getEffectiveLimit as resolveEffectiveLimit,
  initFeatureStates,
  initLimitValues,
} from './tenantOverrides.helpers';
import { getApiErrorMessage } from '../../lib/api-error';
import { isDemoPlan, resolvePlanAmountForCycle } from './plans.helpers';

const statusStyles = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  SUSPENDED: 'bg-amber-50 text-amber-700 border-amber-100',
  DELETED: 'bg-red-50 text-red-700 border-red-100',
};

// M10: these keys must mirror the backend FEATURE_KEYS / LIMIT_KEYS whitelist
// in superadmin-tenants.service.ts. featureStates/limitValues are keyed off
// Object.keys() of these maps and buildFeatureOverridesPayload/
// buildLimitOverridesPayload iterate those state maps, so a key absent here can
// NEVER be sent even though the backend accepts it. deliveryIntegration /
// externalDisplay / posAccess (the revenue-gating modules) and the maxBranches
// limit were missing, so the override editor could not grant them.
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
  deliveryIntegration: 'Delivery Integration',
  externalDisplay: 'External Display (Partner Display)',
  posAccess: 'POS Access',
  aiContentGeneration: 'AI Content Generation (Menu Studio)',
};

const LIMIT_LABELS: Record<string, string> = {
  maxUsers: 'Max Users',
  maxTables: 'Max Tables',
  maxBranches: 'Max Branches',
  maxProducts: 'Max Products',
  maxCategories: 'Max Categories',
  maxMonthlyOrders: 'Max Monthly Orders',
  maxMonthlyAiPhotos: 'AI Photos / month',
  maxMonthlyAiVideos: 'AI Videos / month',
  maxMonthlyAi3dModels: 'AI 3D Models / month',
};

export default function TenantDetailPage() {
  const { t } = useTranslation('superadmin');
  const { id } = useParams<{ id: string }>();
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  // F6: SUSPEND/DELETE go through a styled confirm modal that collects the
  // DTO-supported `reason` (required for DELETE) and, for DELETE, states the
  // consequences + requires re-typing the tenant name.
  const [statusAction, setStatusAction] = useState<'SUSPENDED' | 'DELETED' | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [deleteNameConfirm, setDeleteNameConfirm] = useState('');

  const { data: tenant, isLoading } = useTenant(id!);
  const { data: users } = useTenantUsers(id!, 1, 10);
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

    setFeatureStates(initFeatureStates(Object.keys(FEATURE_LABELS), overridesData));
    setLimitValues(initLimitValues(Object.keys(LIMIT_LABELS), overridesData));
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
        <p className="text-sm text-zinc-500">{t('tenantDetail.notFound')}</p>
        <Link to="/superadmin/tenants" className="text-sm text-zinc-900 underline mt-2 inline-block">
          {t('tenantDetail.backToTenants')}
        </Link>
      </div>
    );
  }

  // ACTIVE is non-destructive (re-activation), so a plain confirm stays
  // sufficient; it also covers the DELETED → ACTIVE recovery path (the
  // backend status flip is fully reversible and re-parks/reclaims the
  // subdomain + rotates sessions on either direction).
  const handleActivate = () => {
    if (window.confirm(t('tenantDetail.confirmStatusChange', { status: 'ACTIVE' }))) {
      updateStatusMutation.mutate(
        { id: tenant.id, status: 'ACTIVE' },
        { onSuccess: () => toast.success(t('tenantDetail.statusUpdated')) },
      );
    }
  };

  const openStatusModal = (action: 'SUSPENDED' | 'DELETED') => {
    setStatusReason('');
    setDeleteNameConfirm('');
    setStatusAction(action);
  };

  const closeStatusModal = () => {
    if (updateStatusMutation.isPending) return;
    setStatusAction(null);
  };

  const confirmStatusAction = () => {
    if (!statusAction || updateStatusMutation.isPending) return;
    const trimmedReason = statusReason.trim();
    if (statusAction === 'DELETED') {
      // DELETE demands a reason (it goes to the audit log AND the "Account
      // Deleted" email) and the tenant name typed back.
      if (!trimmedReason || deleteNameConfirm.trim() !== tenant.name) return;
    }
    updateStatusMutation.mutate(
      { id: tenant.id, status: statusAction, reason: trimmedReason || undefined },
      {
        // Failure: hook-level onError toasts; the modal stays open so the
        // operator can retry without re-typing the reason.
        onSuccess: () => {
          setStatusAction(null);
          toast.success(t('tenantDetail.statusUpdated'));
        },
      },
    );
  };

  const activeSubscription = tenant.subscriptions?.find(
    (sub: { status: string }) => sub.status === 'ACTIVE' || sub.status === 'TRIALING',
  );

  // Plan-change modal offers only assignable plans: the internal DEMO plan
  // (its name keys the demo money-path guard; the backend refuses assigning
  // it) and retired isActive:false plans are excluded.
  const selectablePlans = (plans ?? []).filter(
    (plan) => !isDemoPlan(plan) && plan.isActive !== false,
  );

  // F3 preview: the subscription keeps its billing cycle across a SA plan
  // change, so the resulting amount is the NEW plan's price for the CURRENT
  // cycle (discount-window aware — mirrors backend resolvePlanAmount, which
  // recomputes the authoritative value on apply).
  const billingCycle: string = activeSubscription?.billingCycle || 'MONTHLY';
  const selectedPlan = selectablePlans.find((plan) => plan.id === selectedPlanId);
  const newAmountPreview =
    selectedPlan && selectedPlan.id !== tenant.currentPlan?.id
      ? resolvePlanAmountForCycle(selectedPlan, billingCycle)
      : null;

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
      const next: FeatureOverrideState = cycleFeatureOverrideState(current);
      return { ...prev, [key]: next };
    });
    setHasOverrideChanges(true);
  };

  const handleLimitChange = (key: string, value: string) => {
    setLimitValues((prev) => ({ ...prev, [key]: value }));
    setHasOverrideChanges(true);
  };

  const handleSaveOverrides = () => {
    const featureOverrides = buildFeatureOverridesPayload(featureStates);
    const limitOverrides = buildLimitOverridesPayload(limitValues);

    updateOverridesMutation.mutate(
      { tenantId: tenant.id, data: { featureOverrides, limitOverrides } },
      {
        onSuccess: () => setHasOverrideChanges(false),
        // F7: on failure re-sync the form from the last-known SERVER state so
        // the "Effective" column shows persisted truth instead of the unsaved
        // local edits (the hook also invalidates the overrides query and
        // toasts the error). Without this, a failed save still rendered ✓ for
        // features that were never granted.
        onError: () => {
          if (overridesData) {
            setFeatureStates(initFeatureStates(Object.keys(FEATURE_LABELS), overridesData));
            setLimitValues(initLimitValues(Object.keys(LIMIT_LABELS), overridesData));
          }
          setHasOverrideChanges(false);
        },
      }
    );
  };

  const handleResetOverrides = () => {
    if (!window.confirm(t('tenantDetail.confirmResetOverrides'))) return;
    resetOverridesMutation.mutate(tenant.id, {
      onSuccess: () => setHasOverrideChanges(false),
    });
  };

  const getEffectiveFeature = (key: string): boolean =>
    resolveEffectiveFeature(key, featureStates, overridesData);

  const getEffectiveLimit = (key: string): number =>
    resolveEffectiveLimit(key, limitValues, overridesData);

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
          <h3 className="text-sm font-medium text-zinc-900 mb-4">{t('tenantDetail.overview')}</h3>
          <dl className="space-y-3">
            <div className="flex justify-between items-center">
              <dt className="text-sm text-zinc-500">{t('tenantDetail.plan')}</dt>
              <dd className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-900">
                  {tenant.currentPlan?.displayName || '—'}
                </span>
                {activeSubscription && (
                  <button
                    onClick={openPlanModal}
                    className="p-1 rounded hover:bg-zinc-100 transition-colors"
                    title={t('tenantDetail.changePlanTitle')}
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                  </button>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">{t('tenantDetail.currency')}</dt>
              <dd className="text-sm text-zinc-900">{tenant.currency}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">{t('tenantDetail.created')}</dt>
              <dd className="text-sm text-zinc-900">
                {new Date(tenant.createdAt).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </div>

        {/* Statistics */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900 mb-4">{t('tenantDetail.statistics')}</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">{t('tenantDetail.totalRevenue')}</dt>
              <dd className="text-sm font-medium text-zinc-900">
                ₺{(stats?.revenue.total || 0).toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">{t('tenantDetail.ordersToday')}</dt>
              <dd className="text-sm text-zinc-900">{stats?.orders.today || 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">{t('tenantDetail.ordersThisMonth')}</dt>
              <dd className="text-sm text-zinc-900">{stats?.orders.thisMonth || 0}</dd>
            </div>
          </dl>
        </div>

        {/* Resources */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900 mb-4">{t('tenantDetail.resources')}</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">{t('tenantDetail.users')}</dt>
              <dd className="text-sm text-zinc-900">{tenant._count.users}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">{t('tenantDetail.products')}</dt>
              <dd className="text-sm text-zinc-900">{tenant._count.products}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">{t('tenantDetail.tables')}</dt>
              <dd className="text-sm text-zinc-900">{tenant._count.tables}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-zinc-500">{t('tenantDetail.customers')}</dt>
              <dd className="text-sm text-zinc-900">{tenant._count.customers}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Subscription Info */}
      {activeSubscription && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-medium text-zinc-900 mb-4">{t('tenantDetail.activeSubscription')}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-zinc-500">{t('tenantDetail.plan')}</p>
              <p className="text-sm font-medium text-zinc-900 mt-0.5">{activeSubscription.plan?.displayName}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">{t('tenantDetail.status')}</p>
              <p className="text-sm font-medium text-zinc-900 mt-0.5">{activeSubscription.status}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">{t('tenantDetail.billingCycle')}</p>
              <p className="text-sm font-medium text-zinc-900 mt-0.5">{activeSubscription.billingCycle}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">{t('tenantDetail.periodEnd')}</p>
              <p className="text-sm font-medium text-zinc-900 mt-0.5">
                {new Date(activeSubscription.currentPeriodEnd).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5">
        <h3 className="text-sm font-medium text-zinc-900 mb-4">{t('tenantDetail.actions')}</h3>
        <div className="flex flex-wrap gap-3">
          {activeSubscription && (
            <button
              onClick={openPlanModal}
              className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              {t('tenantDetail.changePlan')}
            </button>
          )}
          {tenant.status === 'ACTIVE' && (
            <button
              onClick={() => openStatusModal('SUSPENDED')}
              disabled={updateStatusMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('tenantDetail.suspend')}
            </button>
          )}
          {/* F6: DELETED tenants get an Activate action too — the backend
              status flip is reversible (DELETED → ACTIVE re-rotates sessions
              and the parked subdomain is stamped with this tenant's id so it
              can be reclaimed). Previously the UI was a one-way door. */}
          {(tenant.status === 'SUSPENDED' || tenant.status === 'DELETED') && (
            <button
              onClick={handleActivate}
              disabled={updateStatusMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('tenantDetail.activate')}
            </button>
          )}
          {tenant.status !== 'DELETED' && (
            <button
              onClick={() => openStatusModal('DELETED')}
              disabled={updateStatusMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('tenantDetail.delete')}
            </button>
          )}
        </div>
      </div>

      {/* Feature & Limit Overrides */}
      {overridesData && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <h3 className="text-sm font-medium text-zinc-900">{t('tenantDetail.overridesTitle')}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{t('tenantDetail.overridesSubtitle')}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleResetOverrides}
                disabled={resetOverridesMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg hover:bg-zinc-100 disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('tenantDetail.resetAll')}
              </button>
              <button
                onClick={handleSaveOverrides}
                disabled={!hasOverrideChanges || updateOverridesMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {updateOverridesMutation.isPending ? t('tenantDetail.saving') : t('tenantDetail.save')}
              </button>
            </div>
          </div>

          {/* Feature Overrides */}
          <div className="mb-6">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">{t('tenantDetail.features')}</h4>
            <div className="border border-zinc-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200">
                    <th className="text-left text-xs font-medium text-zinc-500 px-4 py-2">{t('tenantDetail.col.feature')}</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">{t('tenantDetail.col.planDefault')}</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">{t('tenantDetail.col.override')}</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">{t('tenantDetail.col.effective')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {Object.keys(FEATURE_LABELS).map((key) => {
                    const planDefault = overridesData.planDefaults?.features?.[key] ?? false;
                    const state = featureStates[key] || 'default';
                    const effective = getEffectiveFeature(key);

                    return (
                      <tr key={key}>
                        <td className="px-4 py-2.5 text-sm text-zinc-900">{t(`tenantDetail.featureLabels.${key}`, FEATURE_LABELS[key])}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                            planDefault
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-zinc-100 text-zinc-500'
                          }`}>
                            {planDefault ? t('tenantDetail.on') : t('tenantDetail.off')}
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
                            {state === 'default' ? t('tenantDetail.default') : state === 'on' ? t('tenantDetail.forceOn') : t('tenantDetail.forceOff')}
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
          </div>

          {/* Limit Overrides */}
          <div>
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">{t('tenantDetail.limits')}</h4>
            <div className="border border-zinc-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200">
                    <th className="text-left text-xs font-medium text-zinc-500 px-4 py-2">{t('tenantDetail.col.limit')}</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">{t('tenantDetail.col.planDefault')}</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">{t('tenantDetail.col.override')}</th>
                    <th className="text-center text-xs font-medium text-zinc-500 px-4 py-2">{t('tenantDetail.col.effective')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {Object.keys(LIMIT_LABELS).map((key) => {
                    const planDefault = overridesData.planDefaults?.limits?.[key] ?? 0;
                    const effective = getEffectiveLimit(key);

                    return (
                      <tr key={key}>
                        <td className="px-4 py-2.5 text-sm text-zinc-900">{t(`tenantDetail.limitLabels.${key}`, LIMIT_LABELS[key])}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-sm text-zinc-600">
                            {planDefault === -1 ? t('tenantDetail.unlimited') : planDefault}
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
                            {effective === -1 ? t('tenantDetail.unlimited') : effective}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
            <p className="text-xs text-zinc-400 mt-2">{t('tenantDetail.limitsHint')}</p>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100">
          <h3 className="text-sm font-medium text-zinc-900">{t('tenantDetail.users')}</h3>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('tenantDetail.usersTable.name')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('tenantDetail.usersTable.email')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('tenantDetail.usersTable.role')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('tenantDetail.usersTable.status')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {users?.data.map((user: {
              id: string;
              firstName: string;
              lastName: string;
              email: string;
              role: string;
              status: string;
            }) => (
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
      </div>

      {/* Plan Change Modal */}
      <Modal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        title={t('tenantDetail.changePlan')}
        size="md"
      >
              <p className="text-sm text-zinc-500 mb-4">
                {t('tenantDetail.selectNewPlan')} <span className="font-medium text-zinc-900">{tenant.name}</span>
              </p>

              <div className="space-y-2 mb-6">
                {selectablePlans.map((plan) => (
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
                          {t('tenantDetail.usersTablesProducts', { users: plan.maxUsers, tables: plan.maxTables, products: plan.maxProducts })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-zinc-900">
                        ₺{Number(plan.monthlyPrice).toLocaleString()}{t('plans.perMonth')}
                      </p>
                      {plan.id === tenant.currentPlan?.id && (
                        <span className="text-xs text-zinc-500">{t('tenantDetail.current')}</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>

              {/* F3: show the resulting billing amount so the operator sees
                  the price the subscription row will carry after the change. */}
              {newAmountPreview !== null && (
                <div className="mb-4 p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                  <p className="text-sm text-zinc-700">
                    {t('tenantDetail.newAmountInfo', {
                      amount: `₺${newAmountPreview.toLocaleString()}`,
                      cycle: t(`tenantDetail.cycle.${billingCycle}`, billingCycle),
                    })}
                  </p>
                </div>
              )}

              {changePlanMutation.isError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-sm text-red-600">
                    {getApiErrorMessage(changePlanMutation.error, t('tenantDetail.changePlanError'))}
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowPlanModal(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
                >
                  {t('tenantDetail.cancel')}
                </button>
                <button
                  onClick={handleChangePlan}
                  disabled={!selectedPlanId || selectedPlanId === tenant.currentPlan?.id || changePlanMutation.isPending}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {changePlanMutation.isPending ? t('tenantDetail.changing') : t('tenantDetail.changePlan')}
                </button>
              </div>
      </Modal>

      {/* F6: Suspend / Delete destructive-confirm modal. States consequences,
          collects the DTO's `reason` (required + type-the-name for DELETE). */}
      <Modal
        isOpen={statusAction !== null}
        onClose={closeStatusModal}
        title={
          statusAction === 'DELETED'
            ? t('tenantDetail.deleteModal.title')
            : t('tenantDetail.suspendModal.title')
        }
        size="md"
      >
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 mb-4 ${
            statusAction === 'DELETED'
              ? 'border-red-200 bg-red-50'
              : 'border-amber-200 bg-amber-50'
          }`}
        >
          <AlertTriangle
            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
              statusAction === 'DELETED' ? 'text-red-600' : 'text-amber-600'
            }`}
          />
          <div
            className={`text-sm ${
              statusAction === 'DELETED' ? 'text-red-800' : 'text-amber-800'
            }`}
          >
            {statusAction === 'DELETED' ? (
              <>
                <p className="font-medium mb-1">
                  {t('tenantDetail.deleteModal.intro', { name: tenant.name })}
                </p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>{t('tenantDetail.deleteModal.consequenceSessions')}</li>
                  <li>{t('tenantDetail.deleteModal.consequenceSubdomain')}</li>
                  <li>{t('tenantDetail.deleteModal.consequenceEmail')}</li>
                </ul>
                <p className="mt-1.5">{t('tenantDetail.deleteModal.reversibleNote')}</p>
              </>
            ) : (
              <p>{t('tenantDetail.suspendModal.intro', { name: tenant.name })}</p>
            )}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">
            {statusAction === 'DELETED'
              ? t('tenantDetail.statusModal.reasonRequired')
              : t('tenantDetail.statusModal.reasonOptional')}
          </label>
          <textarea
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            rows={2}
            placeholder={t('tenantDetail.statusModal.reasonPlaceholder')}
            className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        {statusAction === 'DELETED' && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              {t('tenantDetail.deleteModal.typeNameLabel', { name: tenant.name })}
            </label>
            <input
              type="text"
              value={deleteNameConfirm}
              onChange={(e) => setDeleteNameConfirm(e.target.value)}
              placeholder={tenant.name}
              className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent"
            />
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={closeStatusModal}
            disabled={updateStatusMutation.isPending}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('tenantDetail.cancel')}
          </button>
          <button
            onClick={confirmStatusAction}
            disabled={
              updateStatusMutation.isPending ||
              (statusAction === 'DELETED' &&
                (!statusReason.trim() || deleteNameConfirm.trim() !== tenant.name))
            }
            className={`flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
              statusAction === 'DELETED'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {updateStatusMutation.isPending
              ? t('tenantDetail.saving')
              : statusAction === 'DELETED'
                ? t('tenantDetail.deleteModal.confirm')
                : t('tenantDetail.suspendModal.confirm')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
