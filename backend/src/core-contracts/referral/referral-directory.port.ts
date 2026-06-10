/**
 * Referral resolution port. Resolves a public referral code to the marketer
 * who owns it, so CORE (payments / checkout) can snapshot referral attribution
 * onto the payment row at payment-intent creation.
 *
 * Direction is core → marketing, so MARKETING implements it
 * (ReferralDirectoryService under marketing/acl/). The interface + DI token
 * live in this neutral shared-kernel so neither feature module imports the
 * other's directory — payments → core-contracts ← marketing. At the Phase-5
 * split this file ships in the published contract package; the marketing impl
 * stays with the marketing service and core gets a network client.
 */
export const REFERRAL_DIRECTORY_PORT = Symbol("REFERRAL_DIRECTORY_PORT");

export interface ResolvedReferral {
  marketingUserId: string;
  /** The canonical stored code — echoed so callers snapshot the resolved value, not raw input. */
  referralCode: string;
}

export interface ReferralDirectoryPort {
  /** Returns null for unknown / inactive codes. Must NEVER throw on a bad code. */
  resolveReferralCode(code: string): Promise<ResolvedReferral | null>;
}
