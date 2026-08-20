import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Coins, Receipt } from 'lucide-react';
import {
  useGetTenantSettings,
  useUpdateTenantSettings,
} from '../../hooks/useCurrency';
import { useCountryProfile, isValidTaxId, taxIdMaxLength } from '../../hooks/useCountryProfile';
import type { AutoSaveStatus } from '../../hooks/useAutoSave';
import { useServerHydratedState } from '../../hooks/useServerHydratedState';
import { SettingsSection, SettingsGroup } from '../../components/settings/SettingsSection';
import SubdomainSettings from '../../components/settings/SubdomainSettings';
import { getApiErrorMessage } from '../../lib/api-error';

const BrandingSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: tenantSettings, isLoading } = useGetTenantSettings();
  const { mutate: updateTenantSettings, isPending: isUpdating } = useUpdateTenantSettings();
  // currency is DERIVED from the tenant's country — no longer a setting the
  // user picks (Task 7 removed `currency` from UpdateTenantSettingsDto; a
  // tenant whose currency disagreed with its country broke the invariant
  // CountryService.currencyForTenant() exists to guarantee).
  const { taxIdRules, currency } = useCountryProfile();
  const taxIdNames = taxIdRules.map((r) => r.name).join(' / ');
  const taxIdLabel = taxIdRules.map((r) => t(r.labelKey)).join(' / ');

  const [taxId, setTaxId] = useState('');
  const [taxIdStatus, setTaxIdStatus] = useState<AutoSaveStatus>('idle');
  const [taxIdError, setTaxIdError] = useState<string | null>(null);


  const handleSaveTaxId = () => {
    setTaxIdError(null);
    // Şekil ülkeye bağlı (TR: VKN/TCKN, UZ: STIR/PINFL) — boş bırakmak
    // silmek demek. Yanlış formatta kaydedilmesin diye yerelde de doğrula.
    if (taxId && !isValidTaxId(taxId, taxIdRules)) {
      setTaxIdError(t('brandingSettings.taxId.formatError', { names: taxIdNames }));
      return;
    }
    setTaxIdStatus('saving');
    // Empty input → send null so the backend can clear the column.
    // Sending `undefined` (`taxId || undefined`) would leave the row
    // unchanged, making the field impossible to delete from the UI.
    updateTenantSettings(
      { taxId: taxId === '' ? null : taxId },
      {
        onSuccess: () => {
          setTaxIdStatus('saved');
          toast.success(t('settingsSaved'));
          setTimeout(() => setTaxIdStatus('idle'), 2000);
        },
        onError: (error) => {
          setTaxIdStatus('error');
          toast.error(getApiErrorMessage(error, t('settingsFailed')));
        },
      },
    );
  };

  const hasTaxIdChanges =
    tenantSettings && (taxId || '') !== (tenantSettings.taxId || '');

  // Guarded hydration — the tenantSettings query is shared across several
  // settings components; a refetch one of them triggers must not clobber an
  // unsaved taxId edit here (see useServerHydratedState). Currency has no
  // local state to hydrate any more — it's read straight from
  // useCountryProfile() below.
  useServerHydratedState(
    tenantSettings,
    (data) => {
      setTaxId(data.taxId || '');
    },
    { skipWhile: Boolean(hasTaxIdChanges) || isUpdating }
  );

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
          {t('brandingSettings.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('brandingSettings.description')}
        </p>
      </div>

      <div className="max-w-3xl space-y-4">
        {/* Currency — DERIVED from the tenant's country, read-only */}
        <SettingsSection
          title={t('currencySettings.title')}
          description={t('currencySettings.description')}
          icon={<Coins className="w-4 h-4" />}
        >
          <SettingsGroup>
            <div>
              <span className="block text-sm font-medium text-slate-700">
                {t('currencySettings.currentCurrency')}
              </span>
              <p className="mt-1 text-sm text-slate-900">{currency}</p>
              <p className="mt-1 text-xs text-slate-500">
                {t('currencySettings.derivedFromCountry')}
              </p>
            </div>
          </SettingsGroup>
        </SettingsSection>

        {/* Tax ID for KDV-compliant invoices */}
        <SettingsSection
          title={t('brandingSettings.taxId.title')}
          description={t('brandingSettings.taxId.description')}
          icon={<Receipt className="w-4 h-4" />}
          requireManualSave
          saveStatus={taxIdStatus}
          onSave={handleSaveTaxId}
          isSaving={isUpdating}
          hasChanges={!!hasTaxIdChanges}
          saveLabel={t('saveChanges')}
        >
          <SettingsGroup>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {taxIdLabel}
              </span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={taxIdMaxLength(taxIdRules)}
                value={taxId}
                onChange={(e) => {
                  setTaxId(e.target.value.replace(/\D/g, ''));
                  setTaxIdError(null);
                }}
                placeholder={t('brandingSettings.taxId.placeholder')}
                className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {taxIdError && (
                <p className="mt-1 text-sm text-red-600">{taxIdError}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                {t('brandingSettings.taxId.help', { names: taxIdNames })}
              </p>
            </label>
          </SettingsGroup>
        </SettingsSection>

        {/* Subdomain Settings (PRO) */}
        <SubdomainSettings />
      </div>
    </div>
  );
};

export default BrandingSettingsPage;
