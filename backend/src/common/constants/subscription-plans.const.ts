import { SubscriptionPlanType } from "./subscription.enum";

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
    maxBranches: number;
    maxProducts: number;
    maxCategories: number;
    maxMonthlyOrders: number;
    maxMonthlyAiPhotos: number;
    maxMonthlyAiVideos: number;
  };
  features: {
    advancedReports: boolean;
    multiLocation: boolean;
    customBranding: boolean;
    apiAccess: boolean;
    externalDisplay: boolean;
    prioritySupport: boolean;
    inventoryTracking: boolean;
    kdsIntegration: boolean;
    reservationSystem: boolean;
    personnelManagement: boolean;
    deliveryIntegration: boolean;
    posAccess: boolean;
    aiContentGeneration: boolean;
  };
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanType, PlanConfig> = {
  // Onboarding-trial redesign: the dedicated non-purchasable onboarding plan
  // every new tenant starts on (7-day full premium). FREE below is a retired
  // tombstone (kept only because the enum value still exists).
  [SubscriptionPlanType.TRIAL]: {
    name: SubscriptionPlanType.TRIAL,
    displayName: "Deneme",
    description: "7 günlük tam özellikli onboarding denemesi",
    monthlyPrice: 0,
    yearlyPrice: 0,
    currency: "TRY",
    trialDays: 7,
    limits: {
      maxUsers: -1,
      maxTables: -1,
      maxBranches: -1,
      maxProducts: -1,
      maxCategories: -1,
      maxMonthlyOrders: -1,
      // AI taster: deliberately capped (not -1) — generations cost real
      // money per unit; trial gets a taste, not the fal.ai bill.
      maxMonthlyAiPhotos: 3,
      maxMonthlyAiVideos: 1,
    },
    features: {
      advancedReports: true,
      multiLocation: true,
      customBranding: true,
      apiAccess: true,
      externalDisplay: true,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: true,
      personnelManagement: true,
      deliveryIntegration: true,
      posAccess: true,
      aiContentGeneration: true,
    },
  },
  [SubscriptionPlanType.FREE]: {
    name: SubscriptionPlanType.FREE,
    displayName: "Ücretsiz",
    description: "Deneme sürümü sona erdiğinde kullanılan kısıtlı plan",
    monthlyPrice: 0,
    yearlyPrice: 0,
    currency: "TRY",
    trialDays: 0,
    limits: {
      maxUsers: 2,
      maxTables: 5,
      maxBranches: 1,
      maxProducts: 25,
      maxCategories: 5,
      maxMonthlyOrders: 50,
      maxMonthlyAiPhotos: 0,
      maxMonthlyAiVideos: 0,
    },
    features: {
      advancedReports: false,
      multiLocation: false,
      customBranding: false,
      apiAccess: false,
      externalDisplay: false,
      prioritySupport: false,
      inventoryTracking: false,
      kdsIntegration: true,
      reservationSystem: false,
      personnelManagement: false,
      deliveryIntegration: false,
      posAccess: false,
      aiContentGeneration: false,
    },
  },
  [SubscriptionPlanType.BASIC]: {
    name: SubscriptionPlanType.BASIC,
    displayName: "Başlangıç",
    description: "Kafe ve küçük restoranlar için temel POS + stok takibi",
    // TRY prices are KDV-inclusive (advertised gross). BillingService
    // reverse-engineers the KDV split when issuing invoices.
    monthlyPrice: 499,
    yearlyPrice: 4490,
    currency: "TRY",
    trialDays: 14,
    limits: {
      maxUsers: 5,
      maxTables: 20,
      maxBranches: 1,
      maxProducts: 100,
      maxCategories: 20,
      maxMonthlyOrders: 500,
      // AI is PRO+ — Başlangıç has no generation allowance.
      maxMonthlyAiPhotos: 0,
      maxMonthlyAiVideos: 0,
    },
    features: {
      advancedReports: false,
      multiLocation: false,
      customBranding: false,
      apiAccess: false,
      externalDisplay: false,
      prioritySupport: false,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: false,
      personnelManagement: false,
      deliveryIntegration: false,
      posAccess: true,
      aiContentGeneration: false,
    },
  },
  [SubscriptionPlanType.PRO]: {
    name: SubscriptionPlanType.PRO,
    displayName: "Profesyonel",
    description:
      "Şehir merkezi restoranlar için rezervasyon + delivery + personel takibi",
    monthlyPrice: 1299,
    yearlyPrice: 12990,
    currency: "TRY",
    trialDays: 14,
    limits: {
      maxUsers: 15,
      maxTables: 50,
      maxBranches: 3,
      maxProducts: 500,
      maxCategories: 50,
      maxMonthlyOrders: 2000,
      // Cost-calibrated 2026-07: photo ≈ $0.03, 5s Kling video ≈ $0.42.
      // 50/5 caps the worst-case fal.ai bill at ~12% of the plan price.
      maxMonthlyAiPhotos: 50,
      maxMonthlyAiVideos: 5,
    },
    features: {
      advancedReports: true,
      multiLocation: true,
      customBranding: true,
      apiAccess: false,
      externalDisplay: false,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: true,
      personnelManagement: true,
      deliveryIntegration: true,
      posAccess: true,
      aiContentGeneration: true,
    },
  },
  [SubscriptionPlanType.BUSINESS]: {
    name: SubscriptionPlanType.BUSINESS,
    displayName: "Kurumsal",
    description:
      "Çok şubeli zincirler için sınırsız + API erişimi + öncelikli destek",
    monthlyPrice: 2999,
    yearlyPrice: 29990,
    currency: "TRY",
    trialDays: 14,
    limits: {
      maxUsers: -1, // unlimited
      maxTables: -1,
      maxBranches: -1,
      maxProducts: -1,
      maxCategories: -1,
      maxMonthlyOrders: -1,
      // NOT -1: every other Kurumsal limit is unlimited, but AI generations
      // have a hard per-unit vendor cost — 200/20 caps the worst-case
      // fal.ai bill at ~22% of the plan price.
      maxMonthlyAiPhotos: 200,
      maxMonthlyAiVideos: 20,
    },
    features: {
      advancedReports: true,
      multiLocation: true,
      customBranding: true,
      apiAccess: true,
      externalDisplay: true,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: true,
      personnelManagement: true,
      deliveryIntegration: true,
      posAccess: true,
      aiContentGeneration: true,
    },
  },
};

// Helper function to check if a limit is unlimited
export const isUnlimited = (limit: number): boolean => limit === -1;

// Helper function to get plan by name
export const getPlanConfig = (planName: SubscriptionPlanType): PlanConfig => {
  return SUBSCRIPTION_PLANS[planName];
};
