import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Building2, Receipt, Plug } from 'lucide-react';
import { useGetAccountingSettings, useUpdateAccountingSettings, useTestAccountingConnection, useAccountingSyncStatus } from '../../features/accounting/accountingApi';
import { useAutoSave } from '../../hooks/useAutoSave';
import { SettingsSection, SettingsDivider, SettingsGroup } from '../../components/settings/SettingsSection';
import { SettingsToggle, SettingsSelect, SettingsInput } from '../../components/settings/SettingsToggle';

interface AccountingSettingsState {
  autoGenerateInvoice: boolean;
  companyName: string;
  companyTaxId: string;
  companyTaxOffice: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  provider: string;
  autoSync: boolean;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  defaultPaymentTermDays: number;
  // Parasut credentials
  parasutCompanyId: string;
  parasutClientId: string;
  parasutClientSecret: string;
  parasutUsername: string;
  parasutPassword: string;
  // Logo credentials
  logoApiUrl: string;
  logoUsername: string;
  logoPassword: string;
  logoFirmNumber: string;
  // Foriba credentials
  foribaApiUrl: string;
  foribaUsername: string;
  foribaPassword: string;
  foribaServiceType: string;
  nilveraApiUrl: string;
  nilveraApiKey: string;
}

// TR VKN = exactly 10 digits (legal entity), TCKN = 11 digits (individual).
// Mirrors the backend CreateSalesInvoiceDto customerTaxId validation.
const TAX_ID_RE = /^\d{10,11}$/;

const defaultSettings: AccountingSettingsState = {
  autoGenerateInvoice: false,
  companyName: '',
  companyTaxId: '',
  companyTaxOffice: '',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  provider: 'NONE',
  autoSync: false,
  invoicePrefix: 'INV',
  nextInvoiceNumber: 1,
  defaultPaymentTermDays: 0,
  parasutCompanyId: '',
  parasutClientId: '',
  parasutClientSecret: '',
  parasutUsername: '',
  parasutPassword: '',
  logoApiUrl: '',
  logoUsername: '',
  logoPassword: '',
  logoFirmNumber: '',
  foribaApiUrl: '',
  foribaUsername: '',
  foribaPassword: '',
  foribaServiceType: '',
  nilveraApiUrl: '',
  nilveraApiKey: '',
};

