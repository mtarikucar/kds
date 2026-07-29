import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import { useSubscriptions, useExtendSubscription, useCancelSubscription, usePlans } from '../../features/superadmin/api/superAdminApi';
import { SubscriptionListItem } from '../../features/superadmin/types';
import { getApiErrorMessage } from '../../lib/api-error';
import { isValidExtendDays } from './subscriptions.helpers';

const statusStyles: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  CANCELLED: 'bg-red-50 text-red-700 border-red-100',
  EXPIRED: 'bg-zinc-50 text-zinc-700 border-zinc-100',
  PAST_DUE: 'bg-amber-50 text-amber-700 border-amber-100',
  TRIALING: 'bg-blue-50 text-blue-700 border-blue-100',
};

export default function SubscriptionsPage() {
  const { t } = useTranslation('superadmin');
  const [status, setStatus] = useState('');
  const [planId, setPlanId] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useSubscriptions({
    status: status || undefined,
    planId: planId || undefined,
    page,
    limit: 20,
  });
  const { data: plans } = usePlans();
  const extendMutation = useExtendSubscription();
  const cancelMutation = useCancelSubscription();

  // deep-review FM11: mutate() carries the id, so isPending alone can't tell
  // WHICH row is busy — track the active id to disable that row's buttons.
  const pendingId = extendMutation.isPending
    ? extendMutation.variables?.id
    : cancelMutation.isPending
      ? cancelMutation.variables?.id
      : undefined;

  // F8: prompts replaced by small modals so the operator sees WHAT the action
  // does before committing — Extend on a non-ACTIVE row REINSTATES the
  // subscription (status → ACTIVE, tenant unlocked), and Cancel supports the
  // DTO's AT_PERIOD_END (default) vs IMMEDIATE modes. Both collect a reason
  // for the audit trail.
  const [extendTarget, setExtendTarget] = useState<SubscriptionListItem | null>(null);
  const [extendDays, setExtendDays] = useState('30');
  const [extendReason, setExtendReason] = useState('');
  const [cancelTarget, setCancelTarget] = useState<SubscriptionListItem | null>(null);
  const [cancelMode, setCancelMode] = useState<'AT_PERIOD_END' | 'IMMEDIATE'>('AT_PERIOD_END');
  const [cancelReason, setCancelReason] = useState('');

  const anyPending = extendMutation.isPending || cancelMutation.isPending;

  const openExtend = (sub: SubscriptionListItem) => {
    // deep-review FM11: never open a second submit surface while a mutation is
    // in flight — the +N-days extend is non-idempotent, so a double-submit
    // would drift the billing period.
    if (anyPending) return;
    setExtendDays('30');
    setExtendReason('');
    setExtendTarget(sub);
  };

  const submitExtend = () => {
    if (!extendTarget || anyPending || !isValidExtendDays(extendDays)) return;
    extendMutation.mutate(
      { id: extendTarget.id, days: Number(extendDays), reason: extendReason.trim() || undefined },
      {
        // deep-review FM11: surface success/failure — previously a failed
        // extend gave no feedback and the operator assumed it worked.
        onSuccess: () => {
          setExtendTarget(null);
          toast.success(t('subscriptions.extendSuccess', 'Abonelik uzatıldı.'));
        },
        onError: (err) => toast.error(getApiErrorMessage(err, t('subscriptions.extendFailed', 'Abonelik uzatılamadı.'))),
      },
    );
  };

  const openCancel = (sub: SubscriptionListItem) => {
    // deep-review FM11: short-circuit so a second click can't fire two cancels.
    if (anyPending) return;
    setCancelMode('AT_PERIOD_END');
    setCancelReason('');
    setCancelTarget(sub);
  };

  const submitCancel = () => {
    if (!cancelTarget || anyPending) return;
    cancelMutation.mutate(
      { id: cancelTarget.id, mode: cancelMode, reason: cancelReason.trim() || undefined },
      {
        onSuccess: () => {
          setCancelTarget(null);
          toast.success(t('subscriptions.cancelSuccess', 'Abonelik iptal edildi.'));
        },
        onError: (err) => toast.error(getApiErrorMessage(err, t('subscriptions.cancelFailed', 'Abonelik iptal edilemedi.'))),
      },
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{t('subscriptions.title')}</h1>
        <p className="text-sm text-zinc-500 mt-1">{t('subscriptions.subtitle')}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        >
          <option value="">{t('subscriptions.filters.allStatus')}</option>
          <option value="ACTIVE">{t('subscriptions.filters.active')}</option>
          <option value="CANCELLED">{t('subscriptions.filters.cancelled')}</option>
          <option value="EXPIRED">{t('subscriptions.filters.expired')}</option>
          <option value="PAST_DUE">{t('subscriptions.filters.pastDue')}</option>
          <option value="TRIALING">{t('subscriptions.filters.trialing')}</option>
        </select>

        <select
          value={planId}
          onChange={(e) => {
            setPlanId(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        >
          <option value="">{t('subscriptions.filters.allPlans')}</option>
          {plans?.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[680px]">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('subscriptions.col.tenant')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('subscriptions.col.plan')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('subscriptions.col.status')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('subscriptions.col.billing')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('subscriptions.col.ends')}
              </th>
              <th className="w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center">
                  <div className="flex justify-center">
                    <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
                  </div>
                </td>
              </tr>
            ) : (
              data?.data.map((sub: SubscriptionListItem) => (
                <tr key={sub.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-5 py-4">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{sub.tenant.name}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{sub.tenant.subdomain}</p>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-zinc-700">{sub.plan.displayName}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${
                        statusStyles[sub.status] || statusStyles.ACTIVE
                      }`}
                    >
                      {sub.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm text-zinc-900">₺{Number(sub.amount).toLocaleString()}</p>
                    <p className="text-xs text-zinc-500">{sub.billingCycle}</p>
                  </td>
                  <td className="px-5 py-4 text-sm text-zinc-500">
                    {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openExtend(sub)}
                        disabled={pendingId === sub.id}
                        className="text-xs font-medium text-zinc-600 hover:text-zinc-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('subscriptions.extend')}
                      </button>
                      {sub.status === 'ACTIVE' && (
                        <button
                          onClick={() => openCancel(sub)}
                          disabled={pendingId === sub.id}
                          className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t('subscriptions.cancel')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>

        {/* Pagination */}
        {data && data.meta.totalPages > 1 && (
          <div className="px-5 py-4 border-t border-zinc-100 flex items-center justify-between">
            <span className="text-sm text-zinc-500">
              {t('common.pageOf', { page: data.meta.page, totalPages: data.meta.totalPages })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={data.meta.page === 1}
                className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.previous')}
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={data.meta.page === data.meta.totalPages}
                className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.next')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* F8: Extend modal — days + reason; warns when the row is not ACTIVE
          because extending REINSTATES the subscription. */}
      <Modal
        isOpen={extendTarget !== null}
        onClose={() => !anyPending && setExtendTarget(null)}
        title={t('subscriptions.extendModal.title')}
        size="sm"
      >
        {extendTarget && (
          <>
            <p className="text-sm text-zinc-500 mb-4">
              {t('subscriptions.extendModal.subtitle', { tenant: extendTarget.tenant.name })}
            </p>
            {extendTarget.status !== 'ACTIVE' && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <p className="text-sm text-amber-800">
                  {t('subscriptions.extendModal.reinstateWarning', { status: extendTarget.status })}
                </p>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                {t('subscriptions.extendModal.days')}
              </label>
              <input
                type="number"
                min={1}
                value={extendDays}
                onChange={(e) => setExtendDays(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                {t('subscriptions.extendModal.reason')}
              </label>
              <input
                type="text"
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setExtendTarget(null)}
                disabled={anyPending}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('subscriptions.extendModal.back')}
              </button>
              <button
                onClick={submitExtend}
                disabled={anyPending || !isValidExtendDays(extendDays) || Number(extendDays) < 1}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {extendMutation.isPending
                  ? t('subscriptions.extendModal.extending')
                  : t('subscriptions.extendModal.confirm')}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* F8: Cancel modal — AT_PERIOD_END (default) vs IMMEDIATE + reason. */}
      <Modal
        isOpen={cancelTarget !== null}
        onClose={() => !anyPending && setCancelTarget(null)}
        title={t('subscriptions.cancelModal.title')}
        size="sm"
      >
        {cancelTarget && (
          <>
            <p className="text-sm text-zinc-500 mb-4">
              {t('subscriptions.cancelModal.subtitle', { tenant: cancelTarget.tenant.name })}
            </p>
            <div className="space-y-2 mb-4">
              {(['AT_PERIOD_END', 'IMMEDIATE'] as const).map((mode) => (
                <label
                  key={mode}
                  className={`flex items-start gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${
                    cancelMode === mode ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 hover:border-zinc-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="cancelMode"
                    value={mode}
                    checked={cancelMode === mode}
                    onChange={() => setCancelMode(mode)}
                    className="mt-0.5 w-4 h-4 text-zinc-900 border-zinc-300 focus:ring-zinc-900"
                  />
                  <span className="text-sm text-zinc-700">
                    {mode === 'AT_PERIOD_END'
                      ? t('subscriptions.cancelModal.atPeriodEnd')
                      : t('subscriptions.cancelModal.immediate')}
                  </span>
                </label>
              ))}
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                {t('subscriptions.cancelModal.reason')}
              </label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                disabled={anyPending}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('subscriptions.cancelModal.keep')}
              </button>
              <button
                onClick={submitCancel}
                disabled={anyPending}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {cancelMutation.isPending
                  ? t('subscriptions.cancelModal.cancelling')
                  : t('subscriptions.cancelModal.confirm')}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
