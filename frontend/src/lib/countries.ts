/**
 * Countries the platform actually supports for a tenant's own country
 * (Tenant.countryCode) — mirrors backend COUNTRY_PROFILES
 * (backend/src/common/country/country-profile.const.ts). The frontend
 * cannot import backend source (separate Docker build contexts —
 * docker-compose.prod.yml), so this list is hand-mirrored;
 * scripts/check-contract-drift.mjs enforces the two stay in lockstep.
 *
 * Do NOT render a full ISO-3166 list in a country selector built from this
 * — a code with no backend profile resolves to DEFAULT_COUNTRY server-side
 * and would silently mislead the operator into thinking they picked
 * something else.
 */
export const SUPPORTED_COUNTRY_CODES = ['TR', 'UZ'] as const;

export type SupportedCountryCode = (typeof SUPPORTED_COUNTRY_CODES)[number];

/** Mirrors backend DEFAULT_COUNTRY. */
export const DEFAULT_COUNTRY_CODE: SupportedCountryCode = 'TR';

export function isSupportedCountryCode(
  code: string | undefined | null,
): code is SupportedCountryCode {
  return (
    !!code &&
    (SUPPORTED_COUNTRY_CODES as readonly string[]).includes(code)
  );
}
