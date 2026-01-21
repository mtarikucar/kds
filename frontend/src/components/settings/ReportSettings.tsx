import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useGetTenantSettings, useUpdateTenantSettings } from '../../hooks/useCurrency';
import { useAutoSave, type AutoSaveStatus } from '../../hooks/useAutoSave';
import { SettingsSection, SettingsDivider, SettingsGroup } from './SettingsSection';
import { SettingsToggle, SettingsSelect, SettingsInput } from './SettingsToggle';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { Mail, Plus, X } from 'lucide-react';

// Common timezones for restaurant businesses
const TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/Istanbul', label: 'Europe/Istanbul (GMT+3)' },
  { value: 'Europe/London', label: 'Europe/London (GMT+0/+1)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (GMT+1/+2)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (GMT+1/+2)' },
  { value: 'America/New_York', label: 'America/New York (EST/EDT)' },
  { value: 'America/Los_Angeles', label: 'America/Los Angeles (PST/PDT)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GMT+4)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (GMT+9)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (GMT+8)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (GMT+10/+11)' },
];

interface ReportSettingsState {
  closingTime: string;
  timezone: string;
  reportEmailEnabled: boolean;
}

const ReportSettings = () => {
  const { t } = useTranslation('settings');
  const { data: tenantSettings, isLoading } = useGetTenantSettings();
  const { mutateAsync: updateSettings, mutate: updateSettingsSync, isPending: isUpdating } =
    useUpdateTenantSettings();

  // Auto-save settings
  const [settings, setSettings] = useState<ReportSettingsState>({
    closingTime: '23:00',
    timezone: 'UTC',
    reportEmailEnabled: false,
  });

  // Email recipients (manual save)
  const [reportEmails, setReportEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailStatus, setEmailStatus] = useState<AutoSaveStatus>('idle');

  // Load settings when data arrives
  useEffect(() => {
    if (tenantSettings) {
      setSettings({
        closingTime: tenantSettings.closingTime || '23:00',
        timezone: tenantSettings.timezone || 'UTC',
        reportEmailEnabled: tenantSettings.reportEmailEnabled || false,
      });
      setReportEmails(tenantSettings.reportEmails || []);
    }
  }, [tenantSettings]);

  // Save function for report settings (auto-save)
  const saveReportSettings = useCallback(
    async (newSettings: ReportSettingsState) => {
      await updateSettings(newSettings);
    },
    [updateSettings]
  );

  // Auto-save hook
  const {
    status: autoSaveStatus,
    setValue: triggerAutoSave,
    retry: retryAutoSave,
  } = useAutoSave(settings, saveReportSettings, {
    debounceMs: 800,
    onSuccess: () => {
      toast.success(t('autoSave.savedSuccess'), { duration: 2000 });
    },
    onError: () => {
      toast.error(t('reportSettings.settingsFailed'));
    },
  });

  // Handle auto-save field changes
  const handleFieldChange = <K extends keyof ReportSettingsState>(
    field: K,
    value: ReportSettingsState[K]
  ) => {
    const newSettings = { ...settings, [field]: value };
    setSettings(newSettings);
    triggerAutoSave(newSettings);
  };

  // Email validation
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleAddEmail = () => {
    const trimmedEmail = newEmail.trim();
    if (!trimmedEmail) return;

    if (!validateEmail(trimmedEmail)) {
      setEmailError(t('reportSettings.invalidEmail'));
      return;
    }

    if (reportEmails.includes(trimmedEmail)) {
      setEmailError(t('reportSettings.emailAlreadyAdded'));
      return;
    }

    setReportEmails([...reportEmails, trimmedEmail]);
    setNewEmail('');
    setEmailError('');
    toast.success(t('reportSettings.emailAdded'));
  };

  const handleRemoveEmail = (email: string) => {
    setReportEmails(reportEmails.filter((e) => e !== email));
    toast.success(t('reportSettings.emailRemoved'));
  };

  // Save email list (manual)
  const handleSaveEmails = () => {
    setEmailStatus('saving');
    updateSettingsSync(
      { reportEmails },
      {
        onSuccess: () => {
          setEmailStatus('saved');
          toast.success(t('reportSettings.settingsSaved'));
          setTimeout(() => setEmailStatus('idle'), 2000);
        },
        onError: () => {
          setEmailStatus('error');
          toast.error(t('reportSettings.settingsFailed'));
        },
      }
    );
  };

  const hasEmailChanges =
    tenantSettings &&
    JSON.stringify(reportEmails) !== JSON.stringify(tenantSettings.reportEmails || []);

  if (isLoading) {
    return (
      <SettingsSection
        title={t('reportSettings.title')}
        icon={<Mail className="w-4 h-4" />}
      >
        <p className="text-slate-500 text-center py-4">{t('common:app.loading')}</p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={t('reportSettings.title')}
      description={t('reportSettings.description')}
      icon={<Mail className="w-4 h-4" />}
      saveStatus={autoSaveStatus}
      onRetry={retryAutoSave}
    >
      <SettingsGroup>
        {/* Closing Time */}
        <SettingsInput
          label={t('reportSettings.closingTime')}
          description={t('reportSettings.closingTimeDescription')}
          type="time"
          value={settings.closingTime}
          onChange={(value) => handleFieldChange('closingTime', value)}
          inputClassName="w-28"
        />

        <SettingsDivider />

        {/* Timezone */}
        <SettingsSelect
          label={t('reportSettings.timezone')}
          description={t('reportSettings.timezoneDescription')}
          value={settings.timezone}
          onChange={(value) => handleFieldChange('timezone', value)}
          options={TIMEZONES}
        />

        <SettingsDivider />

        {/* Enable Automated Reports */}
        <SettingsToggle
          label={t('reportSettings.enableEmailReports')}
          description={t('reportSettings.enableEmailReportsDescription')}
          checked={settings.reportEmailEnabled}
          onChange={(checked) => handleFieldChange('reportEmailEnabled', checked)}
        />
      </SettingsGroup>

      {/* Email Recipients Section (Manual Save) */}
      <div
        className={`mt-4 pt-4 border-t border-slate-100 ${
          settings.reportEmailEnabled ? '' : 'opacity-50 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-slate-900">
              {t('reportSettings.emailRecipients')}
            </p>
            <p className="text-xs text-slate-500">
              {t('reportSettings.emailRecipientsDescription')}
            </p>
          </div>
        </div>

        {/* Email List */}
        <div className="space-y-2 mb-3">
          {reportEmails.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-2">
              {t('reportSettings.noEmails')}
            </p>
          ) : (
            reportEmails.map((email) => (
              <div
                key={email}
                className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg"
              >
                <span className="text-sm">{email}</span>
                <button
                  onClick={() => handleRemoveEmail(email)}
                  className="text-slate-400 hover:text-red-500 transition-colors"
                  title={t('reportSettings.removeEmail')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add Email Form */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setEmailError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddEmail();
                }
              }}
              placeholder="admin@example.com"
              error={emailError}
              className="text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddEmail}
            disabled={!newEmail.trim()}
          >
            <Plus className="h-4 w-4 mr-1" />
            {t('reportSettings.addEmail')}
          </Button>
        </div>

        {/* Save Email List Button */}
        {hasEmailChanges && (
          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveEmails}
              isLoading={isUpdating}
            >
              {t('saveChanges')}
            </Button>
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>{t('info.noteLabel')}</strong> {t('reportSettings.emailReportInfo')}
        </p>
      </div>
    </SettingsSection>
  );
};

export default ReportSettings;
