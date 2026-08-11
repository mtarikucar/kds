import { ForbiddenException } from "@nestjs/common";

/**
 * What the tenant is missing, and what they can buy to fix it.
 */
export interface OfferSummary {
  code: string;
  name: string;
  /** license | module | integration | capacity | credit | service */
  kind: string;
  /** Catalog list price for a whole cycle, in kuruş. */
  annualPriceCents: number;
  /** What it would cost TODAY, day-prorated to the anniversary. */
  proratedCents: number;
  currency: string;
  /** ISO date the purchase would run to, or null for a one-time product. */
  periodEnd: string | null;
}

export interface EntitlementRequirementDetail {
  type: "feature" | "limit" | "integration";
  key: string;
  /** Limit requirements only. */
  usage?: number;
  cap?: number;
}

/**
 * A 403 that tells the client what to DO about it.
 *
 * Before v3.3.0 a gated route returned a bare "Feature not enabled:
 * advancedReports" and the SPA mapped it to an upsell using a hardcoded
 * feature→plan table (`featurePlanMap`). That table was a second source of
 * truth for pricing that nothing kept in sync with the catalog, and it could
 * only ever say "upgrade to PRO" — meaningless once products are sold
 * individually.
 *
 * Carrying the resolved offer on the error instead means the price the user is
 * shown is the price they will be charged, because both come from the same
 * catalog read. `reason` is what separates "you never bought this" (Buy) from
 * "this lapsed" (Renew) — a distinction that turns a dead end into one click.
 */
export class EntitlementRequiredException extends ForbiddenException {
  constructor(detail: {
    requirement: EntitlementRequirementDetail;
    offer: OfferSummary | null;
    /** True when the blocker is the missing licence itself, not the product. */
    licenseRequired: boolean;
    reason: "not_owned" | "lapsed";
    message?: string;
  }) {
    super({
      statusCode: 403,
      error: "Entitlement Required",
      errorCode: "ENTITLEMENT_REQUIRED",
      message:
        detail.message ??
        (detail.licenseRequired
          ? "Bu özellik için aktif bir lisans gerekiyor."
          : "Bu özellik hesabınızda etkin değil."),
      requirement: detail.requirement,
      offer: detail.offer,
      licenseRequired: detail.licenseRequired,
      reason: detail.reason,
    });
  }
}
