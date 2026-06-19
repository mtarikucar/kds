export enum SubscriptionPlanType {
  // TRIAL is the dedicated, non-purchasable onboarding plan every new tenant
  // starts on (7-day full-premium trial). It decouples the trial from any paid
  // tier — the old design ran the trial ON the BUSINESS plan, which coupled
  // signup to BUSINESS.trialDays and caused silent TRIALING(BUSINESS)→FREE
  // transitions.
  TRIAL = "TRIAL",
  BASIC = "BASIC",
  PRO = "PRO",
  BUSINESS = "BUSINESS",
  // FREE retired (onboarding-trial redesign) — kept as a tombstone so legacy
  // references still compile, but no FREE plan row is seeded/active and nothing
  // lands on it. New tenants start on TRIAL and must pick a paid plan at expiry.
  FREE = "FREE",
}

export enum SubscriptionStatus {
  ACTIVE = "ACTIVE",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
  PAST_DUE = "PAST_DUE",
  TRIALING = "TRIALING",
  // Onboarding trial ended without a paid subscription. The tenant is LOCKED:
  // PlanFeatureGuard + the global SubscriptionStatusGuard treat this as
  // not-live, so the app is gated to the plan-selection + checkout flow until a
  // paid plan is activated. Replaces the old silent trial→FREE downgrade.
  TRIAL_ENDED = "TRIAL_ENDED",
  // Pre-activation state used between PayTR intent creation and webhook
  // confirmation. PENDING subscriptions don't grant feature access and
  // don't appear in the partial-unique (tenantId) WHERE status IN
  // (ACTIVE, TRIALING) index, so a tenant may have at most one in flight.
  PENDING = "PENDING",
}

export enum BillingCycle {
  MONTHLY = "MONTHLY",
  YEARLY = "YEARLY",
}

// Active provider list. Add new entries (e.g. STRIPE) when wiring an
// additional payments-adapter; PaymentsService dispatches by this enum
// so a single switch entry is enough to plug a new processor in.
export enum PaymentProvider {
  PAYTR = "PAYTR",
  // Manual bank transfer (havale/EFT) — used for non-TRY plans (PayTR only
  // collects TRY) and as an alternative method on TRY plans. Activated by
  // superadmin confirmation, not a webhook.
  BANK_TRANSFER = "BANK_TRANSFER",
}

export enum PaymentStatus {
  PENDING = "PENDING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  REFUNDED = "REFUNDED",
}

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  OPEN = "OPEN",
  PAID = "PAID",
  VOID = "VOID",
  UNCOLLECTIBLE = "UNCOLLECTIBLE",
}

export enum PlanFeature {
  ADVANCED_REPORTS = "advancedReports",
  MULTI_LOCATION = "multiLocation",
  CUSTOM_BRANDING = "customBranding",
  API_ACCESS = "apiAccess",
  PRIORITY_SUPPORT = "prioritySupport",
  INVENTORY_TRACKING = "inventoryTracking",
  KDS_INTEGRATION = "kdsIntegration",
  RESERVATION_SYSTEM = "reservationSystem",
  PERSONNEL_MANAGEMENT = "personnelManagement",
  DELIVERY_INTEGRATION = "deliveryIntegration",
  POS_ACCESS = "posAccess",
}

export enum TenantStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  DELETED = "DELETED",
}
