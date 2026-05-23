import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

/**
 * The entitlement engine's read-side. Every UI gate consults this set
 * directly so plan upgrades / add-on purchases / admin overrides take
 * effect on the next refetch.
 *
 * Shape (mirrors backend EntitlementSet):
 *   features:     { 'feature.kds': true, ... }
 *   limits:       { 'limit.maxTables': 50, ... }         // -1 = unlimited
 *   integrations: { 'integration.delivery': ['yemeksepeti','getir'] }
 */
export interface EntitlementSet {
  features: Record<string, boolean>;
  limits: Record<string, number>;
  integrations: Record<string, string[]>;
  computedAt: string;
}

export const entitlementKeys = {
  me: ['entitlements', 'me'] as const,
};

export const useGetMyEntitlements = () => {
  return useQuery({
    queryKey: entitlementKeys.me,
    queryFn: async (): Promise<EntitlementSet> => {
      const r = await api.get('/v1/entitlements/me');
      return r.data;
    },
    // Short cache — guards read this on every page load; 30s window
    // matches the server-side in-process cache.
    staleTime: 30_000,
  });
};

export const useHasFeature = (key: string): boolean => {
  const { data } = useGetMyEntitlements();
  return Boolean(data?.features?.[key]);
};

export const useLimit = (key: string, fallback = 0): { value: number; unlimited: boolean } => {
  const { data } = useGetMyEntitlements();
  const v = data?.limits?.[key] ?? fallback;
  return { value: v, unlimited: v === -1 };
};
