import type { ResolvedReferral } from "./referral-directory.port";

/**
 * HTTP wire contract for {@link ReferralDirectoryPort} after the Phase-5
 * physical split (core → marketing direction). Vendored shared-kernel file:
 * the copies under `backend/src/core-contracts/` and
 * `kds-marketing/backend/src/core-contracts/` MUST stay byte-identical.
 *
 * Route is RELATIVE (no global `api` prefix): clients compose
 * `${baseUrl}/api/${ROUTE}`. Auth: INTERNAL_TOKEN_HEADER (see
 * ../internal-http.contract). Always POST + JSON, always 200 with the
 * envelope below — an unknown/inactive code is `resolved: null`, never an
 * error (the port contract says resolveReferralCode must NEVER throw on a
 * bad code).
 */
export const INTERNAL_REFERRAL_BASE = "internal/referral";

export const INTERNAL_REFERRAL_RESOLVE_SEGMENT = "resolve";

export const INTERNAL_REFERRAL_RESOLVE_ROUTE = `${INTERNAL_REFERRAL_BASE}/${INTERNAL_REFERRAL_RESOLVE_SEGMENT}`;

/** POST resolve request body. */
export interface ResolveReferralRequest {
  code: string;
}

/**
 * 200 response — ALWAYS this envelope. Wrapped so a null result is
 * distinguishable from an empty body.
 */
export interface ResolveReferralResponse {
  resolved: ResolvedReferral | null;
}
