import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useGetTenantSettings, useUpdateTenantSettings } from '../../hooks/useCurrency';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Clock, Mail, Plus, X, Globe } from 'lucide-react';

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

const ReportSettings = () => {
  const { t } = useTranslation('settings');
  const { data: tenantSettings, isLoading } = useGetTenantSettings();
  const { mutate: updateSettings, isPending: isUpdating } = useUpdateTenantSettings();

  const [closingTime, setClosingTime] = useState('23:00');
  const [timezone, setTimezone] = useState('UTC');
  const [reportEmailEnabled, setReportEmailEnabled] = useState(false);
  const [reportEmails, setReportEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState('');

  // Load settings when data arrives
  useEffect(() => {
    if (tenantSettings) {
      setClosingTime(tenantSettings.closingTime || '23:00');
      setTimezone(tenantSettings.timezone || 'UTC');
      setReportEmailEnabled(tenantSettings.reportEmailEnabled || false);
      setReportEmails(tenantSettings.reportEmails || []);
    }
  }, [tenantSettings]);

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

  const handleSave = () => {
    updateSettings(
      {
        closingTime,
        timezone,
        reportEmailEnabled,
        reportEmails,
      },
      {
        onSuccess: () => {
          toast.success(t('reportSettings.settingsSaved'));
        },
        onError: (error: any) => {
          toast.error(error.response?.data?.message || t('reportSettings.settingsFailed'));
        },
      }
    );
  };

  const hasChanges =
    tenantSettings &&
    (closingTime !== (tenantSettings.closingTime || '23:00') ||
      timezone !== (tenantSettings.timezone || 'UTC') ||
      reportEmailEnabled !== (tenantSettings.reportEmailEnabled || false) ||
      JSON.stringify(reportEmails) !== JSON.stringify(tenantSettings.reportEmails || []));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-gray-500 text-center">{t('common:app.loading')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          {t('reportSettings.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-gray-600">{t('reportSettings.description')}</p>

        {/* Closing Time */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
            <Clock className="h-4 w-4" />
            {t('reportSettings.closingTime')}
          </label>
          <Input
            type="time"
            value={closingTime}
            onChange={(e) => setClosingTime(e.target.value)}
            className="w-48"
          />
          <p className="text-xs text-gray-500 mt-1">
            {t('reportSettings.closingTimeDescription')}
          </p>
        </div>

        {/* Timezone */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
            <Globe className="h-4 w-4" />
            {t('reportSettings.timezone')}
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            {t('reportSettings.timezoneDescription')}
          </p>
        </div>

        <div className="border-t pt-6">
          {/* Enable Automated Reports */}
          <div className="flex items-start gap-3 mb-6">
            <input
              type="checkbox"
              id="reportEmailEnabled"
              checked={reportEmailEnabled}
              onChange={(e) => setReportEmailEnabled(e.target.checked)}
              className="w-5 h-5 mt-0.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <div>
              <label htmlFor="reportEmailEnabled" className="font-semibold text-gray-900 cursor-pointer">
                {t('reportSettings.enableEmailReports')}
              </label>
              <p className="text-sm text-gray-600">
                {t('reportSettings.enableEmailReportsDescription')}
              </p>
            </div>
          </div>

          {/* Email Recipients */}
          <div className={reportEmailEnabled ? '' : 'opacity-50 pointer-events-none'}>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              {t('reportSettings.emailRecipients')}
            </label>
            <p className="text-xs text-gray-500 mb-3">
              {t('reportSettings.emailRecipientsDescription')}
            </p>

            {/* Email List */}
            <div className="space-y-2 mb-4">
              {reportEmails.length === 0 ? (
                <p className="text-sm text-gray-400 italic py-2">
                  {t('reportSettings.noEmails')}
                </p>
              ) : (
                reportEmails.map((email) => (
                  <div
                    key={email}
                    className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg"
                  >
                    <span className="text-sm">{email}</span>
                    <button
                      onClick={() => handleRemoveEmail(email)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
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
                />
              </div>
              <Button
                variant="outline"
                onClick={handleAddEmail}
                disabled={!newEmail.trim()}
              >
                <Plus className="h-4 w-4 mr-1" />
                {t('reportSettings.addEmail')}
              </Button>
            </div>
          </div>
        </div>

        {/* Info box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            <strong>{t('info.noteLabel')}</strong> {t('reportSettings.emailReportInfo')}
          </p>
        </div>

        {/* Save button */}
        <div className="flex justify-end pt-4">
          <Button
            variant="primary"
            size="lg"
            onClick={handleSave}
            isLoading={isUpdating}
            disabled={!hasChanges}
          >
            {t('saveChanges')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ReportSettings;
