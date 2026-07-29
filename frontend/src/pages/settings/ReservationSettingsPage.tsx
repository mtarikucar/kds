import { useState, useCallback } from 'react';
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
import { useServerHydratedState } from '../../hooks/useServerHydratedState';
import { getApiErrorMessage } from '../../lib/api-error';
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
import type { UpdateReservationSettingsDto } from '../../types';

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
  holdOffsetMinutes: number;
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

// Backend bounds (UpdateReservationSettingsDto @Min/@Max). Values outside a
// field's range are shown as an inline error AND held back from the autosave
// payload (accounting-page pattern) — one invalid field must not 400 every
// other change on this full-state autosave page.
const NUMBER_FIELD_LIMITS = {
  minAdvanceBooking: { min: 0 },
  maxAdvanceDays: { min: 1, max: 365 },
  defaultDuration: { min: 15 },
  maxGuestsPerReservation: { min: 1 },
  cancellationDeadline: { min: 0 },
  holdOffsetMinutes: { min: 0, max: 240 },
} as const;

type LimitedNumberField = keyof typeof NUMBER_FIELD_LIMITS;

function numberFieldViolation(
  field: LimitedNumberField,
  value: number
): { min: number; max?: number } | null {
  const limits = NUMBER_FIELD_LIMITS[field] as { min: number; max?: number };
  if (!Number.isInteger(value)) return limits;
  if (value < limits.min) return limits;
  if (limits.max !== undefined && value > limits.max) return limits;
  return null;
}

const timeToMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// Mirrors the backend's assertValidOperatingHours: same-day windows only —
// close must be strictly after open (overnight windows produce zero slots).
function isInvalidDayWindow(day: { open: string; close: string; closed: boolean }): boolean {
  if (day.closed) return false;
  const open = timeToMinutes(day.open);
  const close = timeToMinutes(day.close);
  if (Number.isNaN(open) || Number.isNaN(close)) return true;
  return close <= open;
}

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
    try {
      await navigator.clipboard.writeText(reservationLink);
      setLinkCopied(true);
      toast.success(t('reservations:settings.linkCopied'));
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard API can reject (permissions policy, insecure context,
      // browser denial) — surface it instead of showing a false "copied".
      toast.error(t('reservations:settings.copyFailed'));
    }
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
    holdOffsetMinutes: 30,
    operatingHours: DEFAULT_OPERATING_HOURS,
    bannerTitle: '',
    bannerDescription: '',
    customMessage: '',
  });

  const saveSettings = useCallback(
    async (newSettings: ReservationSettingsState) => {
      const payload: UpdateReservationSettingsDto = {
        ...newSettings,
        // Cleared field = "unlimited". The backend encodes unlimited as 0
        // (@Min(0); the availability check is skipped when falsy). Mapping
        // null→undefined made the PATCH a no-op: the UI showed unlimited
        // while the server silently kept the old cap.
        maxReservationsPerSlot: newSettings.maxReservationsPerSlot ?? 0,
      };
      // Hold transient out-of-range values back from the payload instead of
      // letting one invalid field 400 the whole full-state autosave; the
      // inline field error tells the operator what to fix.
      for (const field of Object.keys(NUMBER_FIELD_LIMITS) as LimitedNumberField[]) {
        if (numberFieldViolation(field, newSettings[field])) {
          delete payload[field];
        }
      }
      // @Min(0): a negative/fractional cap would 400 — hold it back too.
      if (
        payload.maxReservationsPerSlot !== undefined &&
        (!Number.isInteger(payload.maxReservationsPerSlot) ||
          payload.maxReservationsPerSlot < 0)
      ) {
        delete payload.maxReservationsPerSlot;
      }
      // Same for operating hours: an overnight/malformed day window is
      // rejected by the backend, so keep the stored hours until it's fixed.
      if (Object.values(newSettings.operatingHours).some(isInvalidDayWindow)) {
        delete payload.operatingHours;
      }
      await updateReservationSettings(payload);
    },
    [updateReservationSettings]
  );

  const {
    status: saveStatus,
    setValue: triggerSave,
    retry: retrySave,
    isDirty,
  } = useAutoSave(settings, saveSettings, {
    debounceMs: 300,
    onSuccess: () => {
      toast.success(t('settings:autoSave.savedSuccess'), { duration: 2000 });
    },
    onError: (error) => {
      // Surface the backend's own message (e.g. the operating-hours
      // validation detail) rather than collapsing everything into the
      // generic "settings failed" key.
      toast.error(getApiErrorMessage(error, t('settings:settingsFailed')));
    },
  });

  // Guarded hydration — a refetch triggered by save A must not clobber a
  // newer edit B made while A was in flight (see useServerHydratedState).
  useServerHydratedState(
    reservationSettings,
    (data) => {
      setSettings({
        isEnabled: data.isEnabled,
        requireApproval: data.requireApproval,
        timeSlotInterval: data.timeSlotInterval,
        minAdvanceBooking: data.minAdvanceBooking,
        maxAdvanceDays: data.maxAdvanceDays,
        defaultDuration: data.defaultDuration,
        maxGuestsPerReservation: data.maxGuestsPerReservation,
        // Server encodes "unlimited" as 0 (or legacy NULL) — both render as
        // the empty input with the "unlimited" placeholder.
        maxReservationsPerSlot: data.maxReservationsPerSlot || null,
        allowCancellation: data.allowCancellation,
        cancellationDeadline: data.cancellationDeadline,
        holdOffsetMinutes: data.holdOffsetMinutes ?? 30,
        operatingHours: data.operatingHours ?? DEFAULT_OPERATING_HOURS,
        bannerTitle: data.bannerTitle ?? '',
        bannerDescription: data.bannerDescription ?? '',
        customMessage: data.customMessage ?? '',
      });
    },
    { skipWhile: isDirty || saveStatus === 'saving' }
  );

  // Inline error text for a bounded number field (undefined when valid).
  const numberFieldError = (field: LimitedNumberField): string | undefined => {
    const violation = numberFieldViolation(field, settings[field]);
    if (!violation) return undefined;
    return violation.max !== undefined
      ? t('reservations:settings.validationRange', { min: violation.min, max: violation.max })
      : t('reservations:settings.validationMin', { min: violation.min });
  };

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
              error={numberFieldError('minAdvanceBooking')}
            />

            <SettingsDivider />

            <SettingsInput
              label={t('reservations:settings.maxAdvanceDays')}
              description={t('reservations:settings.maxAdvanceDaysDesc')}
              type="number"
              value={String(settings.maxAdvanceDays)}
              onChange={(value) => handleNumberChange('maxAdvanceDays', value)}
              error={numberFieldError('maxAdvanceDays')}
            />

            <SettingsDivider />

            <SettingsInput
              label={t('reservations:settings.defaultDuration')}
              description={t('reservations:settings.defaultDurationDesc')}
              type="number"
              value={String(settings.defaultDuration)}
              onChange={(value) => handleNumberChange('defaultDuration', value)}
              error={numberFieldError('defaultDuration')}
            />

            <SettingsDivider />

            <SettingsInput
              label={t('reservations:settings.holdOffsetMinutes')}
              description={t('reservations:settings.holdOffsetMinutesDesc')}
              type="number"
              value={String(settings.holdOffsetMinutes)}
              onChange={(value) => handleNumberChange('holdOffsetMinutes', value)}
              error={numberFieldError('holdOffsetMinutes')}
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
              error={numberFieldError('maxGuestsPerReservation')}
            />

            <SettingsDivider />

            <SettingsInput
              label={t('reservations:settings.maxReservationsPerSlot')}
              description={t('reservations:settings.maxReservationsPerSlotDesc')}
              type="number"
              value={settings.maxReservationsPerSlot !== null ? String(settings.maxReservationsPerSlot) : ''}
              onChange={(value) => handleOptionalNumberChange('maxReservationsPerSlot', value)}
              placeholder={t('reservations:settings.unlimited')}
              error={
                settings.maxReservationsPerSlot !== null &&
                (!Number.isInteger(settings.maxReservationsPerSlot) ||
                  settings.maxReservationsPerSlot < 0)
                  ? t('reservations:settings.validationMin', { min: 0 })
                  : undefined
              }
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
                  error={numberFieldError('cancellationDeadline')}
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
                const dayInvalid = isInvalidDayWindow(dayHours);
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
                    {/* Same-day windows only (backend rejects overnight);
                        this day's hours are held back until fixed. */}
                    {dayInvalid && (
                      <p className="text-xs text-red-600 px-1 pb-1">
                        {t('reservations:settings.overnightNotSupported')}
                      </p>
                    )}
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
