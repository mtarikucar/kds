import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CreditCard, Plus, Trash2, ShieldCheck, FlaskConical, Power, AlertTriangle } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { getApiErrorMessage } from '../../lib/api-error';
import {
  useTerminalProviders,
  useTerminals,
  useRegisterTerminal,
  useSetTerminalActivation,
  useRemoveTerminal,
  useTerminalReconciliation,
  type TerminalActivationState,
  type TerminalRecord,
} from '../../features/payment-terminal/paymentTerminalApi';

const STATE_VARIANT: Record<TerminalActivationState, 'default' | 'success' | 'warning' | 'info'> = {
  ACTIVE: 'success',
  SIMULATOR: 'info',
  CONFIGURED_NOT_ACTIVE: 'warning',
  DISABLED: 'default',
};

const PaymentTerminalsSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: providers } = useTerminalProviders();
  const { data: terminals, isLoading } = useTerminals();
  const register = useRegisterTerminal();
  const setActivation = useSetTerminalActivation();
  const remove = useRemoveTerminal();
  const { data: reconciliation } = useTerminalReconciliation();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState({ providerId: '', serial: '', model: '', deviceId: '' });

  const selectedProvider = providers?.find((p) => p.id === form.providerId);

  const submitRegister = async () => {
    if (!form.providerId || !form.serial.trim()) return;
    try {
      await register.mutateAsync({
        providerId: form.providerId,
        serial: form.serial.trim(),
        model: form.model.trim() || undefined,
        deviceId: form.deviceId.trim() || undefined,
      });
      toast.success(t('paymentTerminals.registered'));
      setIsFormOpen(false);
      setForm({ providerId: '', serial: '', model: '', deviceId: '' });
    } catch (e) {
      toast.error(getApiErrorMessage(e, t('paymentTerminals.registerFailed')));
    }
  };

  const changeState = async (rec: TerminalRecord, activationState: TerminalActivationState) => {
    try {
      await setActivation.mutateAsync({ id: rec.id, activationState });
      toast.success(t('paymentTerminals.stateChanged'));
    } catch (e) {
      toast.error(getApiErrorMessage(e, t('paymentTerminals.stateFailed')));
    }
  };

  const removeTerminal = async (rec: TerminalRecord) => {
    if (!window.confirm(t('paymentTerminals.removeConfirm'))) return;
    try {
      await remove.mutateAsync(rec.id);
      toast.success(t('paymentTerminals.removed'));
    } catch (e) {
      toast.error(getApiErrorMessage(e, t('paymentTerminals.stateFailed')));
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-heading font-semibold text-slate-900">
            <CreditCard className="h-5 w-5 text-primary-500" aria-hidden="true" />
            {t('paymentTerminals.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t('paymentTerminals.description')}</p>
        </div>
        <Button onClick={() => setIsFormOpen(true)} className="flex-shrink-0">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t('paymentTerminals.register')}
        </Button>
      </div>

      {/* Honest fail-closed note */}
      <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span>{t('paymentTerminals.gateNote')}</span>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !terminals || terminals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          {t('paymentTerminals.empty')}
        </div>
      ) : (
        <ul className="space-y-3">
          {terminals.map((rec) => (
            <li
              key={rec.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{rec.providerId}</span>
                    <Badge variant={STATE_VARIANT[rec.activationState]} size="sm">
                      {t(`paymentTerminals.state.${rec.activationState}`)}
                    </Badge>
                    {rec.fiscalCoupled && (
                      <Badge variant="primary" size="sm">
                        {t('paymentTerminals.fiscalCoupled')}
                      </Badge>
                    )}
                    {!rec.providerRegistered && (
                      <Badge variant="danger" size="sm">
                        {t('paymentTerminals.providerMissing')}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 truncate text-sm text-slate-500">
                    {t('paymentTerminals.serial')}: {rec.serial}
                    {rec.model ? ` · ${rec.model}` : ''}
                    {rec.deviceId ? ` · ${t('paymentTerminals.device')}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {rec.providerId === 'simulator' ? (
                    rec.activationState === 'SIMULATOR' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => changeState(rec, 'DISABLED')}
                      >
                        <Power className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        {t('paymentTerminals.deactivate')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => changeState(rec, 'SIMULATOR')}
                      >
                        <FlaskConical className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        {t('paymentTerminals.enableSimulator')}
                      </Button>
                    )
                  ) : rec.activationState === 'ACTIVE' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => changeState(rec, 'DISABLED')}
                    >
                      <Power className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      {t('paymentTerminals.deactivate')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => changeState(rec, 'ACTIVE')}
                    >
                      <Power className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      {t('paymentTerminals.activate')}
                    </Button>
                  )}
                  <button
                    onClick={() => removeTerminal(rec)}
                    aria-label={t('paymentTerminals.remove')}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Reconciliation — charges that took money but couldn't be recorded.
          Only shown when there's something to act on. */}
      {reconciliation && reconciliation.length > 0 && (
        <div className="mt-8">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-red-700">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {t('paymentTerminals.reconciliation.title')}
          </h3>
          <p className="mt-1 mb-3 text-xs text-slate-500">
            {t('paymentTerminals.reconciliation.description')}
          </p>
          <ul className="space-y-2">
            {reconciliation.map((c) => (
              <li
                key={c.chargeId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm"
              >
                <span className="font-medium text-slate-800">
                  #{c.orderId.slice(0, 8)} · {c.amount}
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={c.status === 'NEEDS_REVIEW' ? 'danger' : 'warning'} size="sm">
                    {t(`paymentTerminals.reconciliation.status.${c.status}`, c.status)}
                  </Badge>
                  {c.approvalCode && <span className="text-xs text-slate-500">{c.approvalCode}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={t('paymentTerminals.registerTitle')}
        size="md"
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {t('paymentTerminals.provider')}
            </span>
            <select
              value={form.providerId}
              onChange={(e) => setForm((f) => ({ ...f, providerId: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              <option value="">{t('paymentTerminals.choose')}</option>
              {providers?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                  {p.fiscalCoupled ? ` · ${t('paymentTerminals.fiscalCoupled')}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {t('paymentTerminals.serial')}
            </span>
            <input
              value={form.serial}
              onChange={(e) => setForm((f) => ({ ...f, serial: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              placeholder="OKC-00123"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {t('paymentTerminals.model')}
            </span>
            <input
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </label>

          {selectedProvider?.kind === 'bridge' && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                {t('paymentTerminals.device')}
              </span>
              <input
                value={form.deviceId}
                onChange={(e) => setForm((f) => ({ ...f, deviceId: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                placeholder={t('paymentTerminals.deviceHint')}
              />
              <span className="mt-1 block text-xs text-slate-400">
                {t('paymentTerminals.deviceHint')}
              </span>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setIsFormOpen(false)}>
              {t('paymentTerminals.cancel')}
            </Button>
            <Button
              onClick={submitRegister}
              isLoading={register.isPending}
              disabled={!form.providerId || !form.serial.trim()}
            >
              {t('paymentTerminals.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PaymentTerminalsSettingsPage;
