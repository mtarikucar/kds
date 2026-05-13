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
    deliveryIntegration: boolean;
  };
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanType, PlanConfig> = {
  [SubscriptionPlanType.FREE]: {
    name: SubscriptionPlanType.FREE,
    displayName: 'Ücretsiz',
    description: 'Yeni başlayan küçük restoranlar için',
    monthlyPrice: 0,
    yearlyPrice: 0,
    currency: 'TRY',
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
      deliveryIntegration: false,
    },
  },
  [SubscriptionPlanType.BASIC]: {
    name: SubscriptionPlanType.BASIC,
    displayName: 'Başlangıç',
    description: 'Büyüyen restoranlar için ideal',
    // TRY prices are KDV-inclusive (advertised gross). BillingService
    // reverse-engineers the KDV split when issuing invoices.
    monthlyPrice: 299,
    yearlyPrice: 2990,
    currency: 'TRY',
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
      deliveryIntegration: false,
    },
  },
  [SubscriptionPlanType.PRO]: {
    name: SubscriptionPlanType.PRO,
    displayName: 'Profesyonel',
    description: 'Çok şubeli yerleşik restoranlar için',
    monthlyPrice: 799,
    yearlyPrice: 7990,
    currency: 'TRY',
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
      deliveryIntegration: true,
    },
  },
  [SubscriptionPlanType.BUSINESS]: {
    name: SubscriptionPlanType.BUSINESS,
    displayName: 'Kurumsal',
    description: 'Büyük restoran zincirleri için kurumsal çözüm',
    monthlyPrice: 1999,
    yearlyPrice: 19990,
    currency: 'TRY',
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
      deliveryIntegration: true,
    },
  },
};

// Helper function to check if a limit is unlimited
export const isUnlimited = (limit: number): boolean => limit === -1;

// Helper function to get plan by name
export const getPlanConfig = (planName: SubscriptionPlanType): PlanConfig => {
  return SUBSCRIPTION_PLANS[planName];
};
