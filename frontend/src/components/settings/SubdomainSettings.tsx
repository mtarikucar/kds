import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Lock, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetTenantSettings, useUpdateTenantSettings } from '../../hooks/useCurrency';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useAutoSave } from '../../hooks/useAutoSave';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import Button from '../ui/Button';

// Subdomain validation regex: lowercase alphanumeric and hyphens, cannot start/end with hyphen
const SUBDOMAIN_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{1,2}$/;

// Reserved subdomains that cannot be used
const RESERVED_SUBDOMAINS = [
  'www', 'app', 'api', 'admin', 'staging', 'mail', 'smtp', 'ftp',
  'status', 'help', 'support', 'docs', 'dashboard', 'login', 'signup',
  'register', 'auth', 'cdn', 'static', 'assets', 'beta', 'test', 'demo',
];

interface SubdomainFormState {
  subdomain: string;
}

interface SubdomainSettingsProps {
  compact?: boolean;
}

export default function SubdomainSettings({ compact = false }: SubdomainSettingsProps) {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const { data: settings, isLoading } = useGetTenantSettings();
  const { mutateAsync: updateSettings } = useUpdateTenantSettings();
  const { hasFeature, isLoading: isLoadingSubscription } = useSubscription();

  const hasCustomBranding = hasFeature('customBranding');
  const currentSubdomain = settings?.subdomain || '';
  const isGrandfathered = !hasCustomBranding && !!currentSubdomain;

  const [formState, setFormState] = useState<SubdomainFormState>({
    subdomain: '',
  });

  const [validationError, setValidationError] = useState<string | null>(null);

  // Load existing settings
  useEffect(() => {
    if (settings) {
      setFormState({
        subdomain: settings.subdomain || '',
      });
    }
  }, [settings]);

  // Validate subdomain format
  const validateSubdomain = useCallback((value: string): boolean => {
    if (!value) {
      setValidationError(null);
      return true;
    }

    if (value.length < 3) {
      setValidationError(t('subdomain.errorTooShort'));
      return false;
    }

    if (value.length > 63) {
      setValidationError(t('subdomain.errorTooLong'));
      return false;
    }

    if (!SUBDOMAIN_REGEX.test(value)) {
      setValidationError(t('subdomain.errorInvalidFormat'));
      return false;
    }

    if (RESERVED_SUBDOMAINS.includes(value)) {
      setValidationError(t('subdomain.errorReserved'));
      return false;
    }

    setValidationError(null);
    return true;
  }, [t]);

  // Save function
  const saveSettings = useCallback(
    async (state: SubdomainFormState) => {
      if (!validateSubdomain(state.subdomain)) {
        throw new Error('Invalid subdomain format');
      }
      await updateSettings({
        subdomain: state.subdomain || null,
      });
    },
    [updateSettings, validateSubdomain]
  );

  // Auto-save hook
  const {
    status: autoSaveStatus,
    setValue: triggerAutoSave,
    retry: retryAutoSave,
  } = useAutoSave(formState, saveSettings, {
    debounceMs: 800,
    onSuccess: () => {
      toast.success(t('autoSave.savedSuccess'), { duration: 2000 });
    },
    onError: (error) => {
      const errorMessage = error instanceof Error && error.message.includes('403')
        ? t('subdomain.proFeature')
        : t('subdomain.saveError');
      toast.error(errorMessage);
    },
  });

  // Handle field changes
  const handleChange = (value: string) => {
    // Normalize: lowercase and remove invalid characters
    const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const newState = { subdomain: normalized };
    setFormState(newState);

    const isValid = validateSubdomain(normalized);

    // Only trigger save if user has permission AND validation passes
    if (hasCustomBranding && isValid) {
      triggerAutoSave(newState);
    }
  };

  const handleUpgrade = () => {
    navigate('/subscription/change-plan');
  };

  // Preview URL
  const previewUrl = useMemo(() => {
    const subdomain = formState.subdomain || currentSubdomain;
    if (subdomain) {
      return `${subdomain}.hummytummy.com`;
    }
    return null;
  }, [formState.subdomain, currentSubdomain]);

  if (isLoading || isLoadingSubscription) {
    if (compact) {
      return (
        <p className="text-slate-500 text-center py-3 text-sm">{t('common:app.loading')}</p>
      );
    }
    return (
      <SettingsSection
        title={t('subdomain.title')}
        icon={<Globe className="w-4 h-4" />}
      >
        <p className="text-slate-500 text-center py-4">{t('common:app.loading')}</p>
      </SettingsSection>
    );
  }

  // Upgrade prompt content (no subdomain, no feature)
  const upgradePromptContent = (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-3">
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 p-1.5 bg-amber-100 rounded-full">
          <Lock className="w-3.5 h-3.5 text-amber-600" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-medium text-slate-900 mb-0.5">
            {t('subdomain.proFeature')}
          </p>
          <p className="text-xs text-slate-600 mb-2">
            {t('subdomain.proFeatureDescription')}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={handleUpgrade}
            className="inline-flex items-center gap-1"
          >
            {t('subdomain.upgradeToPro')}
            <ArrowRight className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );

  // Show upgrade prompt only (no subdomain, no feature)
  if (!hasCustomBranding && !currentSubdomain) {
    if (compact) {
      return upgradePromptContent;
    }
    return (
      <SettingsSection
        title={t('subdomain.title')}
        description={t('subdomain.description')}
        icon={<Globe className="w-4 h-4" />}
      >
        {upgradePromptContent}
      </SettingsSection>
    );
  }

  const subdomainContent = (
    <>
      {/* Grandfathered notice */}
      {isGrandfathered && (
        <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-amber-800">
                {t('subdomain.grandfathered')}
              </p>
              <button
                onClick={handleUpgrade}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium underline mt-0.5"
              >
                {t('subdomain.upgradeToChange')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subdomain input */}
      <div className="space-y-2">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {t('subdomain.inputLabel')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={formState.subdomain}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={t('subdomain.inputPlaceholder')}
              maxLength={63}
              disabled={isGrandfathered}
              className={`flex-1 px-2.5 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 ${
                isGrandfathered
                  ? 'bg-slate-100 text-slate-500 cursor-not-allowed border-slate-200'
                  : 'border-slate-300'
              } ${validationError ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : ''}`}
            />
            <span className="text-xs text-slate-500">.hummytummy.com</span>
          </div>
          {validationError && (
            <p className="mt-1 text-xs text-red-600">{validationError}</p>
          )}
        </div>

        {/* URL Preview */}
        {previewUrl && (
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-xs text-slate-500 mb-0.5">{t('subdomain.previewLabel')}</p>
            <p className="text-sm font-medium text-primary-600">
              https://{previewUrl}
            </p>
          </div>
        )}

        {/* Help text */}
        {!compact && (
          <p className="text-xs text-slate-500">
            {t('subdomain.helpText')}
          </p>
        )}
      </div>
    </>
  );

  if (compact) {
    return subdomainContent;
  }

  return (
    <SettingsSection
      title={t('subdomain.title')}
      description={t('subdomain.description')}
      icon={<Globe className="w-4 h-4" />}
      saveStatus={hasCustomBranding ? autoSaveStatus : undefined}
      onRetry={retryAutoSave}
    >
      {subdomainContent}
    </SettingsSection>
  );
}
