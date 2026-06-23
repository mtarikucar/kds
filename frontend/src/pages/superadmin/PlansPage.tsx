import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Tag, AlertTriangle } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import { usePlans, useCreatePlan, useUpdatePlan, useDeletePlan } from '../../features/superadmin/api/superAdminApi';
import { SubscriptionPlan } from '../../features/superadmin/types';
import { getApiErrorMessage } from '../../lib/api-error';
import { discountedMonthlyPrice } from './plans.helpers';

export default function PlansPage() {
  const { t } = useTranslation('superadmin');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);

  const { data: plans, isLoading } = usePlans();
  const hasNonTryActivePlan = (plans ?? []).some(
    (p: SubscriptionPlan) => p.isActive && p.currency && p.currency !== 'TRY',
  );
  const createMutation = useCreatePlan();
  const updateMutation = useUpdatePlan();
  const deleteMutation = useDeletePlan();

  const handleDelete = (id: string) => {
    if (window.confirm(t('plans.confirmDelete'))) {
      deleteMutation.mutate(id, {
        onSuccess: () => toast.success(t('plans.deleted', 'Plan silindi.')),
        onError: (err) =>
          toast.error(getApiErrorMessage(err, t('plans.deleteFailed', 'Plan silinemedi.'))),
      });
    }
  };

  const handleEdit = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setIsModalOpen(true);
  };

  const handleCreate = () => {
    setEditingPlan(null);
    setIsModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t('plans.title')}</h1>
          <p className="text-sm text-zinc-500 mt-1">{t('plans.subtitle')}</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('plans.addPlan')}
        </button>
      </div>

      {/* Non-TRY active plan warning — havale is the only payment path for these */}
      {hasNonTryActivePlan && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            {t(
              'plans.nonTryActiveBanner',
              'TRY dışı para birimine sahip en az bir aktif plan var. Bu planlar kartla (PayTR) tahsil edilemez; tenant ödeme yapabilsin diye havale ayarlarını açtığınızdan emin olun.',
            )}
          </p>
        </div>
      )}

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans?.map((plan: SubscriptionPlan) => (
          <div
            key={plan.id}
            className={`bg-white rounded-xl border border-zinc-200 p-5 ${
              !plan.isActive ? 'opacity-50' : ''
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-900">{plan.displayName}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">{plan.name}</p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleEdit(plan)}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
                >
                  <Pencil className="w-4 h-4 text-zinc-400" />
                </button>
                <button
                  onClick={() => handleDelete(plan.id)}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
            </div>

            {plan.isDiscountActive && plan.discountPercentage && (
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700 rounded-full">
                  <Tag className="w-3 h-3" />
                  %{plan.discountPercentage} {plan.discountLabel || t('plans.defaultDiscountLabel')}
                </span>
              </div>
            )}

            <div className="mb-4">
              {plan.isDiscountActive && plan.discountPercentage ? (
                <>
                  <p className="text-sm text-zinc-400 line-through">
                    ₺{Number(plan.monthlyPrice).toLocaleString()}{t('plans.perMonth')}
                  </p>
                  <p className="text-2xl font-semibold text-emerald-600">
                    ₺{discountedMonthlyPrice(plan.monthlyPrice, plan.discountPercentage).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    <span className="text-sm font-normal text-zinc-500">{t('plans.perMonth')}</span>
                  </p>
                </>
              ) : (
                <p className="text-2xl font-semibold text-zinc-900">
                  ₺{Number(plan.monthlyPrice).toLocaleString()}
                  <span className="text-sm font-normal text-zinc-500">{t('plans.perMonth')}</span>
                </p>
              )}
              <p className="text-xs text-zinc-500">
                ₺{Number(plan.yearlyPrice).toLocaleString()}{t('plans.perYear')}
              </p>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">{t('plans.users')}</span>
                <span className="text-zinc-900">{plan.maxUsers}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">{t('plans.tables')}</span>
                <span className="text-zinc-900">{plan.maxTables}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">{t('plans.products')}</span>
                <span className="text-zinc-900">{plan.maxProducts}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">{t('plans.ordersPerMonth')}</span>
                <span className="text-zinc-900">{plan.maxMonthlyOrders}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-4 border-t border-zinc-100">
              {plan.advancedReports && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  {t('plans.featureTags.reports')}
                </span>
              )}
              {plan.multiLocation && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  {t('plans.featureTags.multiLocation')}
                </span>
              )}
              {plan.customBranding && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  {t('plans.featureTags.customBranding')}
                </span>
              )}
              {plan.apiAccess && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  {t('plans.featureTags.api')}
                </span>
              )}
              {plan.prioritySupport && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  {t('plans.featureTags.priority')}
                </span>
              )}
              {plan.inventoryTracking && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  {t('plans.featureTags.inventory')}
                </span>
              )}
              {plan.kdsIntegration && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  {t('plans.featureTags.kds')}
                </span>
              )}
              {plan.reservationSystem && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  {t('plans.featureTags.reservations')}
                </span>
              )}
              {plan.personnelManagement && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  {t('plans.featureTags.personnel')}
                </span>
              )}
            </div>

            {plan.isDiscountActive && plan.discountStartDate && plan.discountEndDate && (
              <p className="text-xs text-emerald-600 mt-3">
                {new Date(plan.discountStartDate).toLocaleDateString()} - {new Date(plan.discountEndDate).toLocaleDateString()}
              </p>
            )}

            <p className="text-xs text-zinc-400 mt-1">
              {t('plans.activeSubscriptions', { count: plan._count?.subscriptions || 0 })}
            </p>
          </div>
        ))}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <PlanModal
          plan={editingPlan}
          isSaving={createMutation.isPending || updateMutation.isPending}
          onClose={() => setIsModalOpen(false)}
          onSave={(data) => {
            // Never send empty-string discount dates: an empty string is not a
            // valid ISO date, so the optional @IsDateString validators reject
            // it. Coerce blank -> undefined so the field is OMITTED from the
            // JSON body and treated as "not provided" (defence-in-depth with
            // the backend's blank->undefined coercion).
            const payload: Partial<SubscriptionPlan> = {
              ...data,
              discountStartDate: data.discountStartDate || undefined,
              discountEndDate: data.discountEndDate || undefined,
            };
            // Surface success/failure instead of optimistically closing: a
            // 400/network error used to close the modal silently, which read
            // as "the update did nothing". On error we keep the modal open so
            // the operator's input is preserved.
            const opts = {
              onSuccess: () => {
                setIsModalOpen(false);
                toast.success(t('plans.saved', 'Plan kaydedildi.'));
              },
              onError: (err: unknown) =>
                toast.error(getApiErrorMessage(err, t('plans.saveFailed', 'Plan kaydedilemedi.'))),
            };
            if (editingPlan) {
              updateMutation.mutate({ id: editingPlan.id, ...payload }, opts);
            } else {
              createMutation.mutate(payload, opts);
            }
          }}
        />
      )}
    </div>
  );
}

function PlanModal({
  plan,
  isSaving,
  onClose,
  onSave,
}: {
  plan: SubscriptionPlan | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (data: Partial<SubscriptionPlan>) => void;
}) {
  const { t } = useTranslation('superadmin');
  const [formData, setFormData] = useState({
    name: plan?.name || '',
    displayName: plan?.displayName || '',
    description: plan?.description || '',
    monthlyPrice: plan?.monthlyPrice || 0,
    yearlyPrice: plan?.yearlyPrice || 0,
    currency: 'TRY', // TRY-only platform — never carry a legacy non-TRY value forward
    // Limits are `number | ''`. Use ?? (NOT ||) so a stored 0 displays as 0
    // (visible + fixable) rather than being silently shown as the default —
    // and so -1 (unlimited) round-trips. A cleared input becomes '' (handled
    // on submit by omitting the field), never Number('') === 0 which would
    // rewrite an unlimited cap to "zero allowed" and 403 every create.
    maxUsers: (plan?.maxUsers ?? 1) as number | '',
    maxTables: (plan?.maxTables ?? 5) as number | '',
    maxBranches: (plan?.maxBranches ?? 1) as number | '',
    maxProducts: (plan?.maxProducts ?? 50) as number | '',
    maxCategories: (plan?.maxCategories ?? 10) as number | '',
    maxMonthlyOrders: (plan?.maxMonthlyOrders ?? 100) as number | '',
    advancedReports: plan?.advancedReports || false,
    multiLocation: plan?.multiLocation || false,
    customBranding: plan?.customBranding || false,
    apiAccess: plan?.apiAccess || false,
    prioritySupport: plan?.prioritySupport || false,
    inventoryTracking: plan?.inventoryTracking || false,
    kdsIntegration: plan?.kdsIntegration ?? true,
    reservationSystem: plan?.reservationSystem || false,
    personnelManagement: plan?.personnelManagement || false,
    isActive: plan?.isActive ?? true,
    discountPercentage: plan?.discountPercentage || 0,
    discountLabel: plan?.discountLabel || '',
    discountStartDate: plan?.discountStartDate ? plan.discountStartDate.slice(0, 10) : '',
    discountEndDate: plan?.discountEndDate ? plan.discountEndDate.slice(0, 10) : '',
    isDiscountActive: plan?.isDiscountActive || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    // Omit any blank limit field so it's not sent at all: the backend treats a
    // missing limit as "leave untouched" on PATCH (and applies the tier
    // default on create). Sending it would either 400 or, worse, persist a 0.
    const LIMIT_KEYS = [
      'maxUsers',
      'maxTables',
      'maxBranches',
      'maxProducts',
      'maxCategories',
      'maxMonthlyOrders',
    ] as const;
    const cleaned: Record<string, unknown> = { ...formData };
    for (const key of LIMIT_KEYS) {
      if (cleaned[key] === '') delete cleaned[key];
    }
    onSave(cleaned as Partial<SubscriptionPlan>);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={plan ? t('plans.modal.editTitle') : t('plans.modal.createTitle')}
      size="md"
    >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  {t('plans.modal.internalName')}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  {t('plans.modal.displayName')}
                </label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  {t('plans.modal.monthlyPrice')}
                </label>
                <input
                  type="number"
                  value={formData.monthlyPrice}
                  onChange={(e) => setFormData({ ...formData, monthlyPrice: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  {t('plans.modal.yearlyPrice')}
                </label>
                <input
                  type="number"
                  value={formData.yearlyPrice}
                  onChange={(e) => setFormData({ ...formData, yearlyPrice: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                {t('plans.modal.currency', 'Para birimi')}
              </label>
              {/* TRY-only: PayTR collects Turkish Lira exclusively, so plans are
                  priced in TRY. The currency is fixed (not selectable) to keep
                  the catalog consistent with what the platform can actually
                  charge. */}
              <select
                value="TRY"
                disabled
                className="w-full px-3.5 py-2.5 bg-zinc-50 border border-zinc-300 rounded-lg text-sm text-zinc-600 cursor-not-allowed focus:outline-none"
              >
                <option value="TRY">TRY (₺)</option>
              </select>
            </div>

            {/* -1 = unlimited (Sınırsız) for every cap. A blank input is kept
                blank (not coerced to 0) and omitted on save. */}
            <p className="text-xs text-zinc-500">{t('plans.modal.limitHint', '-1 = sınırsız')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">{t('plans.modal.maxUsers')}</label>
                <input
                  type="number"
                  min={-1}
                  value={formData.maxUsers}
                  onChange={(e) => setFormData({ ...formData, maxUsers: e.target.value === '' ? '' : Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">{t('plans.modal.maxTables')}</label>
                <input
                  type="number"
                  min={-1}
                  value={formData.maxTables}
                  onChange={(e) => setFormData({ ...formData, maxTables: e.target.value === '' ? '' : Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">{t('plans.modal.maxBranches')}</label>
                <input
                  type="number"
                  min={-1}
                  value={formData.maxBranches}
                  onChange={(e) => setFormData({ ...formData, maxBranches: e.target.value === '' ? '' : Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">{t('plans.modal.maxProducts')}</label>
                <input
                  type="number"
                  min={-1}
                  value={formData.maxProducts}
                  onChange={(e) => setFormData({ ...formData, maxProducts: e.target.value === '' ? '' : Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">{t('plans.modal.categories')}</label>
                <input
                  type="number"
                  min={-1}
                  value={formData.maxCategories}
                  onChange={(e) => setFormData({ ...formData, maxCategories: e.target.value === '' ? '' : Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">{t('plans.modal.ordersPerMonth')}</label>
                <input
                  type="number"
                  min={-1}
                  value={formData.maxMonthlyOrders}
                  onChange={(e) => setFormData({ ...formData, maxMonthlyOrders: e.target.value === '' ? '' : Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.advancedReports}
                  onChange={(e) => setFormData({ ...formData, advancedReports: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">{t('plans.modal.advancedReports')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.multiLocation}
                  onChange={(e) => setFormData({ ...formData, multiLocation: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">{t('plans.modal.multiLocation')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.customBranding}
                  onChange={(e) => setFormData({ ...formData, customBranding: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">{t('plans.modal.customBranding')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.apiAccess}
                  onChange={(e) => setFormData({ ...formData, apiAccess: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">{t('plans.modal.apiAccess')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.prioritySupport}
                  onChange={(e) => setFormData({ ...formData, prioritySupport: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">{t('plans.modal.prioritySupport')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.inventoryTracking}
                  onChange={(e) => setFormData({ ...formData, inventoryTracking: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">{t('plans.modal.inventoryTracking')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.kdsIntegration}
                  onChange={(e) => setFormData({ ...formData, kdsIntegration: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">{t('plans.modal.kdsIntegration')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.reservationSystem}
                  onChange={(e) => setFormData({ ...formData, reservationSystem: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">{t('plans.modal.reservations')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.personnelManagement}
                  onChange={(e) => setFormData({ ...formData, personnelManagement: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">{t('plans.modal.personnelManagement')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">{t('plans.modal.active')}</span>
              </label>
            </div>

            {/* Discount Settings */}
            <div className="pt-4 border-t border-zinc-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-900">{t('plans.modal.discountSettings')}</h3>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.isDiscountActive}
                    onChange={(e) => setFormData({ ...formData, isDiscountActive: e.target.checked })}
                    className="w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
                  />
                  <span className="text-xs text-zinc-600">{t('plans.modal.active')}</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">{t('plans.modal.discountPercent')}</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.discountPercentage}
                    onChange={(e) => setFormData({ ...formData, discountPercentage: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">{t('plans.modal.label')}</label>
                  <input
                    type="text"
                    placeholder={t('plans.modal.labelPlaceholder')}
                    value={formData.discountLabel}
                    onChange={(e) => setFormData({ ...formData, discountLabel: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">{t('plans.modal.startDate')}</label>
                  <input
                    type="date"
                    value={formData.discountStartDate}
                    onChange={(e) => setFormData({ ...formData, discountStartDate: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">{t('plans.modal.endDate')}</label>
                  <input
                    type="date"
                    value={formData.discountEndDate}
                    onChange={(e) => setFormData({ ...formData, discountEndDate: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('plans.modal.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving
                  ? t('plans.modal.saving', 'Kaydediliyor...')
                  : plan
                    ? t('plans.modal.update')
                    : t('plans.modal.create')}
              </button>
            </div>
          </form>
    </Modal>
  );
}
