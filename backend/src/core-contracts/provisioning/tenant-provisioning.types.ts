/**
 * Serializable contract for the Lead → Customer provisioning crossing.
 *
 * NO Prisma types leak across this boundary — every field is a primitive so
 * the in-process port (Phase 1) can later become an HTTP/gRPC client unchanged
 * (Phase 5 physical split). Owned by CORE (the provisioning bounded context);
 * marketing imports this contract but never a core implementation.
 */

export interface ProvisionTenantForLeadCommand {
  /** Idempotency anchor. A retry with the same leadId returns the same tenant. */
  leadId: string;
  /**
   * Caller-supplied idempotency key. Convention: `lead-convert:{leadId}`.
   * Persisted on the provisioning ledger so a replay is a no-op.
   */
  idempotencyKey: string;
  tenantName: string;
  admin: {
    email: string;
    firstName: string;
    lastName: string;
  };
  /**
   * The plan to provision, or null for a no-plan (FREE) conversion. `planId`
   * is resolved + validated by CORE (it owns SubscriptionPlan). The two
   * override fields carry the marketing-owned offer terms so core can compute
   * the final price/trial without marketing reading the plan:
   *   - amountOverride    = offer.customPrice ?? null  (null → use plan price)
   *   - trialDaysOverride = offer.trialDays   ?? null  (null → use plan trial)
   */
  plan: {
    planId: string;
    amountOverride: number | null;
    trialDaysOverride: number | null;
  } | null;
}

/** Plan facts returned so marketing can compute the SIGNUP commission without reading SubscriptionPlan. */
export interface ProvisionedPlanFacts {
  /** The plan's catalogue monthly price (commission basis). */
  monthlyPrice: number;
  /** Per-plan commission rate, already defaulted by core when the column is absent. */
  commissionRate: number;
  /** Plan code/name, e.g. 'PRO'. */
  planCode: string;
}

/**
 * A provisioning-ledger entry, returned for the marketing orphan-reconciliation
 * sweep (Step D). Pure read of the CORE ledger — marketing filters these
 * against its own leads to find conversions that provisioned but never
 * finalized (the no-2PC saga's failure window).
 */
export interface ProvisionedLeadRecord {
  leadId: string;
  tenantId: string;
  planFacts: ProvisionedPlanFacts | null;
}

/**
 * Display-oriented plan facts snapshotted onto a LeadOffer at create time
 * (Step E), so the offer stays self-contained once the plan FK is dropped and
 * the plan eventually lives in a separate DB. Marketing captures this via the
 * port instead of reading SubscriptionPlan.
 */
export interface PlanSnapshot {
  /** Plan code/name, e.g. 'PRO'. */
  planCode: string;
  /** Human display name, e.g. 'Profesyonel'. */
  planName: string;
  monthlyPrice: number;
  currency: string;
}

export interface ProvisionTenantForLeadResult {
  tenantId: string;
  adminUserId: string;
  /** null when no paid plan was provisioned. */
  subscriptionId: string | null;
  /** The subdomain core allocated. */
  subdomain: string;
  /**
   * Transient plaintext admin password for the welcome email. ONLY populated
   * when `created === true`; on an idempotent replay it is an empty string
   * (the password was already delivered on the first call). Never persisted
   * by marketing.
   */
  adminTempPassword: string;
  /** Plan facts for marketing's SIGNUP-commission computation. null if no plan. */
  planFacts: ProvisionedPlanFacts | null;
  /** false → idempotent replay (the tenant already existed for this lead). */
  created: boolean;
}

/**
 * Port-local error hierarchy — transport-neutral, NOT Nest HttpExceptions or
 * Prisma errors. The marketing caller maps these onto its own HTTP responses
 * (Conflict / BadRequest) so the two bounded contexts share no framework types.
 */
export class CoreProvisioningError extends Error {}

export class CoreProvisioningEmailInUseError extends CoreProvisioningError {
  constructor(public readonly email: string) {
    super("Admin email is already in use");
    this.name = "CoreProvisioningEmailInUseError";
  }
}

export class CoreProvisioningPlanInvalidError extends CoreProvisioningError {
  constructor(public readonly planId: string) {
    super("Plan not found or inactive");
    this.name = "CoreProvisioningPlanInvalidError";
  }
}

export class CoreProvisioningSubdomainError extends CoreProvisioningError {
  constructor() {
    super("Could not allocate a free subdomain");
    this.name = "CoreProvisioningSubdomainError";
  }
}
