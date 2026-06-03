import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { entitlementKeys } from '../entitlements/entitlementsApi';
import { getApiErrorMessage } from '../../lib/api-error';
import i18n from '../../i18n/config';

export interface MarketplaceAddOn {
  code: string;
  name: string;
  description?: string;
  kind: 'software' | 'integration' | 'capacity' | 'support';
  billing: 'recurring' | 'oneTime';
  priceCents: number;
  currency: string;
  deps: string[];
}

export interface TenantAddOn {
  id: string;
  tenantId: string;
  addOnId: string;
  branchId: string | null;
  quantity: number;
  status: 'active' | 'cancelled' | 'expired';
  activatedAt: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  addOn: MarketplaceAddOn & { id: string };
}

export const marketplaceKeys = {
  catalog: (kind?: string) => ['marketplace', 'catalog', kind] as const,
  mine: ['marketplace', 'mine'] as const,
};

export const useListAddOns = (kind?: string) =>
  useQuery({
    queryKey: marketplaceKeys.catalog(kind),
    queryFn: async (): Promise<MarketplaceAddOn[]> => {
      const r = await api.get('/v1/marketplace/addons', { params: kind ? { kind } : {} });
      return r.data;
    },
  });

export const useListMyAddOns = () =>
  useQuery({
    queryKey: marketplaceKeys.mine,
    queryFn: async (): Promise<TenantAddOn[]> => {
      const r = await api.get('/v1/marketplace/addons/mine');
      return r.data;
    },
  });

export const usePurchaseAddOn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { addOnCode: string; quantity?: number; branchId?: string }): Promise<TenantAddOn> => {
      const r = await api.post('/v1/marketplace/addons/purchase', input);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: marketplaceKeys.mine });
      qc.invalidateQueries({ queryKey: entitlementKeys.me });
      // v2.8.88: effective-features is the source of truth for the
      // SubscriptionContext (hasFeature/hasIntegration). Without this
      // invalidation a buyer waits up to 30s for the cached snapshot
      // to expire — they'd click "purchase" and see no UI change
      // until they hard-refresh.
      qc.invalidateQueries({ queryKey: ['subscriptions', 'effective-features'] });
      toast.success(
        i18n.t('marketplace:purchase.success', { defaultValue: 'Add-on purchased.' }),
      );
    },
    onError: (e) =>
      toast.error(
        getApiErrorMessage(
          e,
          i18n.t('marketplace:purchase.failed', { defaultValue: 'Purchase failed' }),
        ),
      ),
  });
};

export const useCancelAddOn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, immediate = false }: { id: string; immediate?: boolean }): Promise<TenantAddOn> => {
      const r = await api.delete(`/v1/marketplace/addons/${id}`, { params: { immediate: immediate ? 'true' : 'false' } });
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: marketplaceKeys.mine });
      qc.invalidateQueries({ queryKey: entitlementKeys.me });
      qc.invalidateQueries({ queryKey: ['subscriptions', 'effective-features'] });
      toast.success('Add-on cancelled.');
    },
  });
};
