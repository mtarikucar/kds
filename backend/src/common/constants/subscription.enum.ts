// Billing enums.
//
// The product model is: a free, unlimited core, plus individually purchased
// annual products (the licence, modules, integrations, capacity) and one-time
// items (credit packs, on-site install). There are no packages, no tiers, no
// plans to pick and no trial period. What a tenant may DO is decided by the
// folded entitlement set (`feature.*` / `limit.*` / `integration.*`), which is
// what `EntitlementGuard` and `@RequiresFeature` read.
//
// Several enums below therefore describe LEGACY database rows rather than
// anything on sale. Their values are pinned by `subscription.enum.spec.ts`
// (value === name) and stored in Postgres, so they are edit-only-by-migration.

// Legacy plan-row discriminator. No plan is sold, offered or assigned any
// more; `SubscriptionService` still reads these names when it touches historic
// `SubscriptionPlan` / `Subscription` rows (e.g. excluding FREE rows from the
// paid-plan queries). Do not gate anything new on it — gate on entitlements.
export enum SubscriptionPlanType {
  TRIAL = "TRIAL",
  BASIC = "BASIC",
  PRO = "PRO",
  BUSINESS = "BUSINESS",
  FREE = "FREE",
}

export enum SubscriptionStatus {
  ACTIVE = "ACTIVE",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
  PAST_DUE = "PAST_DUE",
  TRIALING = "TRIALING",
  // Terminal state of the retired onboarding trial. It no longer locks
  // anything: v3.3.0 deleted SubscriptionStatusGuard because the core product
  // is free, and PlanFeatureGuard is now an alias over EntitlementGuard, which
  // reads grants and ignores subscription status entirely. Kept because
  // historic rows carry the value.
  TRIAL_ENDED = "TRIAL_ENDED",
  // Pre-activation state used between PayTR intent creation and webhook
  // confirmation. PENDING subscriptions don't grant feature access and
  // don't appear in the partial-unique (tenantId) WHERE status IN
  // (ACTIVE, TRIALING) index, so a tenant may have at most one in flight.
  PENDING = "PENDING",
}

// Legacy cadence column. The à-la-carte catalog carries its own cadence
// (`annual` | `oneTime`) and the pricer fail-closes on anything else, so
// MONTHLY survives only on historic rows — nothing is sold monthly.
export enum BillingCycle {
  MONTHLY = "MONTHLY",
  YEARLY = "YEARLY",
}

// Active provider list. PaymentsService dispatches by this enum, so wiring an
// additional payments adapter is a single switch entry plus a value here.
export enum PaymentProvider {
  // Card collection, TRY only. Every renewal is a fresh, manually initiated
  // checkout — there is no stored card and no automatic recurring charge.
  PAYTR = "PAYTR",
  // Manual bank transfer (havale/EFT) — the fallback when PayTR can't collect
  // (it only takes TRY) and an alternative method otherwise. Activated by
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

/**
 * The capability vocabulary — NOT a plan feature list.
 *
 * Each value is, verbatim, the suffix of an engine key: `ADVANCED_REPORTS` is
 * `"advancedReports"`, which prefixed is `"feature.advancedReports"`. That
 * identity is what lets `@RequiresFeature` be a thin alias over
 * `@RequireEntitlement`, and `entitlement-keys.spec.ts` pins it so the alias
 * can never resolve to a key nothing grants.
 *
 * A flag is granted either by the free baseline (`FREE_BASELINE_GRANTS`,
 * unconditional and forever) or by an annual catalog product the tenant holds;
 * the engine folds all sources with OR.
 */
export enum PlanFeature {
  // Paid module: advanced_reports.
  ADVANCED_REPORTS = "advancedReports",
  // Free core: the branch hub, picker and switcher. The paid part is the
  // SECOND branch (`extra_branch` capacity), not multi-branch itself.
  MULTI_LOCATION = "multiLocation",
  // Free core: own brand + own domain.
  CUSTOM_BRANDING = "customBranding",
  // Paid module: api_access.
  API_ACCESS = "apiAccess",
  // Paid module: priority_support.
  PRIORITY_SUPPORT = "prioritySupport",
  // Paid module: module_inventory.
  INVENTORY_TRACKING = "inventoryTracking",
  // Free core: the kitchen display.
  KDS_INTEGRATION = "kdsIntegration",
  // Paid module: module_reservations.
  RESERVATION_SYSTEM = "reservationSystem",
  // Paid module: module_personnel.
  PERSONNEL_MANAGEMENT = "personnelManagement",
  // Paid: set by any delivery-platform integration product. Which vendors are
  // connected lives in `integration.delivery`, not in this flag.
  DELIVERY_INTEGRATION = "deliveryIntegration",
  // Free core: the POS / tab screen. The baseline grants it to every tenant,
  // so the decorator is a no-op gate that always passes.
  POS_ACCESS = "posAccess",
  // Paid module: module_external_display (Partner Display API) —
  // third-party/remote screens (table tablets that replicate the QR menu).
  // Gates partner API-key issuance + screen-session minting.
  EXTERNAL_DISPLAY = "externalDisplay",
  // Paid module: module_ai_studio (photo/frame/video generation, Meshy 3D, OCR
  // menu import). Opens the surface; what can actually be spent is the prepaid
  // credit balance, which CreditService reads inside the locked claim
  // transaction and the projector deliberately keeps out of the engine.
  AI_CONTENT_GENERATION = "aiContentGeneration",
}

// Tenant lifecycle. Load-bearing on every authenticated request: JwtStrategy
// re-reads it live and 401s anything not ACTIVE. This — not any billing
// state — is the global lockout lever.
export enum TenantStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  DELETED = "DELETED",
}
