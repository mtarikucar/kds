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
  // Pre-activation state used between PayTR intent creation and webhook
  // confirmation. PENDING subscriptions don't grant feature access and
  // don't appear in the partial-unique (tenantId) WHERE status IN
  // (ACTIVE, TRIALING) index, so a tenant may have at most one in flight.
  PENDING = 'PENDING',
}

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

// Active provider list. Add new entries (e.g. STRIPE) when wiring an
// additional payments-adapter; PaymentsService dispatches by this enum
// so a single switch entry is enough to plug a new processor in.
export enum PaymentProvider {
  PAYTR = 'PAYTR',
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
  RESERVATION_SYSTEM = 'reservationSystem',
  PERSONNEL_MANAGEMENT = 'personnelManagement',
  DELIVERY_INTEGRATION = 'deliveryIntegration',
}

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}
