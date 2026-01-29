import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Monitor } from 'lucide-react';
import { useGetPosSettings, useUpdatePosSettings } from '../../features/pos/posApi';
import { useAutoSave } from '../../hooks/useAutoSave';
import { SettingsSection, SettingsDivider, SettingsGroup } from '../../components/settings/SettingsSection';
import { SettingsToggle, SettingsSelect } from '../../components/settings/SettingsToggle';

interface PosSettingsState {
  enableTablelessMode: boolean;
  enableTwoStepCheckout: boolean;
  showProductImages: boolean;
  enableCustomerOrdering: boolean;
  defaultMapView: '2d' | '3d';
  requireServedForDineInPayment: boolean;
}

const POSSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: posSettings, isLoading } = useGetPosSettings();
  const { mutateAsync: updatePosSettings } = useUpdatePosSettings();

  const [settings, setSettings] = useState<PosSettingsState>({
    enableTablelessMode: false,
    enableTwoStepCheckout: false,
    showProductImages: true,
    enableCustomerOrdering: true,
    defaultMapView: '2d',
    requireServedForDineInPayment: false,
  });

  useEffect(() => {
    if (posSettings) {
      setSettings({
        enableTablelessMode: posSettings.enableTablelessMode,
        enableTwoStepCheckout: posSettings.enableTwoStepCheckout,
        showProductImages: posSettings.showProductImages,
        enableCustomerOrdering: posSettings.enableCustomerOrdering,
        defaultMapView: posSettings.defaultMapView ?? '2d',
        requireServedForDineInPayment: posSettings.requireServedForDineInPayment ?? false,
      });
    }
  }, [posSettings]);

  const savePosSettings = useCallback(
    async (newSettings: PosSettingsState) => {
      await updatePosSettings(newSettings);
    },
    [updatePosSettings]
  );

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

  const handleToggleChange = (
    field: keyof PosSettingsState,
    value: boolean
  ) => {
    // Validation: Cannot disable two-step checkout if customer ordering is active
    if (field === 'enableTwoStepCheckout' && !value && settings.enableCustomerOrdering) {
      toast.error(t('twoStepCheckout.cannotDisableWithCustomerOrdering'));
      return;
    }

    const newSettings = { ...settings, [field]: value };
    setSettings(newSettings);
    triggerPosSave(newSettings);
  };

  const handleMapViewChange = (value: string) => {
    if (value !== '2d' && value !== '3d') return;
    const newSettings: PosSettingsState = { ...settings, defaultMapView: value };
    setSettings(newSettings);
    triggerPosSave(newSettings);
  };

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
          {t('posSettings.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('posSettings.description')}
        </p>
      </div>

      <div className="max-w-3xl">
        <SettingsSection
          title={t('operationModes')}
          description={t('info.noteBody')}
          icon={<Monitor className="w-4 h-4" />}
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

            {/* Only show this option when two-step checkout is enabled */}
            {settings.enableTwoStepCheckout && (
              <>
                <SettingsDivider />

                <SettingsToggle
                  label={t('requireServedForDineInPayment.title')}
                  description={t('requireServedForDineInPayment.description')}
                  checked={settings.requireServedForDineInPayment}
                  onChange={(checked) => handleToggleChange('requireServedForDineInPayment', checked)}
                />
              </>
            )}

            <SettingsDivider />

            <SettingsToggle
              label={t('showProductImages.title')}
              description={t('showProductImages.description')}
              checked={settings.showProductImages}
              onChange={(checked) => handleToggleChange('showProductImages', checked)}
            />

            <SettingsDivider />

            <SettingsSelect
              label={t('posSettings.defaultMapView')}
              description={t('posSettings.defaultMapViewDesc')}
              value={settings.defaultMapView}
              onChange={handleMapViewChange}
              options={[
                { value: '2d', label: t('posSettings.mapView2D') },
                { value: '3d', label: t('posSettings.mapView3D') },
              ]}
            />
          </SettingsGroup>
        </SettingsSection>
      </div>
    </div>
  );
};

export default POSSettingsPage;
