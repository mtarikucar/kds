import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { QrCode } from 'lucide-react';
import { useGetPosSettings, useUpdatePosSettings } from '../../features/pos/posApi';
import { useAutoSave } from '../../hooks/useAutoSave';
import { SettingsSection, SettingsDivider, SettingsGroup } from '../../components/settings/SettingsSection';
import { SettingsToggle } from '../../components/settings/SettingsToggle';
import LocationSettings from '../../components/settings/LocationSettings';
import WifiSocialSettings from '../../components/settings/WifiSocialSettings';

const QRMenuSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: posSettings, isLoading } = useGetPosSettings();
  const { mutateAsync: updatePosSettings } = useUpdatePosSettings();

  const [enableCustomerOrdering, setEnableCustomerOrdering] = useState(true);
  const [enableTwoStepCheckout, setEnableTwoStepCheckout] = useState(false);

  useEffect(() => {
    if (posSettings) {
      setEnableCustomerOrdering(posSettings.enableCustomerOrdering);
      setEnableTwoStepCheckout(posSettings.enableTwoStepCheckout);
    }
  }, [posSettings]);

  const saveSettings = useCallback(
    async (settings: { enableCustomerOrdering: boolean; enableTwoStepCheckout: boolean }) => {
      await updatePosSettings(settings);
    },
    [updatePosSettings]
  );

  const {
    status: saveStatus,
    setValue: triggerSave,
    retry: retrySave,
  } = useAutoSave(
    { enableCustomerOrdering, enableTwoStepCheckout },
    saveSettings,
    {
      debounceMs: 300,
      onSuccess: () => {
        toast.success(t('autoSave.savedSuccess'), { duration: 2000 });
      },
      onError: () => {
        toast.error(t('settingsFailed'));
      },
    }
  );

  const handleToggleCustomerOrdering = (checked: boolean) => {
    let newTwoStep = enableTwoStepCheckout;

    // Auto-enable two-step checkout when enabling customer ordering
    if (checked && !enableTwoStepCheckout) {
      newTwoStep = true;
      toast.info(t('twoStepCheckout.autoEnabled'));
    }

    setEnableCustomerOrdering(checked);
    setEnableTwoStepCheckout(newTwoStep);
    triggerSave({ enableCustomerOrdering: checked, enableTwoStepCheckout: newTwoStep });
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
          {t('qrMenuSettings.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('qrMenuSettings.description')}
        </p>
      </div>

      <div className="max-w-3xl space-y-4">
        {/* Customer Ordering Toggle */}
        <SettingsSection
          title={t('qrMenuSettings.orderingTitle')}
          icon={<QrCode className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsToggle
              label={t('enableCustomerOrdering.title')}
              description={t('enableCustomerOrdering.description')}
              checked={enableCustomerOrdering}
              onChange={handleToggleCustomerOrdering}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* Location Settings */}
        <LocationSettings />

        {/* WiFi & Social Settings */}
        <WifiSocialSettings />
      </div>
    </div>
  );
};

export default QRMenuSettingsPage;
