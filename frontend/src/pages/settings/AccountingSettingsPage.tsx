import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Building2, Receipt, Plug } from 'lucide-react';
import { useGetAccountingSettings, useUpdateAccountingSettings, useTestAccountingConnection } from '../../features/accounting/accountingApi';
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
}

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
};

const AccountingSettingsPage = () => {
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
        defaultPaymentTermDays: accountingSettings.defaultPaymentTermDays || 0,
      }));
    }
  }, [accountingSettings]);

  const saveSettings = useCallback(
    async (newSettings: AccountingSettingsState) => {
      await updateSettings(newSettings);
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
      <div className="h-full flex items-center justify-center">
        <p className="text-slate-500">{t('accounting.loading')}</p>
      </div>
    );
  }

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
            <SettingsInput
              label={t('accounting.companyTaxId')}
              value={settings.companyTaxId}
              onChange={(val) => handleChange('companyTaxId', val)}
            />
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

            {/* Test Connection Button */}
            {settings.provider !== 'NONE' && (
              <>
                <SettingsDivider />
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
    </div>
  );
};

export default AccountingSettingsPage;
