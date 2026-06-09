import type {
  ProvisionTenantForLeadCommand,
  ProvisionTenantForLeadResult,
  ProvisionedLeadRecord,
  PlanSnapshot,
} from "./tenant-provisioning.types";

/** DI token for the core-owned tenant provisioning port. */
export const CORE_PROVISIONING_PORT = Symbol("CORE_PROVISIONING_PORT");

/**
 * The inversion seam for business-event #1 (Lead → Customer conversion).
 *
 * Marketing calls this port instead of writing tenant/user/subscription rows
 * itself, so the core-write coupling lives entirely on the CORE side of a
 * contract. Implemented in-process today by TenantProvisioningService; at the
 * physical split it becomes a network client and marketing is unaffected.
 */
export interface CoreProvisioningPort {
  /**
   * Provision tenant + admin user + (optional) subscription for a converting
   * lead. Synchronous — conversion is user-initiated and the caller needs the
   * tenant id in the HTTP response. Idempotent on `command.leadId`: a retry
   * returns the already-provisioned tenant instead of minting a second one.
   *
   * Throws CoreProvisioning* errors (transport-neutral) — never a raw Prisma
   * or Nest exception — so callers in another bounded context stay decoupled.
   */
  provisionTenantForLead(
    command: ProvisionTenantForLeadCommand,
  ): Promise<ProvisionTenantForLeadResult>;

  /**
   * List provisioning-ledger entries created in [createdAfter, createdBefore],
   * for the marketing orphan-reconciliation sweep. Pure read of the CORE ledger
   * (no marketing join) — marketing filters the results against its own leads
   * to finalize conversions that provisioned but never committed their
   * marketing-side state.
   */
  listProvisionedLeads(
    createdAfter: Date,
    createdBefore: Date,
  ): Promise<ProvisionedLeadRecord[]>;

  /**
   * Read a plan's display facts so marketing can snapshot them onto a LeadOffer
   * at create time (Step E) without reading SubscriptionPlan. Returns null for
   * an unknown plan.
   */
  describePlan(planId: string): Promise<PlanSnapshot | null>;
}
