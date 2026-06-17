import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export interface TenantSettings {
  id: string;
  name: string;
  subdomain?: string | null;
  currency: string;
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
  /** Turkish tax identifier (Vergi No / TC Kimlik No) — required for
   *  KDV-compliant invoices. */
  taxId?: string;
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
