import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CreditCard, Plus, Trash2, ShieldCheck, FlaskConical, Power, AlertTriangle } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Input from '../../components/ui/Input';
import FormSelect from '../../components/ui/FormSelect';
import Spinner from '../../components/ui/Spinner';
import { SettingsSection } from '../../components/settings/SettingsSection';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
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

// Friendly brand/protocol labels (these are universal hardware names, not
// translated). Falls back to the raw provider id for anything unmapped.
const PROVIDER_LABELS: Record<string, string> = {
  simulator: 'Simulator',
  gmp3_card: 'GMP-3 Yazarkasa-POS',
  bank_ecr: 'Bank POS (ECR)',
  softpos: 'SoftPOS / PSP',
};
const providerLabel = (id: string) => PROVIDER_LABELS[id] ?? id;

const PaymentTerminalsSettingsPage = () => {
  const { t } = useTranslation('settings');
  const formatPrice = useFormatCurrency();
  const { data: providers } = useTerminalProviders();
  const { data: terminals, isLoading } = useTerminals();
  const register = useRegisterTerminal();
  const setActivation = useSetTerminalActivation();
  const remove = useRemoveTerminal();
  const { data: reconciliation } = useTerminalReconciliation();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState({ providerId: '', serial: '', model: '', deviceId: '' });

  const selectedProvider = providers?.find((p) => p.id === form.providerId);
  const canSubmit = !!form.providerId && !!form.serial.trim();

  const submitRegister = async () => {
    if (!canSubmit) return;
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

  /** The activation control(s) for one terminal, by provider/state. */
  const renderActions = (rec: TerminalRecord) => {
    if (rec.providerId === 'simulator') {
      return rec.activationState === 'SIMULATOR' ? (
        <Button size="sm" variant="secondary" onClick={() => changeState(rec, 'DISABLED')}>
          <Power className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t('paymentTerminals.deactivate')}
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => changeState(rec, 'SIMULATOR')}>
          <FlaskConical className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t('paymentTerminals.enableSimulator')}
        </Button>
      );
    }
    return rec.activationState === 'ACTIVE' ? (
      <Button size="sm" variant="secondary" onClick={() => changeState(rec, 'DISABLED')}>
        <Power className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {t('paymentTerminals.deactivate')}
      </Button>
    ) : (
      <Button size="sm" variant="success" onClick={() => changeState(rec, 'ACTIVE')}>
        <Power className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {t('paymentTerminals.activate')}
      </Button>
    );
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-heading font-bold text-slate-900">
            {t('paymentTerminals.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t('paymentTerminals.description')}</p>
        </div>
        <Button onClick={() => setIsFormOpen(true)} className="flex-shrink-0">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t('paymentTerminals.register')}
        </Button>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Honest fail-closed note */}
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" aria-hidden="true" />
          <span>{t('paymentTerminals.gateNote')}</span>
        </div>

        {/* Terminals */}
        <SettingsSection
          title={t('paymentTerminals.sectionTitle')}
          description={t('paymentTerminals.sectionDescription')}
          icon={<CreditCard className="h-4 w-4" />}
        >
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : !terminals || terminals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="rounded-full bg-slate-100 p-3 text-slate-400">
                <CreditCard className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="text-sm text-slate-500">{t('paymentTerminals.empty')}</p>
              <Button size="sm" variant="secondary" onClick={() => setIsFormOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('paymentTerminals.register')}
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {terminals.map((rec) => (
                <li
                  key={rec.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{providerLabel(rec.providerId)}</span>
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
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {renderActions(rec)}
                    <button
                      onClick={() => removeTerminal(rec)}
                      aria-label={t('paymentTerminals.remove')}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        {/* Reconciliation — only when there's something to act on. */}
        {reconciliation && reconciliation.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-red-200 bg-white">
            <div className="flex items-start gap-3 border-b border-red-100 bg-red-50/60 px-5 py-4">
              <div className="flex-shrink-0 rounded-lg bg-red-100 p-2 text-red-600">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {t('paymentTerminals.reconciliation.title')}
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  {t('paymentTerminals.reconciliation.description')}
                </p>
              </div>
            </div>
            <ul className="divide-y divide-slate-100 px-5 py-2">
              {reconciliation.map((c) => (
                <li
                  key={c.chargeId}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <span className="font-medium text-slate-800">
                    #{c.orderId.slice(0, 8)} · {formatPrice(c.amount)}
                  </span>
                  <span className="flex items-center gap-2">
                    {c.approvalCode && (
                      <span className="text-xs text-slate-400">{c.approvalCode}</span>
                    )}
                    <Badge variant={c.status === 'NEEDS_REVIEW' ? 'danger' : 'warning'} size="sm">
                      {t(`paymentTerminals.reconciliation.status.${c.status}`, c.status)}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Register modal */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={t('paymentTerminals.registerTitle')}
        size="md"
      >
        <div className="space-y-4">
          <FormSelect
            label={t('paymentTerminals.provider')}
            placeholder={t('paymentTerminals.choose')}
            value={form.providerId}
            onChange={(e) => setForm((f) => ({ ...f, providerId: e.target.value }))}
            options={(providers ?? []).map((p) => ({
              value: p.id,
              label: p.fiscalCoupled
                ? `${providerLabel(p.id)} · ${t('paymentTerminals.fiscalCoupled')}`
                : providerLabel(p.id),
            }))}
          />

          <Input
            label={t('paymentTerminals.serial')}
            value={form.serial}
            onChange={(e) => setForm((f) => ({ ...f, serial: e.target.value }))}
            placeholder="OKC-00123"
          />

          <Input
            label={t('paymentTerminals.model')}
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          />

          {selectedProvider?.kind === 'bridge' && (
            <Input
              label={t('paymentTerminals.device')}
              value={form.deviceId}
              onChange={(e) => setForm((f) => ({ ...f, deviceId: e.target.value }))}
              placeholder={t('paymentTerminals.deviceHint')}
              hint={t('paymentTerminals.deviceHint')}
            />
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setIsFormOpen(false)}>
              {t('paymentTerminals.cancel')}
            </Button>
            <Button onClick={submitRegister} isLoading={register.isPending} disabled={!canSubmit}>
              {t('paymentTerminals.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PaymentTerminalsSettingsPage;
