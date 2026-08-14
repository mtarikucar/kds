import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { entitlementKeys } from '../entitlements/entitlementsApi';
import { getApiErrorMessage } from '../../lib/api-error';
import i18n from '../../i18n/config';
import { useAuthStore } from '../../store/authStore';

export interface MarketplaceAddOn {
  code: string;
  name: string;
  description?: string;
  kind: 'software' | 'integration' | 'capacity' | 'support';
  /**
   * Billing cadence. There is no monthly rail — the catalogue only ever emits
   * `annual` (the licence and the yearly modules/integrations it unlocks;
   * renewal is manual) or `oneTime` (credit packs, on-site setup). Mirrors the
   * backend `BILLING = ["annual", "oneTime"]` DTO enum
   * (marketplace/dto/addon.dto.ts) and the `billing String @default("annual")`
   * column, both of which this type used to contradict.
   */
  billing: 'annual' | 'oneTime';
  priceCents: number;
  currency: string;
  deps: string[];
  // True when the tenant's effective entitlements (the free core, plus any
  // modules they already hold) already grant everything this add-on would.
  // Only present on the tenant-aware /addons/available endpoint (the public
  // /addons catalogue omits it). Drives the "Hesabınızda zaten etkin"
  // treatment so we never try to sell something the tenant already has.
  includedInPlan?: boolean;
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
  // Prefix-only key (no `kind`) for invalidation — `invalidateQueries` fuzzy-
  // matches on a key PREFIX, so a 3-tuple `catalog(undefined)` would only
  // match the unfiltered query and miss the kind-filtered ones (MarketplacePage's
  // category chips). Use this whenever a mutation needs to invalidate every
  // `includedInPlan`-bearing catalog query regardless of `kind`.
  catalogAll: ['marketplace', 'catalog'] as const,
  mine: ['marketplace', 'mine'] as const,
};

export const useListAddOns = (kind?: string) =>
  useQuery({
    queryKey: marketplaceKeys.catalog(kind),
    queryFn: async (): Promise<MarketplaceAddOn[]> => {
      // Tenant-aware catalogue: each row carries includedInPlan so the UI can
      // mark add-ons the plan already grants instead of offering to sell them.
      // (The public /addons endpoint is for the un-authenticated landing site.)
      const r = await api.get('/v1/marketplace/addons/available', {
        params: kind ? { kind } : {},
      });
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

// SECURITY (deep-review C2): the free-grant hook `usePurchaseAddOn`
// (POST /v1/marketplace/addons/purchase) was removed together with its
// backend endpoint — it granted paid add-ons without collecting payment.
// All add-on purchases now go through `usePurchaseAddOnViaCheckout` below,
// which routes through the PayTR checkout rail.

export interface AddOnCheckoutIntent {
  paymentRef: string;
  paymentLink: string;
  amountCents: number;
  currency: string;
}

/**
 * Paid add-on purchase. Instead of the free `/addons/purchase` grant, this
 * trades the add-on for a PayTR checkout intent — a single `addon` line in a
 * mixed cart (POST /v1/checkout/intent) — then sends the buyer to PayTR's
 * hosted payment page. The add-on is provisioned by the `CK-` webhook
 * (CheckoutSettlementService → confirmAndProvision → tenantMarketplace.purchase
 * with the settled paymentRef) ONLY after the money is collected. Mirrors the
 * hardware-store checkout flow. This is the ONLY add-on purchase path; the
 * free-grant endpoint was removed (deep-review C2).
 */
export const usePurchaseAddOnViaCheckout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      /** Single-product form. */
      addOnCode?: string;
      qty?: number;
      branchId?: string;
      /**
       * MULTI-LINE form. Needed because a first purchase is necessarily
       * "licence + the product it unlocks": the server rejects a
       * licence-gated line without one, and making the customer discover
       * that by failing at checkout would be hostile.
       */
      items?: Array<{
        type: 'addon';
        code: string;
        qty?: number;
        branchId?: string;
      }>;
      /**
       * Ids of the three current legal documents the buyer ticked (KVKK,
       * Mesafeli Satış, İade). The server re-verifies they are the live
       * versions and records consent before minting a PayTR token, so this
       * is not optional — a checkout without it is refused.
       */
      acceptedDocumentIds: string[];
    }): Promise<AddOnCheckoutIntent> => {
      const user = useAuthStore.getState().user;
      if (!user) throw new Error('Not authenticated');
      const items = input.items ?? [
        {
          type: 'addon' as const,
          code: input.addOnCode!,
          qty: input.qty ?? 1,
          branchId: input.branchId,
        },
      ];
      const r = await api.post('/v1/checkout/intent', {
        cart: { items },
        acceptedDocumentIds: input.acceptedDocumentIds,
        buyer: {
          email: user.email,
          name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email,
          // `phone` isn't on the auth-store User type but is present on the
          // hydrated profile (same cast the hardware-store checkout uses).
          phone: (user as { phone?: string }).phone ?? '',
        },
        // PayTR bounces the buyer back here after the hosted page closes; the
        // product lands on the Licence page once the webhook provisions it.
        returnUrl: `${window.location.origin}/admin/license`,
      });
      return r.data;
    },
    onSuccess: (data) => {
      // Provisioning itself happens later (async, off the `CK-` webhook once
      // PayTR settles) so this won't flip `includedInPlan`/ownership by
      // itself — but invalidate anyway so any catalog view still mounted
      // when the buyer returns via `returnUrl` refetches instead of serving
      // a stale pre-purchase snapshot from cache.
      qc.invalidateQueries({ queryKey: marketplaceKeys.catalogAll });
      // Full-page hand-off to PayTR's hosted page — the iframe owns the tab.
      if (data.paymentLink) window.location.assign(data.paymentLink);
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
      // DEF-10: cancelling doesn't change `includedInPlan` (that's plan-
      // derived), but it does change ownership, which the catalog views'
      // "owned" state also depends on — refetch so a re-buyable add-on
      // doesn't linger looking unavailable from a stale cache.
      qc.invalidateQueries({ queryKey: marketplaceKeys.catalogAll });
      qc.invalidateQueries({ queryKey: entitlementKeys.me });
      qc.invalidateQueries({ queryKey: ['subscriptions', 'effective-features'] });
      toast.success(
        i18n.t('marketplace:cancel.success', { defaultValue: 'Add-on cancelled.' }),
      );
    },
    onError: (e) =>
      toast.error(
        getApiErrorMessage(
          e,
          i18n.t('marketplace:cancel.failed', { defaultValue: 'Cancellation failed' }),
        ),
      ),
  });
};
