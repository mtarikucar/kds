import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Coins } from 'lucide-react';
import {
  useGetTenantSettings,
  useUpdateTenantSettings,
  SUPPORTED_CURRENCIES,
} from '../../hooks/useCurrency';
import type { AutoSaveStatus } from '../../hooks/useAutoSave';
import { SettingsSection, SettingsGroup } from '../../components/settings/SettingsSection';
import { SettingsSelect } from '../../components/settings/SettingsToggle';
import SubdomainSettings from '../../components/settings/SubdomainSettings';

const BrandingSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: tenantSettings, isLoading } = useGetTenantSettings();
  const { mutate: updateTenantSettings, isPending: isUpdating } = useUpdateTenantSettings();

  const [currency, setCurrency] = useState('TRY');
  const [currencyStatus, setCurrencyStatus] = useState<AutoSaveStatus>('idle');

  useEffect(() => {
    if (tenantSettings) {
      setCurrency(tenantSettings.currency || 'TRY');
    }
  }, [tenantSettings]);

  const handleSaveCurrency = () => {
    setCurrencyStatus('saving');
    updateTenantSettings(
      { currency },
      {
        onSuccess: () => {
          setCurrencyStatus('saved');
          toast.success(t('settingsSaved'));
          setTimeout(() => setCurrencyStatus('idle'), 2000);
        },
        onError: (error: Error & { response?: { data?: { message?: string } } }) => {
          setCurrencyStatus('error');
          toast.error(error.response?.data?.message || t('settingsFailed'));
        },
      }
    );
  };

  const hasCurrencyChanges = tenantSettings && currency !== tenantSettings.currency;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-slate-500">{t('posSettings.loading')}</p>
      </div>
    );
  }

  return (
    <div className="h-full p-4 md:p-6 overflow-auto">
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-slate-900">
          {t('brandingSettings.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('brandingSettings.description')}
        </p>
      </div>

      <div className="max-w-3xl space-y-4">
        {/* Currency Settings */}
        <SettingsSection
          title={t('currencySettings.title')}
          description={t('currencySettings.description')}
          icon={<Coins className="w-4 h-4" />}
          requireManualSave
          saveStatus={currencyStatus}
          onSave={handleSaveCurrency}
          isSaving={isUpdating}
          hasChanges={!!hasCurrencyChanges}
          saveLabel={t('saveChanges')}
        >
          <SettingsGroup>
            <SettingsSelect
              label={t('currencySettings.selectCurrency')}
              value={currency}
              onChange={setCurrency}
              options={SUPPORTED_CURRENCIES.map((curr) => ({
                value: curr.code,
                label: `${curr.symbol} - ${curr.name} (${curr.code})`,
              }))}
            />
          </SettingsGroup>

          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              <strong>{t('info.noteLabel')}</strong>{' '}
              {t('autoSave.currencyWarning')}
            </p>
          </div>
        </SettingsSection>

        {/* Subdomain Settings (PRO) */}
        <SubdomainSettings />
      </div>
    </div>
  );
};

export default BrandingSettingsPage;
