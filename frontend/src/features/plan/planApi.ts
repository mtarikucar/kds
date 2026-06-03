import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

/**
 * v2.8.88 — Plan & Erişim API hooks.
 *
 * Two surfaces feed off the same endpoint:
 *   - `/admin/plan` page — kotalar grid, active add-ons list
 *   - Dashboard quota mini-cards (re-uses `useGetUsageSnapshot`)
 *
 * Endpoint: `GET /v1/subscriptions/usage/snapshot` (60s cached
 * server-side per tenant; React Query stale time 60s as well).
 */

export interface UsageDimension {
  current: number;
  /** -1 means unlimited per the engine convention. */
  max: number;
}

export interface UsageSnapshot {
  users: UsageDimension;
  branches: UsageDimension;
  /** v3.0.0 — added alongside SubscriptionPlan.maxTables surfacing
   *  through the entitlement engine. Drives the table-management page
   *  meter and the dashboard quota card. */
  tables: UsageDimension;
  products: UsageDimension;
  monthlyOrders: UsageDimension;
  computedAt: string;
}

export const planKeys = {
  usageSnapshot: () => ['plan', 'usage-snapshot'] as const,
};

export const useGetUsageSnapshot = () =>
  useQuery({
    queryKey: planKeys.usageSnapshot(),
    queryFn: async (): Promise<UsageSnapshot> => {
      const r = await api.get('/subscriptions/usage/snapshot');
      return r.data;
    },
    staleTime: 60_000,
  });
