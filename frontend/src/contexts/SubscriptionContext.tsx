import { createContext, useContext, ReactNode, useMemo } from 'react';
import {
  LicenseState,
  LicensingSnapshot,
  Offer,
  OwnedProduct,
  RenewalSummary,
  useLicensing,
} from '../features/licensing/licensingApi';

/**
 * Entitlement + licence state for the authenticated shell.
 *
 * Backed by ONE request (`GET /v1/me/licensing`) instead of the three the app
 * used to make. The important part is not the round trips: the snapshot also
 * carries the CURRENT PRICE of every purchasable capability, so an upsell and
 * the checkout it leads to quote the same number. The previous implementation
 * derived upsell copy from a hardcoded feature→plan table in the frontend —
 * a second source of pricing truth that nothing kept in sync with the catalog,
 * and one that could only ever say "upgrade to PRO".
 *
 * The file keeps its name and its `useSubscription()` export so the ~25
 * consumers migrate by rename rather than in this commit.
 */

export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
}

interface EntitlementContextType {
  isLoading: boolean;
  /** Accepts a bare name ("posAccess") or a prefixed key. */
  hasFeature: (feature: string) => boolean;
  hasIntegration: (domain: string, vendor?: string) => boolean;
  checkLimit: (resource: string, currentCount: number) => LimitCheckResult;
  license: LicenseState;
  credits: Record<string, number>;
  owned: OwnedProduct[];
  renewal: RenewalSummary | null;
  /** The cheapest product granting `key`, priced for this tenant today. */
  offerFor: (key: string) => Offer | null;
  snapshot: LicensingSnapshot | null;
}

const NO_LICENSE: LicenseState = {
  status: 'none',
  anchorAt: null,
  anniversaryAt: null,
  daysRemaining: null,
};

const EntitlementContext = createContext<EntitlementContextType>({
  isLoading: true,
  hasFeature: () => false,
  hasIntegration: () => false,
  checkLimit: () => ({ allowed: false, current: 0, limit: 0, remaining: 0 }),
  license: NO_LICENSE,
  credits: {},
  owned: [],
  renewal: null,
  offerFor: () => null,
  snapshot: null,
});

/** `posAccess` and `feature.posAccess` both resolve. */
const prefixed = (key: string, ns: 'feature' | 'limit' | 'integration') =>
  key.startsWith(`${ns}.`) ? key : `${ns}.${key}`;

export const SubscriptionProvider = ({ children }: { children: ReactNode }) => {
  const { data, isLoading } = useLicensing();

  const value = useMemo<EntitlementContextType>(() => {
    const ent = data?.entitlements;

    return {
      isLoading,

      // FAIL CLOSED while loading or on error. Deliberate (deep-review FL2):
      // flashing a gated screen and then yanking it away is worse than a
      // moment of nothing, and there is no safe fallback source — the folded
      // set is the only thing that knows about suppression overrides.
      hasFeature: (feature) =>
        ent ? ent.features[prefixed(feature, 'feature')] === true : false,

      hasIntegration: (domain, vendor) => {
        const vendors = ent?.integrations?.[prefixed(domain, 'integration')];
        if (!Array.isArray(vendors) || vendors.length === 0) return false;
        if (vendors.includes('*')) return true;
        return vendor ? vendors.includes(vendor) : true;
      },

      checkLimit: (resource, currentCount) => {
        const limit = ent?.limits?.[prefixed(resource, 'limit')];
        if (limit === undefined || limit === null) {
          return { allowed: false, current: currentCount, limit: 0, remaining: 0 };
        }
        if (limit === -1) {
          return {
            allowed: true,
            current: currentCount,
            limit: -1,
            remaining: Infinity,
          };
        }
        return {
          allowed: currentCount < limit,
          current: currentCount,
          limit,
          remaining: Math.max(0, limit - currentCount),
        };
      },

      license: data?.license ?? NO_LICENSE,
      credits: data?.credits ?? {},
      owned: data?.owned ?? [],
      renewal: data?.renewal ?? null,

      offerFor: (key) => {
        if (!data?.offers) return null;
        return (
          data.offers[key] ??
          data.offers[prefixed(key, 'feature')] ??
          data.offers[prefixed(key, 'limit')] ??
          data.offers[prefixed(key, 'integration')] ??
          null
        );
      },

      snapshot: data ?? null,
    };
  }, [data, isLoading]);

  return (
    <EntitlementContext.Provider value={value}>
      {children}
    </EntitlementContext.Provider>
  );
};

/** Primary hook. */
export const useEntitlements = () => useContext(EntitlementContext);

/** @deprecated Renamed to useEntitlements; kept so consumers migrate gradually. */
export const useSubscription = useEntitlements;

export const useFeatureEnabled = (feature: string): boolean =>
  useEntitlements().hasFeature(feature);

export const useLimitCheck = (
  resource: string,
  currentCount: number,
): LimitCheckResult => useEntitlements().checkLimit(resource, currentCount);
