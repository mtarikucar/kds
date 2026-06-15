import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type PendingBankTransfer,
  useBankTransferSettings,
  useConfirmBankTransfer,
  usePendingBankTransfers,
  useRejectBankTransfer,
  useUpdateBankTransferSettings,
} from '../../features/superadmin/api/superadminBankTransferApi';

/**
 * SuperAdmin bank-transfer (havale/EFT) console.
 *
 * Top: SETTINGS panel — the enable toggle + bank details that the tenant
 * checkout reads when offering manual transfer.
 * Bottom: PENDING list — transfers awaiting manual reconciliation. Confirm
 * activates the subscription (so it warns first); Reject opens a small
 * reason modal.
 */
export default function BankTransferPage() {
  const { t } = useTranslation('superadmin');
  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900">
          {t('bankTransfer.title', 'Havale / Banka Transferi')}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          {t(
            'bankTransfer.subtitle',
            'Havale ayarlarını yönetin ve bekleyen transferleri onaylayın.',
          )}
        </p>
      </header>

      <SettingsPanel />
      <PendingPanel />
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────

function SettingsPanel() {
  const { t } = useTranslation('superadmin');
  const { data, isLoading } = useBankTransferSettings();
  const update = useUpdateBankTransferSettings();

  const [form, setForm] = useState({
    enabled: false,
    bankName: '',
    accountHolder: '',
    iban: '',
    instructions: '',
  });

  useEffect(() => {
    if (data) {
      setForm({
        enabled: data.enabled,
        bankName: data.bankName ?? '',
        accountHolder: data.accountHolder ?? '',
        iban: data.iban ?? '',
        instructions: data.instructions ?? '',
      });
    }
  }, [data]);

  const handleSave = () => {
    update.mutate({
      enabled: form.enabled,
      bankName: form.bankName || null,
      accountHolder: form.accountHolder || null,
      iban: form.iban || null,
      instructions: form.instructions || null,
    });
  };

  return (
    <section className="bg-white rounded-xl border border-zinc-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-zinc-900">
          {t('bankTransfer.settings.title', 'Havale Ayarları')}
        </h2>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
          />
          {t('bankTransfer.settings.enabled', 'Havale ödemesi etkin')}
        </label>
      </div>

      {isLoading ? (
        <div className="text-sm text-zinc-500">{t('bankTransfer.loading', 'Yükleniyor…')}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t('bankTransfer.settings.bankName', 'Banka adı')}>
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                value={form.bankName}
                onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                placeholder="Ziraat Bankası"
              />
            </Field>
            <Field label={t('bankTransfer.settings.accountHolder', 'Hesap sahibi')}>
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                value={form.accountHolder}
                onChange={(e) => setForm((f) => ({ ...f, accountHolder: e.target.value }))}
              />
            </Field>
            <Field label={t('bankTransfer.settings.iban', 'IBAN')}>
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                value={form.iban}
                onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value.toUpperCase() }))}
                placeholder="TR00 0000 0000 0000 0000 0000 00"
              />
            </Field>
          </div>

          <Field label={t('bankTransfer.settings.instructions', 'Açıklama / talimatlar')}>
            <textarea
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              rows={3}
              value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
              placeholder={t(
                'bankTransfer.settings.instructionsPlaceholder',
                'Ödeme açıklamasına referans numarasını yazın…',
              )}
            />
          </Field>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-zinc-400">
              {data?.updatedByEmail
                ? t('bankTransfer.settings.updatedBy', {
                    defaultValue: 'Son güncelleyen: {{email}}',
                    email: data.updatedByEmail,
                  })
                : ''}
            </p>
            <button
              onClick={handleSave}
              disabled={update.isPending}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {update.isPending
                ? t('bankTransfer.settings.saving', 'Kaydediliyor…')
                : t('bankTransfer.settings.save', 'Kaydet')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ── Pending transfers ──────────────────────────────────────────────────

function PendingPanel() {
  const { t } = useTranslation('superadmin');
  const { data, isLoading } = usePendingBankTransfers();
  const confirm = useConfirmBankTransfer();
  const reject = useRejectBankTransfer();
  const [rejecting, setRejecting] = useState<PendingBankTransfer | null>(null);

  const handleConfirm = (row: PendingBankTransfer) => {
    if (
      window.confirm(
        t(
          'bankTransfer.pending.confirmWarning',
          'Bu havaleyi onaylamak aboneliği etkinleştirecek. Devam edilsin mi?',
        ),
      )
    ) {
      confirm.mutate(row.id);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium text-zinc-900">
        {t('bankTransfer.pending.title', 'Bekleyen Havaleler')}
      </h2>

      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('bankTransfer.pending.col.tenant', 'İşletme')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('bankTransfer.pending.col.plan', 'Plan')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('bankTransfer.pending.col.amount', 'Tutar')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('bankTransfer.pending.col.reference', 'Referans')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('bankTransfer.pending.col.createdAt', 'Tarih')}
              </th>
              <th className="w-40"></th>
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
            ) : !data || data.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-sm text-zinc-500">
                  {t('bankTransfer.pending.empty', 'Bekleyen havale yok.')}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-5 py-4 text-sm font-medium text-zinc-900">
                    {row.subscription.tenant.name}
                  </td>
                  <td className="px-5 py-4 text-sm text-zinc-700">
                    {row.subscription.plan.displayName}
                    <span className="ml-2 text-xs text-zinc-400">{row.subscription.billingCycle}</span>
                  </td>
                  <td className="px-5 py-4 text-sm text-zinc-900 tabular-nums">
                    {Number(row.amount).toLocaleString('tr-TR')} {row.currency}
                  </td>
                  <td className="px-5 py-4 text-xs font-mono text-zinc-600">
                    {row.externalReference || '—'}
                  </td>
                  <td className="px-5 py-4 text-sm text-zinc-500">
                    {new Date(row.createdAt).toLocaleString('tr-TR')}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => handleConfirm(row)}
                        disabled={confirm.isPending}
                        className="text-xs font-medium text-emerald-700 hover:text-emerald-800 disabled:opacity-50 transition-colors"
                      >
                        {t('bankTransfer.pending.confirm', 'Onayla')}
                      </button>
                      <button
                        onClick={() => setRejecting(row)}
                        className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
                      >
                        {t('bankTransfer.pending.reject', 'Reddet')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rejecting && (
        <RejectModal
          row={rejecting}
          isPending={reject.isPending}
          onClose={() => setRejecting(null)}
          onSubmit={async (reason) => {
            await reject.mutateAsync({ paymentId: rejecting.id, reason });
            setRejecting(null);
          }}
        />
      )}
    </section>
  );
}

interface RejectModalProps {
  row: PendingBankTransfer;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (reason: string | undefined) => Promise<void>;
}

function RejectModal({ row, isPending, onClose, onSubmit }: RejectModalProps) {
  const { t } = useTranslation('superadmin');
  const [reason, setReason] = useState('');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-semibold text-zinc-900">
          {t('bankTransfer.pending.rejectTitle', 'Havaleyi reddet')}
        </h3>
        <p className="mb-4 text-sm text-zinc-500">
          {t('bankTransfer.pending.rejectDescription', {
            defaultValue: '{{tenant}} işletmesinin havalesi reddedilecek.',
            tenant: row.subscription.tenant.name,
          })}
        </p>

        <label className="flex flex-col text-xs text-zinc-600">
          <span>{t('bankTransfer.pending.rejectReason', 'Gerekçe (opsiyonel)')}</span>
          <textarea
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            {t('bankTransfer.cancel', 'Vazgeç')}
          </button>
          <button
            onClick={() => onSubmit(reason.trim() || undefined)}
            disabled={isPending}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending
              ? t('bankTransfer.pending.rejecting', 'Reddediliyor…')
              : t('bankTransfer.pending.reject', 'Reddet')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col text-xs text-zinc-600">
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