// Reusable settings body (no page chrome) so both the standalone route AND
// the Muhasebe page's "Ayarlar" tab render it.
export const AccountingSettingsPanel = () => {
  const { t } = useTranslation('settings');
  const { data: accountingSettings, isLoading } = useGetAccountingSettings();
  const { mutateAsync: updateSettings } = useUpdateAccountingSettings();
  const { mutateAsync: testConnection, isPending: isTesting } = useTestAccountingConnection();

  const [settings, setSettings] = useState<AccountingSettingsState>(defaultSettings);

  useEffect(() => {
    if (accountingSettings) {
      setSettings((prev) => ({
        ...prev,
        autoGenerateInvoice: accountingSettings.autoGenerateInvoice,
        companyName: accountingSettings.companyName || '',
        companyTaxId: accountingSettings.companyTaxId || '',
        companyTaxOffice: accountingSettings.companyTaxOffice || '',
        companyAddress: accountingSettings.companyAddress || '',
        companyPhone: accountingSettings.companyPhone || '',
        companyEmail: accountingSettings.companyEmail || '',
        provider: accountingSettings.provider || 'NONE',
        autoSync: accountingSettings.autoSync,
        invoicePrefix: accountingSettings.invoicePrefix || 'INV',
        nextInvoiceNumber: accountingSettings.nextInvoiceNumber || 1,
        defaultPaymentTermDays: accountingSettings.defaultPaymentTermDays || 0,
      }));
    }
  }, [accountingSettings]);

  const saveSettings = useCallback(
    async (newSettings: AccountingSettingsState) => {
      // Don't send empty credential fields (they would wipe stored values)
      const payload: Partial<AccountingSettingsState> = { ...newSettings };
      const credentialFields = [
        'parasutClientSecret', 'parasutPassword',
        'logoPassword', 'foribaPassword', 'nilveraApiKey',
      ] as const;
      for (const field of credentialFields) {
        if (!payload[field]) {
          delete payload[field];
        }
      }
      // Never persist a half-typed VKN/TCKN — the field autosaves per
      // keystroke, so hold it back until it's empty (clearing is fine)
      // or a valid 10/11-digit value.
      if (payload.companyTaxId && !TAX_ID_RE.test(payload.companyTaxId)) {
        delete payload.companyTaxId;
      }
      // Backend requires an integer >= 1; skip transient invalid values
      // (cleared field, 0) instead of failing the whole autosave.
      if (
        !Number.isInteger(payload.nextInvoiceNumber) ||
        (payload.nextInvoiceNumber as number) < 1
      ) {
        delete payload.nextInvoiceNumber;
      }
      await updateSettings(payload);
    },
    [updateSettings]
  );

  const {
    status: saveStatus,
    setValue: triggerSave,
    retry: retrySave,
  } = useAutoSave(settings, saveSettings, {
    debounceMs: 500,
    onSuccess: () => {
      toast.success(t('autoSave.savedSuccess'), { duration: 2000 });
    },
    onError: () => {
      toast.error(t('settingsFailed'));
    },
  });

  const handleChange = (field: keyof AccountingSettingsState, value: string | boolean | number) => {
    const newSettings = { ...settings, [field]: value };
    setSettings(newSettings);
    triggerSave(newSettings);
  };

  const handleTestConnection = async () => {
    try {
      const result = await testConnection();
      if (result.success) {
        toast.success(t('accounting.testSuccess'));
      } else {
        toast.error(t('accounting.testFailed') + (result.error ? `: ${result.error}` : ''));
      }
    } catch {
      toast.error(t('accounting.testFailed'));
    }
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center">
        <p className="text-slate-500">{t('accounting.loading')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
        {/* Company Info Section */}
        <SettingsSection
          title={t('accounting.companySection')}
          icon={<Building2 className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsInput
              label={t('accounting.companyName')}
              value={settings.companyName}
              onChange={(val) => handleChange('companyName', val)}
            />
            <SettingsDivider />
            {/* VKN/TCKN — digits only, 10 (VKN) or 11 (TCKN); inline error
                while incomplete (invalid values are held back from autosave). */}
            <div className="flex items-start justify-between gap-4 py-3 px-1">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">{t('accounting.companyTaxId')}</p>
                {settings.companyTaxId !== '' && !TAX_ID_RE.test(settings.companyTaxId) && (
                  <p className="text-xs text-red-600 mt-0.5">{t('accounting.taxIdError')}</p>
                )}
              </div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={11}
                pattern="\d{10,11}"
                value={settings.companyTaxId}
                onChange={(e) => handleChange('companyTaxId', e.target.value.replace(/\D/g, ''))}
                aria-invalid={settings.companyTaxId !== '' && !TAX_ID_RE.test(settings.companyTaxId)}
                className={`flex-shrink-0 min-w-[140px] px-3 py-1.5 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 ${
                  settings.companyTaxId !== '' && !TAX_ID_RE.test(settings.companyTaxId)
                    ? 'border-red-400'
                    : 'border-slate-300'
                }`}
              />
            </div>
            <SettingsDivider />
            <SettingsInput
              label={t('accounting.companyTaxOffice')}
              value={settings.companyTaxOffice}
              onChange={(val) => handleChange('companyTaxOffice', val)}
            />
            <SettingsDivider />
            <SettingsInput
              label={t('accounting.companyAddress')}
              value={settings.companyAddress}
              onChange={(val) => handleChange('companyAddress', val)}
            />
            <SettingsDivider />
            <SettingsInput
              label={t('accounting.companyPhone')}
              value={settings.companyPhone}
              onChange={(val) => handleChange('companyPhone', val)}
            />
            <SettingsDivider />
            <SettingsInput
              label={t('accounting.companyEmail')}
              value={settings.companyEmail}
              onChange={(val) => handleChange('companyEmail', val)}
              type="email"
            />
          </SettingsGroup>
        </SettingsSection>

        {/* Invoice Settings Section */}
        <SettingsSection
          title={t('accounting.invoiceSection')}
          icon={<Receipt className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsToggle
              label={t('accounting.autoGenerateInvoice')}
              description={t('accounting.autoGenerateInvoiceDesc')}
              checked={settings.autoGenerateInvoice}
              onChange={(checked) => handleChange('autoGenerateInvoice', checked)}
            />
            <SettingsDivider />
            <SettingsInput
              label={t('accounting.invoicePrefix')}
              value={settings.invoicePrefix}
              onChange={(val) => handleChange('invoicePrefix', val)}
            />
            <SettingsDivider />
            {/* Sıradaki fatura numarası — integer >= 1 (backend @Min(1)). */}
            <div className="flex items-start justify-between gap-4 py-3 px-1">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">{t('accounting.nextInvoiceNumber')}</p>
                <p className="text-sm text-slate-500 mt-0.5">{t('accounting.nextInvoiceNumberDesc')}</p>
                {(!Number.isInteger(settings.nextInvoiceNumber) || settings.nextInvoiceNumber < 1) && (
                  <p className="text-xs text-red-600 mt-0.5">{t('accounting.nextInvoiceNumberError')}</p>
                )}
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={settings.nextInvoiceNumber || ''}
                onChange={(e) => handleChange('nextInvoiceNumber', Math.floor(Number(e.target.value)))}
                aria-invalid={!Number.isInteger(settings.nextInvoiceNumber) || settings.nextInvoiceNumber < 1}
                className={`flex-shrink-0 min-w-[140px] px-3 py-1.5 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 ${
                  !Number.isInteger(settings.nextInvoiceNumber) || settings.nextInvoiceNumber < 1
                    ? 'border-red-400'
                    : 'border-slate-300'
                }`}
              />
            </div>
            <SettingsDivider />
            <SettingsInput
              label={t('accounting.defaultPaymentTermDays')}
              value={String(settings.defaultPaymentTermDays)}
              onChange={(val) => handleChange('defaultPaymentTermDays', Number(val) || 0)}
              type="number"
            />
          </SettingsGroup>
        </SettingsSection>

        {/* Integration Section */}
        <SettingsSection
          title={t('accounting.integrationSection')}
          icon={<Plug className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsSelect
              label={t('accounting.provider')}
              value={settings.provider}
              onChange={(val) => handleChange('provider', val)}
              options={[
                { value: 'NONE', label: t('accounting.providerNone') },
                { value: 'PARASUT', label: t('accounting.providerParasut') },
                { value: 'LOGO', label: t('accounting.providerLogo') },
                { value: 'FORIBA', label: t('accounting.providerForiba') },
                { value: 'NILVERA', label: t('accounting.providerNilvera') },
              ]}
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('accounting.autoSync')}
              description={t('accounting.autoSyncDesc')}
              checked={settings.autoSync}
              onChange={(checked) => handleChange('autoSync', checked)}
              disabled={settings.provider === 'NONE'}
            />

            {/* Parasut Credentials */}
            {settings.provider === 'PARASUT' && (
              <>
                <SettingsDivider />
                <SettingsInput
                  label={t('accounting.parasutCompanyId')}
                  value={settings.parasutCompanyId}
                  onChange={(val) => handleChange('parasutCompanyId', val)}
                />
                <SettingsDivider />
                <SettingsInput
                  label={t('accounting.parasutClientId')}
                  value={settings.parasutClientId}
                  onChange={(val) => handleChange('parasutClientId', val)}
                />
                <SettingsDivider />
                <div className="flex items-start justify-between gap-4 py-3 px-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{t('accounting.parasutClientSecret')}</p>
                  </div>
                  <input
                    type="password"
                    value={settings.parasutClientSecret}
                    onChange={(e) => handleChange('parasutClientSecret', e.target.value)}
                    className="flex-shrink-0 min-w-[140px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <SettingsDivider />
                <SettingsInput
                  label={t('accounting.parasutUsername')}
                  value={settings.parasutUsername}
                  onChange={(val) => handleChange('parasutUsername', val)}
                />
                <SettingsDivider />
                <div className="flex items-start justify-between gap-4 py-3 px-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{t('accounting.parasutPassword')}</p>
                  </div>
                  <input
                    type="password"
                    value={settings.parasutPassword}
                    onChange={(e) => handleChange('parasutPassword', e.target.value)}
                    className="flex-shrink-0 min-w-[140px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
              </>
            )}

            {/* Logo Credentials */}
            {settings.provider === 'LOGO' && (
              <>
                <SettingsDivider />
                <SettingsInput
                  label={t('accounting.logoApiUrl')}
                  value={settings.logoApiUrl}
                  onChange={(val) => handleChange('logoApiUrl', val)}
                />
                <SettingsDivider />
                <SettingsInput
                  label={t('accounting.logoUsername')}
                  value={settings.logoUsername}
                  onChange={(val) => handleChange('logoUsername', val)}
                />
                <SettingsDivider />
                <div className="flex items-start justify-between gap-4 py-3 px-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{t('accounting.logoPassword')}</p>
                  </div>
                  <input
                    type="password"
                    value={settings.logoPassword}
                    onChange={(e) => handleChange('logoPassword', e.target.value)}
                    className="flex-shrink-0 min-w-[140px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <SettingsDivider />
                <SettingsInput
                  label={t('accounting.logoFirmNumber')}
                  value={settings.logoFirmNumber}
                  onChange={(val) => handleChange('logoFirmNumber', val)}
                />
              </>
            )}

            {/* Foriba Credentials */}
            {settings.provider === 'FORIBA' && (
              <>
                <SettingsDivider />
                <SettingsInput
                  label={t('accounting.foribaApiUrl')}
                  value={settings.foribaApiUrl}
                  onChange={(val) => handleChange('foribaApiUrl', val)}
                />
                <SettingsDivider />
                <SettingsInput
                  label={t('accounting.foribaUsername')}
                  value={settings.foribaUsername}
                  onChange={(val) => handleChange('foribaUsername', val)}
                />
                <SettingsDivider />
                <div className="flex items-start justify-between gap-4 py-3 px-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{t('accounting.foribaPassword')}</p>
                  </div>
                  <input
                    type="password"
                    value={settings.foribaPassword}
                    onChange={(e) => handleChange('foribaPassword', e.target.value)}
                    className="flex-shrink-0 min-w-[140px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <SettingsDivider />
                <SettingsInput
                  label={t('accounting.foribaServiceType')}
                  value={settings.foribaServiceType}
                  onChange={(val) => handleChange('foribaServiceType', val)}
                />
              </>
            )}

            {/* Nilvera Credentials — statik API anahtarı (Persisted Access Token) */}
            {settings.provider === 'NILVERA' && (
              <>
                <SettingsDivider />
                <SettingsInput
                  label={t('accounting.nilveraApiUrl')}
                  description={t('accounting.nilveraHint')}
                  value={settings.nilveraApiUrl}
                  onChange={(val) => handleChange('nilveraApiUrl', val)}
                />
                <SettingsDivider />
                <div className="flex items-start justify-between gap-4 py-3 px-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{t('accounting.nilveraApiKey')}</p>
                  </div>
                  <input
                    type="password"
                    value={settings.nilveraApiKey}
                    onChange={(e) => handleChange('nilveraApiKey', e.target.value)}
                    className="flex-shrink-0 min-w-[140px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
              </>
            )}

            {/* Test Connection Button + live sync status */}
            {settings.provider !== 'NONE' && (
              <>
                <SettingsDivider />
                <SyncStatusCard />
                <div className="flex justify-end py-2">
                  <button
                    onClick={handleTestConnection}
                    disabled={isTesting}
                    className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isTesting ? '...' : t('accounting.testConnection')}
                  </button>
                </div>
              </>
            )}
          </SettingsGroup>
        </SettingsSection>
    </div>
  );
};

// Standalone settings page = header chrome + the shared panel.
const AccountingSettingsPage = () => {
  const { t } = useTranslation('settings');
  return (
    <div className="h-full p-4 md:p-6 overflow-auto">
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-slate-900">
          {t('accounting.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('accounting.description')}
        </p>
      </div>
      <AccountingSettingsPanel />
    </div>
  );
};

/**
 * At-a-glance e-Fatura sync status. Lets an operator verify the live rail:
 * after entering credentials and placing a test order, the synced/failed/
 * pending counts and last-sync time update here (polled) as invoices reach
 * the provider — no need to scan the full invoice list.
 */
function SyncStatusCard() {
  const { t } = useTranslation('settings');
  const { data } = useAccountingSyncStatus();
  if (!data) return null;

  const stat = (label: string, value: number, cls: string) => (
    <div className="flex flex-col items-center rounded-lg bg-slate-50 px-4 py-2">
      <span className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );

  return (
    <div className="my-2 rounded-lg border border-slate-200 p-4">
      <div className="mb-2 text-sm font-medium text-slate-700">
        {t('accounting.syncStatusCard.title')}
      </div>
      <div className="flex flex-wrap gap-3">
        {stat(t('accounting.syncStatusCard.synced'), data.synced, 'text-green-700')}
        {stat(t('accounting.syncStatusCard.failed'), data.failed, 'text-red-700')}
        {stat(t('accounting.syncStatusCard.pending'), data.pending, 'text-amber-700')}
      </div>
      {/* Invoices stuck mid-flight (SYNCING claimed, never resolved). The
          counter ships in a separate backend change — optional-chain so
          older deployments simply don't render the badge. */}
      {(data?.stuck ?? 0) > 0 && (
        <div className="mt-2">
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-800">
            {t('accounting.syncStatusCard.stuck', { n: data.stuck })}
          </span>
        </div>
      )}
      <div className="mt-2 text-xs text-slate-500">
        {t('accounting.syncStatusCard.lastSynced')}:{' '}
        {data.lastSyncedAt
          ? new Date(data.lastSyncedAt).toLocaleString()
          : t('accounting.syncStatusCard.never')}
      </div>
      <p className="mt-2 text-xs text-slate-500">{t('accounting.syncStatusCard.helper')}</p>
    </div>
  );
}

export default AccountingSettingsPage;
