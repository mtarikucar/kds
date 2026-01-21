import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Settings, CreditCard, QrCode, Coins } from 'lucide-react';
import { useGetPosSettings, useUpdatePosSettings } from '../../features/pos/posApi';
import {
  useGetTenantSettings,
  useUpdateTenantSettings,
  SUPPORTED_CURRENCIES,
} from '../../hooks/useCurrency';
import { useAutoSave, type AutoSaveStatus } from '../../hooks/useAutoSave';
import { SettingsSection, SettingsDivider, SettingsGroup } from '../../components/settings/SettingsSection';
import { SettingsToggle, SettingsSelect } from '../../components/settings/SettingsToggle';
import ReportSettings from '../../components/settings/ReportSettings';
import LocationSettings from '../../components/settings/LocationSettings';
import WifiSocialSettings from '../../components/settings/WifiSocialSettings';

interface PosSettingsState {
  enableTablelessMode: boolean;
  enableTwoStepCheckout: boolean;
  showProductImages: boolean;
  enableCustomerOrdering: boolean;
}

const POSSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: posSettings, isLoading } = useGetPosSettings();
  const { mutateAsync: updatePosSettings } = useUpdatePosSettings();
  const { data: tenantSettings, isLoading: isLoadingTenant } = useGetTenantSettings();
  const { mutate: updateTenantSettings, isPending: isUpdatingTenant } =
    useUpdateTenantSettings();

  // POS settings state
  const [settings, setSettings] = useState<PosSettingsState>({
    enableTablelessMode: false,
    enableTwoStepCheckout: false,
    showProductImages: true,
    enableCustomerOrdering: true,
  });

  // Currency state (manual save)
  const [currency, setCurrency] = useState('TRY');
  const [currencyStatus, setCurrencyStatus] = useState<AutoSaveStatus>('idle');

  // Load settings when data arrives
  useEffect(() => {
    if (posSettings) {
      setSettings({
        enableTablelessMode: posSettings.enableTablelessMode,
        enableTwoStepCheckout: posSettings.enableTwoStepCheckout,
        showProductImages: posSettings.showProductImages,
        enableCustomerOrdering: posSettings.enableCustomerOrdering,
      });
    }
  }, [posSettings]);

  // Load tenant settings when data arrives
  useEffect(() => {
    if (tenantSettings) {
      setCurrency(tenantSettings.currency || 'TRY');
    }
  }, [tenantSettings]);

  // Save function for POS settings
  const savePosSettings = useCallback(
    async (newSettings: PosSettingsState) => {
      await updatePosSettings(newSettings);
    },
    [updatePosSettings]
  );

  // Auto-save hook for POS settings
  const {
    status: posStatus,
    setValue: triggerPosSave,
    retry: retryPosSave,
  } = useAutoSave(settings, savePosSettings, {
    debounceMs: 300,
    onSuccess: () => {
      toast.success(t('autoSave.savedSuccess'), { duration: 2000 });
    },
    onError: () => {
      toast.error(t('settingsFailed'));
    },
  });

  // Handle toggle changes
  const handleToggleChange = (
    field: keyof PosSettingsState,
    value: boolean
  ) => {
    // Validation: Cannot disable two-step checkout if customer ordering is active
    if (field === 'enableTwoStepCheckout' && !value && settings.enableCustomerOrdering) {
      toast.error(t('twoStepCheckout.cannotDisableWithCustomerOrdering'));
      return;
    }

    // Auto-enable two-step checkout when enabling customer ordering
    let newSettings = { ...settings, [field]: value };
    if (field === 'enableCustomerOrdering' && value && !settings.enableTwoStepCheckout) {
      newSettings = { ...newSettings, enableTwoStepCheckout: true };
      toast.info(t('twoStepCheckout.autoEnabled'));
    }

    setSettings(newSettings);
    triggerPosSave(newSettings);
  };

  // Handle currency save (manual)
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

  const hasCurrencyChanges =
    tenantSettings && currency !== tenantSettings.currency;

  if (isLoading || isLoadingTenant) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-slate-500">{t('posSettings.loading')}</p>
      </div>
    );
  }

  return (
    <div className="h-full p-4 md:p-6 overflow-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-slate-900">
          {t('posSettings.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('posSettings.description')}
        </p>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* Operation Modes Section */}
        <SettingsSection
          title={t('operationModes')}
          description={t('info.noteBody')}
          icon={<Settings className="w-4 h-4" />}
          saveStatus={posStatus}
          onRetry={retryPosSave}
        >
          <SettingsGroup>
            <SettingsToggle
              label={t('enableTablelessMode')}
              description={t('tablelessModeDescription')}
              checked={settings.enableTablelessMode}
              onChange={(checked) => handleToggleChange('enableTablelessMode', checked)}
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('twoStepCheckout.title')}
              description={t('twoStepCheckout.description')}
              checked={settings.enableTwoStepCheckout}
              onChange={(checked) => handleToggleChange('enableTwoStepCheckout', checked)}
              warning={
                settings.enableCustomerOrdering
                  ? t('twoStepCheckout.requiredForQRMenu')
                  : undefined
              }
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('showProductImages.title')}
              description={t('showProductImages.description')}
              checked={settings.showProductImages}
              onChange={(checked) => handleToggleChange('showProductImages', checked)}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* QR Menu Section */}
        <SettingsSection
          title="QR Menu"
          description={t('enableCustomerOrdering.description')}
          icon={<QrCode className="w-4 h-4" />}
          saveStatus={posStatus}
          onRetry={retryPosSave}
        >
          <SettingsGroup>
            <SettingsToggle
              label={t('enableCustomerOrdering.title')}
              description={t('enableCustomerOrdering.description')}
              checked={settings.enableCustomerOrdering}
              onChange={(checked) => handleToggleChange('enableCustomerOrdering', checked)}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* Currency Section - Manual Save */}
        <SettingsSection
          title={t('currencySettings.title')}
          description={t('currencySettings.description')}
          icon={<Coins className="w-4 h-4" />}
          requireManualSave
          saveStatus={currencyStatus}
          onSave={handleSaveCurrency}
          isSaving={isUpdatingTenant}
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

          {/* Warning about currency changes */}
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              <strong>{t('info.noteLabel')}</strong>{' '}
              {t('autoSave.currencyWarning')}
            </p>
          </div>
        </SettingsSection>

        {/* Report Settings */}
        <ReportSettings />

        {/* Location Settings */}
        <LocationSettings />

        {/* WiFi & Social Media Settings */}
        <WifiSocialSettings />
      </div>
    </div>
  );
};

export default POSSettingsPage;
