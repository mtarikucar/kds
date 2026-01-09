export enum SubscriptionPlanType {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PRO = 'PRO',
  BUSINESS = 'BUSINESS',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  PAST_DUE = 'PAST_DUE',
  TRIALING = 'TRIALING',
}

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum PaymentProvider {
  PAYTR = 'PAYTR',
  EMAIL = 'EMAIL',
}

export enum PaymentRegion {
  TURKEY = 'TURKEY',
  INTERNATIONAL = 'INTERNATIONAL',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  PAID = 'PAID',
  VOID = 'VOID',
  UNCOLLECTIBLE = 'UNCOLLECTIBLE',
}

export enum PlanFeature {
  ADVANCED_REPORTS = 'advancedReports',
  MULTI_LOCATION = 'multiLocation',
  CUSTOM_BRANDING = 'customBranding',
  API_ACCESS = 'apiAccess',
  PRIORITY_SUPPORT = 'prioritySupport',
  INVENTORY_TRACKING = 'inventoryTracking',
  KDS_INTEGRATION = 'kdsIntegration',
}

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}
