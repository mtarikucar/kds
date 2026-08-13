import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Lock, ArrowRight, AlertTriangle, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetTenantSettings, useUpdateTenantSettings } from '../../hooks/useCurrency';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import Button from '../ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';

// Subdomain validation regex: lowercase alphanumeric and hyphens, cannot start/end with hyphen
const SUBDOMAIN_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{1,2}$/;

// Reserved subdomains that cannot be used
const RESERVED_SUBDOMAINS = [
  'www', 'app', 'api', 'admin', 'staging', 'mail', 'smtp', 'ftp',
  'status', 'help', 'support', 'docs', 'dashboard', 'login', 'signup',
  'register', 'auth', 'cdn', 'static', 'assets', 'beta', 'test', 'demo',
];

// Mirrors backend SUBDOMAIN_QUARANTINE_DAYS — how long an outgoing subdomain
// is locked (only this tenant can reclaim it during the window).
const QUARANTINE_DAYS = 90;

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
  const { mutateAsync: updateSettings, isPending } = useUpdateTenantSettings();
  const { hasFeature, isLoading: isLoadingSubscription } = useSubscription();

  // `feature.customBranding` is in FREE_BASELINE_GRANTS — granted to every
  // tenant unconditionally, so this is NOT an upsell gate and there is nothing
  // to sell. It can only read false in two situations:
  //   1. the licensing snapshot failed to load (hasFeature fails closed, so
  //      `false` also means "we don't know yet"), or
  //   2. ops suppressed the capability for this one tenant via an
  //      `override:admin` grant while handling abuse.
  // Both are "temporarily unavailable, here is where to look", never
  // "buy something". The loading case is handled by the early return below.
  const hasCustomBranding = hasFeature('customBranding');
  const currentSubdomain = settings?.subdomain || '';
  const isLockedWithSubdomain = !hasCustomBranding && !!currentSubdomain;

  const [formState, setFormState] = useState<SubdomainFormState>({
    subdomain: '',
  });

  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  // EXPLICIT save only — this control used to autosave on an 800ms debounce,
  // which meant a mid-typing pause committed a partial rename and clearing
  // the field silently DELETED the subdomain. Every outgoing name is
  // quarantined for 90 days on the backend, so an accidental save broke the
  // printed QR address. Renames/removals now require the confirm dialog.
  const performSave = useCallback(async () => {
    try {
      await updateSettings({
        subdomain: formState.subdomain || null,
      });
      setConfirmOpen(false);
      toast.success(t('subdomain.saveSuccess'), { duration: 2000 });
    } catch (error) {
      const errorMessage = error instanceof Error && error.message.includes('403')
        ? t('subdomain.permissionDenied')
        : t('subdomain.saveError');
      toast.error(errorMessage);
    }
  }, [updateSettings, formState.subdomain, t]);

  const hasChanges = formState.subdomain !== currentSubdomain;

  const handleSaveClick = () => {
    if (!hasCustomBranding || !hasChanges || isPending) return;
    if (!validateSubdomain(formState.subdomain)) return;
    if (currentSubdomain) {
      // Changing OR removing an existing subdomain releases it into the
      // 90-day quarantine and breaks printed QR codes — always confirm.
      setConfirmOpen(true);
    } else {
      // First-time set: nothing is released, no confirmation needed.
      void performSave();
    }
  };

  // Handle field changes — updates local state only; nothing is persisted
  // until the operator explicitly saves (and confirms, when destructive).
  const handleChange = (value: string) => {
    // Normalize: lowercase and remove invalid characters
    const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setFormState({ subdomain: normalized });
    validateSubdomain(normalized);
  };

  // /subscription/change-plan compared plan tiers and no longer exists (App.tsx
  // redirects the surviving plan bookmarks to /admin/license). Licence & Access
  // is where a tenant can actually see what is switched on for the account,
  // which is the only useful destination when a free-core capability reads as
  // unavailable.
  const handleOpenLicense = () => {
    navigate('/admin/license');
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

  // Not an upsell: the capability is free for everyone, so the only honest
  // message is "it is included, and here is why it might look switched off".
  const unavailableNotice = (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 p-1.5 bg-slate-200 rounded-full">
          <Lock className="w-3.5 h-3.5 text-slate-600" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-medium text-slate-900 mb-0.5">
            {t('subdomain.unavailableTitle')}
          </p>
          <p className="text-xs text-slate-600 mb-2">
            {t('subdomain.unavailableDescription')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleOpenLicense}
            className="inline-flex items-center gap-1"
          >
            {t('subdomain.openLicense')}
            <ArrowRight className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );

  // Nothing set and the capability reads as unavailable — explain, don't sell.
  if (!hasCustomBranding && !currentSubdomain) {
    if (compact) {
      return unavailableNotice;
    }
    return (
      <SettingsSection
        title={t('subdomain.title')}
        description={t('subdomain.description')}
        icon={<Globe className="w-4 h-4" />}
      >
        {unavailableNotice}
      </SettingsSection>
    );
  }

  const subdomainContent = (
    <>
      {/* The address stays live; only editing it is currently blocked. */}
      {isLockedWithSubdomain && (
        <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-amber-800">
                {t('subdomain.lockedNotice')}
              </p>
              <button
                onClick={handleOpenLicense}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium underline mt-0.5"
              >
                {t('subdomain.openLicense')}
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
              disabled={isLockedWithSubdomain}
              className={`flex-1 px-2.5 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 ${
                isLockedWithSubdomain
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

        {/* Explicit save — changing/removing an existing subdomain is
            destructive (90-day quarantine, broken printed QR codes), so
            there is deliberately NO autosave here. */}
        {!isLockedWithSubdomain && hasCustomBranding && (
          <div className="flex justify-end pt-1">
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveClick}
              isLoading={isPending}
              disabled={!hasChanges || !!validationError || isPending}
              className="inline-flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              {t('subdomain.saveButton')}
            </Button>
          </div>
        )}
      </div>

      {/* Destructive-change confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('subdomain.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('subdomain.confirmBody', {
                current: currentSubdomain,
                days: QUARANTINE_DAYS,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="px-4 sm:px-6 py-3">
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 break-all">
                https://{currentSubdomain}.hummytummy.com
                {formState.subdomain ? (
                  <>
                    {' → '}https://{formState.subdomain}.hummytummy.com
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              {t('subdomain.confirmCancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void performSave()}
              isLoading={isPending}
            >
              {t('subdomain.confirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    >
      {subdomainContent}
    </SettingsSection>
  );
}
