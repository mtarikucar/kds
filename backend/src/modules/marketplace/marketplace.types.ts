// Shape of a marketplace add-on's `grants` JSON. Kept here so the catalog
// service, the projector, and the admin DTOs all agree.

export interface AddOnGrants {
  [key: string]: boolean | number | string[];
}

export type AddOnKind = "software" | "integration" | "capacity" | "support";
export type AddOnBilling = "recurring" | "oneTime";
export type AddOnStatus = "draft" | "published" | "archived";
export type TenantAddOnStatus = "active" | "past_due" | "cancelled" | "expired";

/**
 * Manual-renewal grace window for recurring add-ons, in days. Mirrors the
 * Subscription PAST_DUE → EXPIRED grace (hardcoded 7 days in
 * SubscriptionSchedulerService.handlePastDueSubscriptions). A recurring
 * add-on whose period ends without re-payment goes `past_due` and keeps its
 * entitlement for this many days, then `expired` (entitlement revoked).
 * Shared by TenantAddOnSweeperService (the lifecycle driver) and
 * PlanProjectorService (extends the grace grant's validUntil to match).
 */
export const ADDON_GRACE_DAYS = 7;
