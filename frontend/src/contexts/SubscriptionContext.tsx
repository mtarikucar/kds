import { createContext, useContext, useMemo, ReactNode } from 'react';
import {
  useGetCurrentSubscription,
  useGetPlans,
  useGetEffectiveFeatures,
} from '../features/subscriptions/subscriptionsApi';
import { Plan, PlanFeatures, PlanLimits, Subscription } from '../types';

// Limit check result interface
interface LimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
}

// Context interface
interface SubscriptionContextType {
  subscription: Subscription | null;
  plan: Plan | null;
  isLoading: boolean;
  hasFeature: (feature: keyof PlanFeatures) => boolean;
  checkLimit: (resource: keyof PlanLimits, currentCount: number) => LimitCheckResult;
  /**
   * v2.8.88 — integration grants from the entitlement engine (plan +
   * TenantAddOn). Domains like `delivery`, `fiscal`, `caller`; values
   * are vendor lists (`['yemeksepeti', 'getir']`).
   *
   * `vendor` undefined → "any vendor in this domain present?"
   * `vendor` given     → "is this exact vendor in the domain?"
   *
   * Pre-v2.8.88 this concept didn't exist on the frontend at all —
   * the only signal was the flat `feature.deliveryIntegration: true`
   * boolean, which couldn't distinguish "tenant has yemeksepeti" from
   * "tenant has getir". The integrations map enables per-vendor UI.
   */
  hasIntegration: (domain: string, vendor?: string) => boolean;
  /** ACTIVE or TRIALING — full paid access. */
  isSubscriptionActive: boolean;
  /**
   * PAST_DUE — 7-day grace period after trial expiry / failed renewal.
   * Backend `PlanFeatureGuard` still grants feature access here, so the
   * UI should show a "renew now" banner without locking the user out.
   */
  isInGracePeriod: boolean;
}

// Create context with default values
const SubscriptionContext = createContext<SubscriptionContextType>({
  subscription: null,
  plan: null,
  isLoading: true,
  hasFeature: () => false,
  checkLimit: () => ({ allowed: false, current: 0, limit: 0, remaining: 0 }),
  hasIntegration: () => false,
  isSubscriptionActive: false,
  isInGracePeriod: false,
});

// Provider component
interface SubscriptionProviderProps {
  children: ReactNode;
}

export const SubscriptionProvider = ({ children }: SubscriptionProviderProps) => {
  const { data: subscription, isLoading: subLoading } = useGetCurrentSubscription();
  const { data: plans, isLoading: plansLoading } = useGetPlans();
  const { data: effectiveFeatures } = useGetEffectiveFeatures();

  const isLoading = subLoading || plansLoading;

  // Find the current plan from plans list
  const plan = useMemo(() => {
    if (!subscription || !plans) return null;
    return plans.find((p) => p.id === subscription.planId) || null;
  }, [subscription, plans]);

  // Check if a feature is enabled (effective features = plan + overrides)
  const hasFeature = (feature: keyof PlanFeatures): boolean => {
    // Use effective features if available (includes overrides)
    if (effectiveFeatures) {
      return effectiveFeatures.features[feature] ?? false;
    }
    // Fallback to plan data while effective features are loading
    if (!plan) return false;
    return plan.features[feature] ?? false;
  };

  // Check if a resource limit allows creating more items (effective limits = plan + overrides)
  const checkLimit = (resource: keyof PlanLimits, currentCount: number): LimitCheckResult => {
    // Use effective limits if available (includes overrides)
    const limit = effectiveFeatures
      ? effectiveFeatures.limits[resource]
      : plan?.limits[resource];

    if (limit === undefined || limit === null) {
      return { allowed: false, current: currentCount, limit: 0, remaining: 0 };
    }

    // -1 means unlimited
    if (limit === -1) {
      return { allowed: true, current: currentCount, limit: -1, remaining: Infinity };
    }

    const remaining = Math.max(0, limit - currentCount);
    const allowed = currentCount < limit;

    return { allowed, current: currentCount, limit, remaining };
  };

  // v2.8.88 — integration grants. Engine surfaces them as
  // `effectiveFeatures.integrations.<domain> = [...vendors]`.
  const hasIntegration = (domain: string, vendor?: string): boolean => {
    const integrations = (effectiveFeatures as any)?.integrations as
      | Record<string, string[]>
      | undefined;
    const vendors = integrations?.[domain];
    if (!Array.isArray(vendors) || vendors.length === 0) return false;
    if (!vendor) return true;
    return vendors.includes(vendor);
  };

  // Check if subscription is active (ACTIVE or TRIALING status)
  const isSubscriptionActive = useMemo(() => {
    if (!subscription) return false;
    return subscription.status === 'ACTIVE' || subscription.status === 'TRIALING';
  }, [subscription]);

  // PAST_DUE — backend grants 7-day feature access while the user
  // is expected to renew. UI surfaces this as a banner, not a lockout.
  const isInGracePeriod = useMemo(() => {
    return subscription?.status === 'PAST_DUE';
  }, [subscription]);

  const value = useMemo(
    () => ({
      subscription: subscription ?? null,
      plan,
      isLoading,
      hasFeature,
      checkLimit,
      hasIntegration,
      isSubscriptionActive,
      isInGracePeriod,
    }),
    [subscription, plan, isLoading, isSubscriptionActive, isInGracePeriod, effectiveFeatures]
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};

// Custom hook to use subscription context
export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
};

// Helper hook to check if a specific feature is enabled
export const useFeatureEnabled = (feature: keyof PlanFeatures): boolean => {
  const { hasFeature } = useSubscription();
  return hasFeature(feature);
};

// Helper hook to check limits for a resource
export const useLimitCheck = (resource: keyof PlanLimits, currentCount: number): LimitCheckResult => {
  const { checkLimit } = useSubscription();
  return checkLimit(resource, currentCount);
};

export default SubscriptionContext;
