import { Transform, TransformFnParams } from "class-transformer";
import { parsePhoneNumberFromString, CountryCode } from "libphonenumber-js";
import { RequestContext } from "../context/request-context";
import { resolveCountryProfile } from "../country/country.service";

/**
 * Normalize a free-typed phone number to E.164 (e.g. "+905551234567").
 *
 * The API used to validate phone with a strict `/^\+?[1-9]\d{1,14}$/` regex —
 * which rejected every natural format a user actually types: spaces, dashes,
 * parens, AND the Turkish leading 0 ("0555 123 45 67"). So "whatever format I
 * write" failed with "Phone number must be in valid international format".
 *
 * Instead we PARSE the input with libphonenumber-js under a default region
 * and, when it's a valid number, return its canonical E.164 form. An
 * unparseable/invalid value is returned trimmed and unchanged so the
 * downstream validator can reject it with a clear message — we never silently
 * "fix" garbage into a wrong number.
 *
 * The region is what makes a locally-typed number parseable ("0555…" is
 * Turkish, "90 123…" is Uzbek). When the caller doesn't pin one explicitly,
 * it comes from the tenant in flight — read synchronously off the ambient
 * request context, resolved through the ONE door to a country profile,
 * `resolveCountryProfile()` (the pure, non-DI function `IsCountryTaxRate`
 * already uses for the identical reason: this runs from a plain function,
 * not through Nest's injector, so `CountryService` can't be injected here).
 * That function already owns the "unknown/absent code falls back to
 * DEFAULT_COUNTRY (TR)" decision — this file does not re-decide it or
 * duplicate the "TR" literal.
 *
 * NOTE — this `CountryCode` is libphonenumber-js's own type (the parsing
 * region), not Task 1's `CountryProfileCode`. Do not conflate the two.
 */
export function normalizePhoneToE164(
  value: string,
  defaultRegion?: CountryCode,
): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const region =
    defaultRegion ??
    // phoneRegion is authored in COUNTRY_PROFILES (code-reviewed config, not
    // request input), so this is the one legitimate place to widen it to
    // libphonenumber's CountryCode union.
    (resolveCountryProfile(RequestContext.get()?.countryCode)
      .phoneRegion as CountryCode);
  try {
    const parsed = parsePhoneNumberFromString(trimmed, region);
    if (parsed && parsed.isValid()) return parsed.number;
  } catch {
    // libphonenumber can throw on pathological input — fall through.
  }
  return trimmed;
}

/**
 * class-transformer decorator applying {@link normalizePhoneToE164}. Place it
 * BEFORE the `@Matches`/length validators (and after `@EmptyStringToUndefined`
 * is unnecessary — this collapses empty to undefined itself) so validation
 * runs against the canonical E.164 value.
 *
 * `defaultRegion` is resolved INSIDE the `Transform` callback, never at
 * decoration time. `registerDecorator`/`Transform` wrappers run once, when
 * the DTO class is first defined by the module loader — long before any
 * request (and therefore any ambient country) exists. Reading
 * RequestContext at decoration time would freeze the region to whatever was
 * ambient at import time, which is nothing — i.e. always the TR fallback in
 * `normalizePhoneToE164`. That bug would still pass nearly every test (TR
 * fixtures keep working) and only surface as "every non-TR tenant's locally
 * typed number fails to parse" in production.
 */
export const NormalizePhone = (defaultRegion?: CountryCode) =>
  Transform(({ value }: TransformFnParams) => {
    if (typeof value !== "string") return value;
    const normalized = normalizePhoneToE164(value, defaultRegion);
    return normalized === "" ? undefined : normalized;
  });
