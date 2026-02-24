import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CalendarDays,
  Clock,
  Users,
  Ban,
  Image,
  Settings,
  Link,
  Copy,
  Check,
} from 'lucide-react';
import {
  useReservationSettings,
  useUpdateReservationSettings,
} from '../../features/reservations/reservationsApi';
import { useAuthStore } from '../../store/authStore';
import { useAutoSave } from '../../hooks/useAutoSave';
import {
  SettingsSection,
  SettingsDivider,
  SettingsGroup,
} from '../../components/settings/SettingsSection';
import {
  SettingsToggle,
  SettingsSelect,
  SettingsInput,
} from '../../components/settings/SettingsToggle';
import FeatureGate from '../../components/subscriptions/FeatureGate';

interface ReservationSettingsState {
  isEnabled: boolean;
  requireApproval: boolean;
  timeSlotInterval: number;
  minAdvanceBooking: number;
  maxAdvanceDays: number;
  defaultDuration: number;
  maxGuestsPerReservation: number;
  maxReservationsPerSlot: number | null;
  allowCancellation: boolean;
  cancellationDeadline: number;
  operatingHours: Record<string, { open: string; close: string; closed: boolean }>;
  bannerTitle: string;
  bannerDescription: string;
  customMessage: string;
}

const DEFAULT_OPERATING_HOURS: Record<string, { open: string; close: string; closed: boolean }> = {
  monday: { open: '09:00', close: '22:00', closed: false },
  tuesday: { open: '09:00', close: '22:00', closed: false },
  wednesday: { open: '09:00', close: '22:00', closed: false },
  thursday: { open: '09:00', close: '22:00', closed: false },
  friday: { open: '09:00', close: '23:00', closed: false },
  saturday: { open: '09:00', close: '23:00', closed: false },
  sunday: { open: '09:00', close: '22:00', closed: false },
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

const ReservationSettingsPage = () => {
  const { t } = useTranslation(['reservations', 'settings']);
  const { data: reservationSettings, isLoading } = useReservationSettings();
  const { mutateAsync: updateReservationSettings } = useUpdateReservationSettings();
  const user = useAuthStore((state) => state.user);
  const [linkCopied, setLinkCopied] = useState(false);

  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const reservationLink = user?.tenantId
    ? `${window.location.origin}${basePath}/reserve/${user.tenantId}`
    : '';

  const handleCopyLink = async () => {
    if (!reservationLink) return;
    await navigator.clipboard.writeText(reservationLink);
    setLinkCopied(true);
    toast.success(t('reservations:settings.linkCopied'));
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const [settings, setSettings] = useState<ReservationSettingsState>({
    isEnabled: false,
    requireApproval: true,
    timeSlotInterval: 30,
    minAdvanceBooking: 60,
    maxAdvanceDays: 30,
    defaultDuration: 90,
    maxGuestsPerReservation: 10,
    maxReservationsPerSlot: null,
    allowCancellation: true,
    cancellationDeadline: 120,
    operatingHours: DEFAULT_OPERATING_HOURS,
    bannerTitle: '',
    bannerDescription: '',
    customMessage: '',
  });

  useEffect(() => {
    if (reservationSettings) {
      setSettings({
        isEnabled: reservationSettings.isEnabled,
        requireApproval: reservationSettings.requireApproval,
        timeSlotInterval: reservationSettings.timeSlotInterval,
        minAdvanceBooking: reservationSettings.minAdvanceBooking,
        maxAdvanceDays: reservationSettings.maxAdvanceDays,
        defaultDuration: reservationSettings.defaultDuration,
        maxGuestsPerReservation: reservationSettings.maxGuestsPerReservation,
        maxReservationsPerSlot: reservationSettings.maxReservationsPerSlot ?? null,
        allowCancellation: reservationSettings.allowCancellation,
        cancellationDeadline: reservationSettings.cancellationDeadline,
        operatingHours: reservationSettings.operatingHours ?? DEFAULT_OPERATING_HOURS,
        bannerTitle: reservationSettings.bannerTitle ?? '',
        bannerDescription: reservationSettings.bannerDescription ?? '',
        customMessage: reservationSettings.customMessage ?? '',
      });
    }
  }, [reservationSettings]);

  const saveSettings = useCallback(
    async (newSettings: ReservationSettingsState) => {
      await updateReservationSettings({
        ...newSettings,
        maxReservationsPerSlot: newSettings.maxReservationsPerSlot ?? undefined,
      });
    },
    [updateReservationSettings]
  );

  const {
    status: saveStatus,
    setValue: triggerSave,
    retry: retrySave,
  } = useAutoSave(settings, saveSettings, {
    debounceMs: 300,
    onSuccess: () => {
      toast.success(t('settings:autoSave.savedSuccess'), { duration: 2000 });
    },
    onError: () => {
      toast.error(t('settings:settingsFailed'));
    },
  });

  const handleToggleChange = (field: keyof ReservationSettingsState, value: boolean) => {
    const newSettings = { ...settings, [field]: value };
    setSettings(newSettings);
    triggerSave(newSettings);
  };

  const handleNumberChange = (field: keyof ReservationSettingsState, value: string) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) && value !== '') return;
    const newSettings = { ...settings, [field]: value === '' ? 0 : numValue };
    setSettings(newSettings);
    triggerSave(newSettings);
  };

  const handleOptionalNumberChange = (field: keyof ReservationSettingsState, value: string) => {
    const numValue = value === '' ? null : parseInt(value, 10);
    if (numValue !== null && isNaN(numValue)) return;
    const newSettings = { ...settings, [field]: numValue };
    setSettings(newSettings);
    triggerSave(newSettings);
  };

  const handleSelectChange = (field: keyof ReservationSettingsState, value: string) => {
    const numValue = parseInt(value, 10);
    const newSettings = { ...settings, [field]: numValue };
    setSettings(newSettings);
    triggerSave(newSettings);
  };

  const handleTextChange = (field: keyof ReservationSettingsState, value: string) => {
    const newSettings = { ...settings, [field]: value };
    setSettings(newSettings);
    triggerSave(newSettings);
  };

  const handleOperatingHoursChange = (
    day: string,
    field: 'open' | 'close' | 'closed',
    value: string | boolean
  ) => {
    const newOperatingHours = {
      ...settings.operatingHours,
      [day]: {
        ...settings.operatingHours[day],
        [field]: value,
      },
    };
    const newSettings = { ...settings, operatingHours: newOperatingHours };
    setSettings(newSettings);
    triggerSave(newSettings);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-slate-500">{t('reservations:settings.loading')}</p>
      </div>
    );
  }

  return (
    <FeatureGate feature="reservationSystem">
    <div className="h-full p-4 md:p-6 overflow-auto">
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-slate-900">
          {t('reservations:settings.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('reservations:settings.description')}
        </p>
      </div>

      {/* Reservation Link */}
      {reservationLink && (
        <div className="max-w-3xl mb-6">
          <div className="bg-gradient-to-r from-primary-50 to-blue-50 border border-primary-200/60 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-primary-500 flex items-center justify-center shadow-sm">
                <Link className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {t('reservations:settings.reservationLink')}
                </h3>
                <p className="text-xs text-slate-500">
                  {t('reservations:settings.reservationLinkDesc')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 shadow-sm">
                <p className="text-sm text-slate-700 truncate font-mono">
                  {reservationLink}
                </p>
              </div>
              <button
                onClick={handleCopyLink}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 shadow-sm ${
                  linkCopied
                    ? 'bg-emerald-500 text-white'
                    : 'bg-primary-500 text-white hover:bg-primary-600'
                }`}
              >
                {linkCopied ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {t('reservations:settings.copyLink')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-3xl space-y-6">
        {/* General Settings */}
        <SettingsSection
          title={t('reservations:settings.general')}
          description={t('reservations:settings.generalDescription')}
          icon={<Settings className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsToggle
              label={t('reservations:settings.enabled')}
              description={t('reservations:settings.enabledDesc')}
              checked={settings.isEnabled}
              onChange={(checked) => handleToggleChange('isEnabled', checked)}
            />

            <SettingsDivider />

            <SettingsToggle
              label={t('reservations:settings.requireApproval')}
              description={t('reservations:settings.requireApprovalDesc')}
              checked={settings.requireApproval}
              onChange={(checked) => handleToggleChange('requireApproval', checked)}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* Time Settings */}
        <SettingsSection
          title={t('reservations:settings.timeSettings')}
          description={t('reservations:settings.timeSettingsDescription')}
          icon={<Clock className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsSelect
              label={t('reservations:settings.timeSlotInterval')}
              description={t('reservations:settings.timeSlotIntervalDesc')}
              value={String(settings.timeSlotInterval)}
              onChange={(value) => handleSelectChange('timeSlotInterval', value)}
              options={[
                { value: '15', label: t('reservations:settings.minutesCount', { count: 15 }) },
                { value: '30', label: t('reservations:settings.minutesCount', { count: 30 }) },
                { value: '60', label: t('reservations:settings.minutesCount', { count: 60 }) },
              ]}
            />

            <SettingsDivider />

            <SettingsInput
              label={t('reservations:settings.minAdvanceBooking')}
              description={t('reservations:settings.minAdvanceBookingDesc')}
              type="number"
              value={String(settings.minAdvanceBooking)}
              onChange={(value) => handleNumberChange('minAdvanceBooking', value)}
            />

            <SettingsDivider />

            <SettingsInput
              label={t('reservations:settings.maxAdvanceDays')}
              description={t('reservations:settings.maxAdvanceDaysDesc')}
              type="number"
              value={String(settings.maxAdvanceDays)}
              onChange={(value) => handleNumberChange('maxAdvanceDays', value)}
            />

            <SettingsDivider />

            <SettingsInput
              label={t('reservations:settings.defaultDuration')}
              description={t('reservations:settings.defaultDurationDesc')}
              type="number"
              value={String(settings.defaultDuration)}
              onChange={(value) => handleNumberChange('defaultDuration', value)}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* Capacity Settings */}
        <SettingsSection
          title={t('reservations:settings.capacity')}
          description={t('reservations:settings.capacityDescription')}
          icon={<Users className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsInput
              label={t('reservations:settings.maxGuests')}
              description={t('reservations:settings.maxGuestsDesc')}
              type="number"
              value={String(settings.maxGuestsPerReservation)}
              onChange={(value) => handleNumberChange('maxGuestsPerReservation', value)}
            />

            <SettingsDivider />

            <SettingsInput
              label={t('reservations:settings.maxReservationsPerSlot')}
              description={t('reservations:settings.maxReservationsPerSlotDesc')}
              type="number"
              value={settings.maxReservationsPerSlot !== null ? String(settings.maxReservationsPerSlot) : ''}
              onChange={(value) => handleOptionalNumberChange('maxReservationsPerSlot', value)}
              placeholder={t('reservations:settings.unlimited')}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* Cancellation Settings */}
        <SettingsSection
          title={t('reservations:settings.cancellation')}
          description={t('reservations:settings.cancellationDescription')}
          icon={<Ban className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <SettingsToggle
              label={t('reservations:settings.allowCancellation')}
              description={t('reservations:settings.allowCancellationDesc')}
              checked={settings.allowCancellation}
              onChange={(checked) => handleToggleChange('allowCancellation', checked)}
            />

            {settings.allowCancellation && (
              <>
                <SettingsDivider />

                <SettingsInput
                  label={t('reservations:settings.cancellationDeadline')}
                  description={t('reservations:settings.cancellationDeadlineDesc')}
                  type="number"
                  value={String(settings.cancellationDeadline)}
                  onChange={(value) => handleNumberChange('cancellationDeadline', value)}
                />
              </>
            )}
          </SettingsGroup>
        </SettingsSection>

        {/* Operating Hours */}
        <SettingsSection
          title={t('reservations:settings.operatingHours')}
          description={t('reservations:settings.operatingHoursDesc')}
          icon={<CalendarDays className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <div className="space-y-3">
              {DAYS.map((day, index) => {
                const dayHours = settings.operatingHours[day] || { open: '09:00', close: '22:00', closed: false };
                return (
                  <div key={day}>
                    {index > 0 && <SettingsDivider />}
                    <div className="flex items-center justify-between gap-4 py-2 px-1">
                      <div className="min-w-[100px]">
                        <p className="text-sm font-medium text-slate-900 capitalize">
                          {t(`reservations:days.${day}`)}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 flex-1 justify-end">
                        {!dayHours.closed && (
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              value={dayHours.open}
                              onChange={(e) =>
                                handleOperatingHoursChange(day, 'open', e.target.value)
                              }
                              className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                            />
                            <span className="text-sm text-slate-400">-</span>
                            <input
                              type="time"
                              value={dayHours.close}
                              onChange={(e) =>
                                handleOperatingHoursChange(day, 'close', e.target.value)
                              }
                              className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                            />
                          </div>
                        )}

                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={dayHours.closed}
                            onChange={(e) =>
                              handleOperatingHoursChange(day, 'closed', e.target.checked)
                            }
                            className="rounded border-slate-300 text-primary-500 focus:ring-primary-500/20"
                          />
                          <span className="text-xs text-slate-500 font-medium">
                            {t('reservations:settings.closed')}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SettingsGroup>
        </SettingsSection>

        {/* Banner & Messaging */}
        <SettingsSection
          title={t('reservations:settings.banner')}
          description={t('reservations:settings.bannerDescription')}
          icon={<Image className="w-4 h-4" />}
          saveStatus={saveStatus}
          onRetry={retrySave}
        >
          <SettingsGroup>
            <div className="py-3 px-1">
              <p className="text-sm font-medium text-slate-900 mb-1.5">
                {t('reservations:settings.bannerTitle')}
              </p>
              <p className="text-sm text-slate-500 mb-2">
                {t('reservations:settings.bannerTitleDesc')}
              </p>
              <input
                type="text"
                value={settings.bannerTitle}
                onChange={(e) => handleTextChange('bannerTitle', e.target.value)}
                placeholder={t('reservations:settings.bannerTitlePlaceholder')}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 hover:border-slate-300 transition-all duration-200"
              />
            </div>

            <SettingsDivider />

            <div className="py-3 px-1">
              <p className="text-sm font-medium text-slate-900 mb-1.5">
                {t('reservations:settings.bannerDescriptionLabel')}
              </p>
              <p className="text-sm text-slate-500 mb-2">
                {t('reservations:settings.bannerDescriptionHelp')}
              </p>
              <textarea
                value={settings.bannerDescription}
                onChange={(e) => handleTextChange('bannerDescription', e.target.value)}
                placeholder={t('reservations:settings.bannerDescriptionPlaceholder')}
                rows={3}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 hover:border-slate-300 transition-all duration-200 resize-none"
              />
            </div>

            <SettingsDivider />

            <div className="py-3 px-1">
              <p className="text-sm font-medium text-slate-900 mb-1.5">
                {t('reservations:settings.customMessage')}
              </p>
              <p className="text-sm text-slate-500 mb-2">
                {t('reservations:settings.customMessageDesc')}
              </p>
              <textarea
                value={settings.customMessage}
                onChange={(e) => handleTextChange('customMessage', e.target.value)}
                placeholder={t('reservations:settings.customMessagePlaceholder')}
                rows={3}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 hover:border-slate-300 transition-all duration-200 resize-none"
              />
            </div>
          </SettingsGroup>
        </SettingsSection>
      </div>
    </div>
    </FeatureGate>
  );
};

export default ReservationSettingsPage;
