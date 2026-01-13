import { createContext, useContext, useMemo, ReactNode } from 'react';
import {
  useGetCurrentSubscription,
  useGetPlans,
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
  isSubscriptionActive: boolean;
}

// Create context with default values
const SubscriptionContext = createContext<SubscriptionContextType>({
  subscription: null,
  plan: null,
  isLoading: true,
  hasFeature: () => false,
  checkLimit: () => ({ allowed: false, current: 0, limit: 0, remaining: 0 }),
  isSubscriptionActive: false,
});

// Provider component
interface SubscriptionProviderProps {
  children: ReactNode;
}

export const SubscriptionProvider = ({ children }: SubscriptionProviderProps) => {
  const { data: subscription, isLoading: subLoading } = useGetCurrentSubscription();
  const { data: plans, isLoading: plansLoading } = useGetPlans();

  const isLoading = subLoading || plansLoading;

  // Find the current plan from plans list
  const plan = useMemo(() => {
    if (!subscription || !plans) return null;
    return plans.find((p) => p.id === subscription.planId) || null;
  }, [subscription, plans]);

  // Check if a feature is enabled in the current plan
  const hasFeature = (feature: keyof PlanFeatures): boolean => {
    if (!plan) return false;
    return plan.features[feature] ?? false;
  };

  // Check if a resource limit allows creating more items
  const checkLimit = (resource: keyof PlanLimits, currentCount: number): LimitCheckResult => {
    if (!plan) {
      return { allowed: false, current: currentCount, limit: 0, remaining: 0 };
    }

    const limit = plan.limits[resource];

    // -1 means unlimited
    if (limit === -1) {
      return { allowed: true, current: currentCount, limit: -1, remaining: Infinity };
    }

    const remaining = Math.max(0, limit - currentCount);
    const allowed = currentCount < limit;

    return { allowed, current: currentCount, limit, remaining };
  };

  // Check if subscription is active (ACTIVE or TRIALING status)
  const isSubscriptionActive = useMemo(() => {
    if (!subscription) return false;
    return subscription.status === 'ACTIVE' || subscription.status === 'TRIALING';
  }, [subscription]);

  const value = useMemo(
    () => ({
      subscription: subscription ?? null,
      plan,
      isLoading,
      hasFeature,
      checkLimit,
      isSubscriptionActive,
    }),
    [subscription, plan, isLoading, isSubscriptionActive]
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
