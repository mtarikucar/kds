import { SubscriptionPlanType } from './subscription.enum';

export interface PlanConfig {
  name: SubscriptionPlanType;
  displayName: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  trialDays: number;
  limits: {
    maxUsers: number;
    maxTables: number;
    maxProducts: number;
    maxCategories: number;
    maxMonthlyOrders: number;
  };
  features: {
    advancedReports: boolean;
    multiLocation: boolean;
    customBranding: boolean;
    apiAccess: boolean;
    prioritySupport: boolean;
    inventoryTracking: boolean;
    kdsIntegration: boolean;
    reservationSystem: boolean;
    personnelManagement: boolean;
  };
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanType, PlanConfig> = {
  [SubscriptionPlanType.FREE]: {
    name: SubscriptionPlanType.FREE,
    displayName: 'Free Plan',
    description: 'Perfect for small restaurants getting started',
    monthlyPrice: 0,
    yearlyPrice: 0,
    currency: 'USD',
    trialDays: 0,
    limits: {
      maxUsers: 2,
      maxTables: 5,
      maxProducts: 25,
      maxCategories: 5,
      maxMonthlyOrders: 50,
    },
    features: {
      advancedReports: false,
      multiLocation: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      inventoryTracking: false,
      kdsIntegration: true,
      reservationSystem: false,
      personnelManagement: false,
    },
  },
  [SubscriptionPlanType.BASIC]: {
    name: SubscriptionPlanType.BASIC,
    displayName: 'Basic Plan',
    description: 'Great for growing restaurants',
    monthlyPrice: 29.99,
    yearlyPrice: 299.99,
    currency: 'USD',
    trialDays: 14,
    limits: {
      maxUsers: 5,
      maxTables: 20,
      maxProducts: 100,
      maxCategories: 20,
      maxMonthlyOrders: 500,
    },
    features: {
      advancedReports: false,
      multiLocation: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: false,
      personnelManagement: false,
    },
  },
  [SubscriptionPlanType.PRO]: {
    name: SubscriptionPlanType.PRO,
    displayName: 'Pro Plan',
    description: 'For established restaurants with multiple locations',
    monthlyPrice: 79.99,
    yearlyPrice: 799.99,
    currency: 'USD',
    trialDays: 14,
    limits: {
      maxUsers: 15,
      maxTables: 50,
      maxProducts: 500,
      maxCategories: 50,
      maxMonthlyOrders: 2000,
    },
    features: {
      advancedReports: true,
      multiLocation: true,
      customBranding: true,
      apiAccess: false,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: true,
      personnelManagement: true,
    },
  },
  [SubscriptionPlanType.BUSINESS]: {
    name: SubscriptionPlanType.BUSINESS,
    displayName: 'Business Plan',
    description: 'Enterprise solution for large restaurant chains',
    monthlyPrice: 199.99,
    yearlyPrice: 1999.99,
    currency: 'USD',
    trialDays: 14,
    limits: {
      maxUsers: -1, // unlimited
      maxTables: -1,
      maxProducts: -1,
      maxCategories: -1,
      maxMonthlyOrders: -1,
    },
    features: {
      advancedReports: true,
      multiLocation: true,
      customBranding: true,
      apiAccess: true,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: true,
      personnelManagement: true,
    },
  },
};

// Helper function to check if a limit is unlimited
export const isUnlimited = (limit: number): boolean => limit === -1;

// Helper function to get plan by name
export const getPlanConfig = (planName: SubscriptionPlanType): PlanConfig => {
  return SUBSCRIPTION_PLANS[planName];
};
