import { resolveCountryProfile } from "./country.service";

/**
 * Task 12. Which countries THIS PROCESS serves is a deployment fact, not a
 * tenant fact: it has to be knowable at boot, before any tenant is known
 * and before the DB is even reachable (env-validation.ts runs before Nest,
 * before Prisma connects). Asking "which countries have tenants" would make
 * boot depend on the DB and would break production the instant the first
 * tenant of a new country is created. `DEPLOYMENT_COUNTRIES` — comma-
 * separated ISO-3166-1 alpha-2 codes, default `"TR"` — is that fact, set
 * once by whoever configures the environment.
 *
 * This is the ONLY place that parses it. Two independent call sites need
 * the answer to "which providers does this deployment actually need
 * credentials for", each too early or too differently-scoped to share a
 * single call:
 *
 *  - env-validation.ts (common/helpers) reads `paymentProviderIds` to
 *    decide whether PAYTR_* is required — runs pre-DI, at raw process
 *    boot.
 *  - SmsService.onApplicationBootstrap() (modules/customers) reads
 *    `smsProviderIds` to decide whether "no SMS provider registered
 *    anywhere in this process" is actually a misconfiguration worth
 *    refusing to boot over, or a deployment that structurally has no use
 *    for one yet (UZ today) — runs post-DI, after every module's
 *    onModuleInit().
 *
 * Both would otherwise need their own copy of "split on comma, uppercase,
 * resolve, collect the unknowns" — a second hardcoded list next to
 * country-profile.const.ts is exactly what Task 12 exists to avoid.
 */
export interface DeploymentCountriesResolution {
  /** ISO codes that resolved to a real profile, uppercased, in input order. */
  countryCodes: string[];
  /** Union of every resolved country's `capabilities.paymentProviderIds`. */
  paymentProviderIds: Set<string>;
  /** Union of every resolved country's non-null `capabilities.smsProviderId`. */
  smsProviderIds: Set<string>;
  /** Raw tokens (as typed, trimmed) that did not resolve to a real profile. */
  unknownCodes: string[];
}

const DEFAULT_DEPLOYMENT_COUNTRIES = "TR";

/**
 * Reads `DEPLOYMENT_COUNTRIES` from the environment and resolves it.
 *
 * An unknown/malformed code is collected in `unknownCodes`, never silently
 * dropped or folded into the default — dropping it would mean serving a
 * country whose requirements were never checked, which is worse than
 * refusing to boot. Callers decide what "unknown" means for them (boot
 * validation hard-fails on it; nothing else currently needs to).
 *
 * Uses resolveCountryProfile() — never indexes COUNTRY_PROFILES directly —
 * so there is exactly one implementation of "what a code resolves to" in
 * the codebase (see country.service.ts's class comment). A code is treated
 * as unknown when resolveCountryProfile() had to fall back, the same
 * comparison CountryService.forCode() uses to decide whether to log its
 * own warning.
 */
export function resolveDeploymentCountries(): DeploymentCountriesResolution {
  const raw =
    process.env.DEPLOYMENT_COUNTRIES?.trim() || DEFAULT_DEPLOYMENT_COUNTRIES;
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const countryCodes: string[] = [];
  const paymentProviderIds = new Set<string>();
  const smsProviderIds = new Set<string>();
  const unknownCodes: string[] = [];

  for (const token of tokens) {
    const code = token.toUpperCase();
    const profile = resolveCountryProfile(code);
    if (profile.code !== code) {
      unknownCodes.push(token);
      continue;
    }
    countryCodes.push(profile.code);
    for (const id of profile.capabilities.paymentProviderIds) {
      paymentProviderIds.add(id);
    }
    if (profile.capabilities.smsProviderId) {
      smsProviderIds.add(profile.capabilities.smsProviderId);
    }
  }

  return { countryCodes, paymentProviderIds, smsProviderIds, unknownCodes };
}
