import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MessageSquare, CalendarCheck, ShoppingCart } from 'lucide-react';
import { useGetSmsSettings, useUpdateSmsSettings, SmsSettings } from '../../features/sms/smsSettingsApi';
import { useAutoSave } from '../../hooks/useAutoSave';
import { SettingsSection, SettingsDivider, SettingsGroup } from '../../components/settings/SettingsSection';
import { SettingsToggle } from '../../components/settings/SettingsToggle';

interface SmsSettingsState {
  isEnabled: boolean;
  smsOnReservationCreated: boolean;
  smsOnReservationConfirmed: boolean;
  smsOnReservationRejected: boolean;
  smsOnReservationCancelled: boolean;
  smsOnOrderCreated: boolean;
  smsOnOrderApproved: boolean;
  smsOnOrderPreparing: boolean;
  smsOnOrderReady: boolean;
  smsOnOrderCancelled: boolean;
}

const defaultSettings: SmsSettingsState = {
  isEnabled: false,
  smsOnReservationCreated: true,
  smsOnReservationConfirmed: true,
  smsOnReservationRejected: true,
  smsOnReservationCancelled: true,
  smsOnOrderCreated: true,
  smsOnOrderApproved: true,
  smsOnOrderPreparing: true,
  smsOnOrderReady: true,
  smsOnOrderCancelled: true,
};

const SmsSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: smsSettings, isLoading } = useGetSmsSettings();
  const { mutateAsync: updateSmsSettings } = useUpdateSmsSettings();

  const [settings, setSettings] = useState<SmsSettingsState>(defaultSettings);

  useEffect(() => {
    if (smsSettings) {
      setSettings({
        isEnabled: smsSettings.isEnabled,
        smsOnReservationCreated: smsSettings.smsOnReservationCreated,
        smsOnReservationConfirmed: smsSettings.smsOnReservationConfirmed,
        smsOnReservationRejected: smsSettings.smsOnReservationRejected,
        smsOnReservationCancelled: smsSettings.smsOnReservationCancelled,
        smsOnOrderCreated: smsSettings.smsOnOrderCreated,
        smsOnOrderApproved: smsSettings.smsOnOrderApproved,
        smsOnOrderPreparing: smsSettings.smsOnOrderPreparing,
        smsOnOrderReady: smsSettings.smsOnOrderReady,
        smsOnOrderCancelled: smsSettings.smsOnOrderCancelled,
      });
    }
  }, [smsSettings]);

  const saveSmsSettings = useCallback(
    async (newSettings: SmsSettingsState) => {
      await updateSmsSettings(newSettings);
    },
    [updateSmsSettings],
  );

  const {
    status: saveStatus,
    setValue: triggerSave,
    retry: retrySave,
  } = useAutoSave(settings, saveSmsSettings, {
    debounceMs: 300,
    onSuccess: () => {
      toast.success(t('autoSave.savedSuccess'), { duration: 2000 });
    },
    onError: () => {
      toast.error(t('settingsFailed'));
    },
  });

  const handleToggleChange = (field: keyof SmsSettingsState, value: boolean) => {
    const newSettings = { ...settings, [field]: value };
    setSettings(newSettings);
    triggerSave(newSettings);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-slate-500">{t('sms.loading')}</p>
      </div>
    );
  }

  return (
    <div className="h-full p-4 md:p-6 overflow-auto">
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-slate-900">
          {t('sms.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('sms.description')}
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Master Toggle */}
        <SettingsSection
          title={t('sms.masterToggle')}
          description={t('sms.masterToggleDescription')}
          icon={<MessageSquare className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsToggle
              label={t('sms.masterToggle')}
              description={t('sms.masterToggleDescription')}
              checked={settings.isEnabled}
              onChange={(checked) => handleToggleChange('isEnabled', checked)}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* Reservation SMS */}
        <SettingsSection
          title={t('sms.reservationSection')}
          description={t('sms.reservationSectionDesc')}
          icon={<CalendarCheck className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsToggle
              label={t('sms.reservationCreated')}
              description={t('sms.reservationCreatedDesc')}
              checked={settings.smsOnReservationCreated}
              onChange={(checked) => handleToggleChange('smsOnReservationCreated', checked)}
              disabled={!settings.isEnabled}
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('sms.reservationConfirmed')}
              description={t('sms.reservationConfirmedDesc')}
              checked={settings.smsOnReservationConfirmed}
              onChange={(checked) => handleToggleChange('smsOnReservationConfirmed', checked)}
              disabled={!settings.isEnabled}
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('sms.reservationRejected')}
              description={t('sms.reservationRejectedDesc')}
              checked={settings.smsOnReservationRejected}
              onChange={(checked) => handleToggleChange('smsOnReservationRejected', checked)}
              disabled={!settings.isEnabled}
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('sms.reservationCancelled')}
              description={t('sms.reservationCancelledDesc')}
              checked={settings.smsOnReservationCancelled}
              onChange={(checked) => handleToggleChange('smsOnReservationCancelled', checked)}
              disabled={!settings.isEnabled}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* Order SMS */}
        <SettingsSection
          title={t('sms.orderSection')}
          description={t('sms.orderSectionDesc')}
          icon={<ShoppingCart className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsToggle
              label={t('sms.orderCreated')}
              description={t('sms.orderCreatedDesc')}
              checked={settings.smsOnOrderCreated}
              onChange={(checked) => handleToggleChange('smsOnOrderCreated', checked)}
              disabled={!settings.isEnabled}
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('sms.orderApproved')}
              description={t('sms.orderApprovedDesc')}
              checked={settings.smsOnOrderApproved}
              onChange={(checked) => handleToggleChange('smsOnOrderApproved', checked)}
              disabled={!settings.isEnabled}
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('sms.orderPreparing')}
              description={t('sms.orderPreparingDesc')}
              checked={settings.smsOnOrderPreparing}
              onChange={(checked) => handleToggleChange('smsOnOrderPreparing', checked)}
              disabled={!settings.isEnabled}
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('sms.orderReady')}
              description={t('sms.orderReadyDesc')}
              checked={settings.smsOnOrderReady}
              onChange={(checked) => handleToggleChange('smsOnOrderReady', checked)}
              disabled={!settings.isEnabled}
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('sms.orderCancelled')}
              description={t('sms.orderCancelledDesc')}
              checked={settings.smsOnOrderCancelled}
              onChange={(checked) => handleToggleChange('smsOnOrderCancelled', checked)}
              disabled={!settings.isEnabled}
            />
          </SettingsGroup>
        </SettingsSection>
      </div>
    </div>
  );
};

export default SmsSettingsPage;
