import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

/**
 * One country-scoped tax-id shape, mirrored from CountryProfile.taxIdRules
 * — see backend/src/common/country/country-profile.const.ts. `pattern` is
 * the RegExp SOURCE string: JSON can't carry a RegExp instance, so the
 * backend ships `.source` and the frontend reconstructs it with
 * `new RegExp(pattern)` — see isValidTaxId() below / in useCountryProfile.ts.
 */
export interface TaxIdRuleView {
  name: string;
  pattern: string;
  labelKey: string;
}

export interface TenantSettings {
  id: string;
  name: string;
  subdomain?: string | null;
  currency: string;
  /** ISO-3166-1 alpha-2. Resolves the country profile (display decimals,
   *  locale, etc.) — see backend/src/common/country/country-profile.const.ts. */
  countryCode: string;
  closingTime?: string;
  timezone?: string;
  reportEmailEnabled?: boolean;
  reportEmails?: string[];
  latitude?: number;
  longitude?: number;
  locationRadius?: number;
  // WiFi settings
  wifiSsid?: string;
  wifiPassword?: string;
  // Social media links
  socialInstagram?: string;
  socialFacebook?: string;
  socialTwitter?: string;
  socialTiktok?: string;
  socialYoutube?: string;
  socialWhatsapp?: string;
  /** Country-scoped tax identifier — VKN/TCKN for TR, STIR/PINFL for UZ.
   *  Shape is validated against `taxIdRules` below, not a fixed pattern.
   *  Required for KDV-compliant (or country-equivalent) invoices. */
  taxId?: string;
  /** DERIVED from the country profile (backend/src/modules/tenants/tenants.service.ts),
   *  never a stored column — the tenant's OWN allowed tax band, e.g. TR's
   *  [0, 1, 10, 20] or UZ's [0, 6, 12]. See useCountryProfile(). */
  taxRates?: number[];
  /** DERIVED — the country profile's own default rate (TR: 10, UZ: 12). */
  defaultTaxRate?: number;
  /** DERIVED — the tenant's OWN tax-id shapes (TR: VKN/TCKN, UZ: STIR/PINFL).
   *  See useCountryProfile(). */
  taxIdRules?: TaxIdRuleView[];
}

export interface UpdateTenantSettingsDto {
  subdomain?: string | null;
  currency?: string;
  closingTime?: string;
  timezone?: string;
  reportEmailEnabled?: boolean;
  reportEmails?: string[];
  latitude?: number | null;
  longitude?: number | null;
  locationRadius?: number;
  // WiFi settings
  wifiSsid?: string;
  wifiPassword?: string;
  // Social media links
  socialInstagram?: string;
  socialFacebook?: string;
  socialTwitter?: string;
  socialTiktok?: string;
  socialYoutube?: string;
  socialWhatsapp?: string;
  /** `null` clears the stored value; `undefined` leaves it untouched. */
  taxId?: string | null;
}

// The platform operates in Turkish Lira only — PayTR (the card processor)
// collects TRY exclusively, so the storefront/POS currency is not selectable.
// The broader symbol map still lives in src/lib/currency.ts for the
// bank-transfer/havale code paths that can still render a legacy non-TRY plan.
export const SUPPORTED_CURRENCIES = [
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'];

// Fetch tenant settings
export const useGetTenantSettings = () => {
  return useQuery<TenantSettings>({
    queryKey: ['tenantSettings'],
    queryFn: async () => {
      const response = await api.get('/tenants/settings');
      return response.data;
    },
  });
};

// Update tenant settings
export const useUpdateTenantSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateTenantSettingsDto) => {
      const response = await api.patch('/tenants/settings', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenantSettings'] });
    },
  });
};

// Get current tenant currency
export const useCurrency = (): string => {
  const { data: tenantSettings } = useGetTenantSettings();
  return tenantSettings?.currency || 'TRY';
};
