import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Coins, Receipt } from 'lucide-react';
import {
  useGetTenantSettings,
  useUpdateTenantSettings,
  SUPPORTED_CURRENCIES,
} from '../../hooks/useCurrency';
import type { AutoSaveStatus } from '../../hooks/useAutoSave';
import { SettingsSection, SettingsGroup } from '../../components/settings/SettingsSection';
import { SettingsSelect } from '../../components/settings/SettingsToggle';
import SubdomainSettings from '../../components/settings/SubdomainSettings';
import { getApiErrorMessage } from '../../lib/api-error';

const BrandingSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: tenantSettings, isLoading } = useGetTenantSettings();
  const { mutate: updateTenantSettings, isPending: isUpdating } = useUpdateTenantSettings();

  const [currency, setCurrency] = useState('TRY');
  const [currencyStatus, setCurrencyStatus] = useState<AutoSaveStatus>('idle');

  const [taxId, setTaxId] = useState('');
  const [taxIdStatus, setTaxIdStatus] = useState<AutoSaveStatus>('idle');
  const [taxIdError, setTaxIdError] = useState<string | null>(null);

  useEffect(() => {
    if (tenantSettings) {
      setCurrency(tenantSettings.currency || 'TRY');
      setTaxId(tenantSettings.taxId || '');
    }
  }, [tenantSettings]);

  const handleSaveTaxId = () => {
    setTaxIdError(null);
    // 10 hane (Vergi No) ya da 11 hane (TC Kimlik) — boş bırakmak silmek
    // demek. Yanlış formatta kaydedilmesin diye yerelde de doğrula.
    if (taxId && !/^\d{10,11}$/.test(taxId)) {
      setTaxIdError(t('brandingSettings.taxId.formatError'));
      return;
    }
    setTaxIdStatus('saving');
    // Empty input → send null so the backend can clear the column.
    // Sending `undefined` (`taxId || undefined`) would leave the row
    // unchanged, making the field impossible to delete from the UI.
    updateTenantSettings(
      { taxId: taxId === '' ? null : taxId },
      {
        onSuccess: () => {
          setTaxIdStatus('saved');
          toast.success(t('settingsSaved'));
          setTimeout(() => setTaxIdStatus('idle'), 2000);
        },
        onError: (error) => {
          setTaxIdStatus('error');
          toast.error(getApiErrorMessage(error, t('settingsFailed')));
        },
      },
    );
  };

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
        onError: (error) => {
          setCurrencyStatus('error');
          toast.error(getApiErrorMessage(error, t('settingsFailed')));
        },
      }
    );
  };

  const hasCurrencyChanges = tenantSettings && currency !== tenantSettings.currency;
  const hasTaxIdChanges =
    tenantSettings && (taxId || '') !== (tenantSettings.taxId || '');

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

        {/* Tax ID for KDV-compliant invoices */}
        <SettingsSection
          title={t('brandingSettings.taxId.title')}
          description={t('brandingSettings.taxId.description')}
          icon={<Receipt className="w-4 h-4" />}
          requireManualSave
          saveStatus={taxIdStatus}
          onSave={handleSaveTaxId}
          isSaving={isUpdating}
          hasChanges={!!hasTaxIdChanges}
          saveLabel={t('saveChanges')}
        >
          <SettingsGroup>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t('brandingSettings.taxId.label')}
              </span>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{10,11}"
                maxLength={11}
                value={taxId}
                onChange={(e) => {
                  setTaxId(e.target.value.replace(/\D/g, ''));
                  setTaxIdError(null);
                }}
                placeholder={t('brandingSettings.taxId.placeholder')}
                className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {taxIdError && (
                <p className="mt-1 text-sm text-red-600">{taxIdError}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                {t('brandingSettings.taxId.help')}
              </p>
            </label>
          </SettingsGroup>
        </SettingsSection>

        {/* Subdomain Settings (PRO) */}
        <SubdomainSettings />
      </div>
    </div>
  );
};

export default BrandingSettingsPage;
