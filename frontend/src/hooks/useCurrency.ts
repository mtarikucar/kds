import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export interface TenantSettings {
  id: string;
  name: string;
  currency: string;
  closingTime?: string;
  timezone?: string;
  reportEmailEnabled?: boolean;
  reportEmails?: string[];
  latitude?: number;
  longitude?: number;
  locationRadius?: number;
}

export interface UpdateTenantSettingsDto {
  currency?: string;
  closingTime?: string;
  timezone?: string;
  reportEmailEnabled?: boolean;
  reportEmails?: string[];
  latitude?: number | null;
  longitude?: number | null;
  locationRadius?: number;
}

export const SUPPORTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
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
