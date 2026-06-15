import {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * Pure helpers behind <PhoneInput>. Kept dependency-only (no React) so the
 * number logic is unit-tested in isolation from the component.
 */

/**
 * Canonical E.164 ("+905551234567") for a typed number under a region, or ''
 * when the number isn't (yet) a valid phone. Accepts any natural format —
 * spaces, dashes, parens, the Turkish leading 0.
 */
export function deriveE164(input: string, region: CountryCode): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    const parsed = parsePhoneNumberFromString(trimmed, region);
    if (parsed && parsed.isValid()) return parsed.number;
  } catch {
    /* fall through */
  }
  return '';
}

/**
 * Split a stored E.164 value back into { country, nationalNumber } so the
 * component can seed its country dropdown + national input from an existing
 * value. Returns null when the value isn't a parseable phone.
 */
export function splitE164(
  value: string,
): { country: CountryCode; nationalNumber: string } | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = parsePhoneNumberFromString(trimmed);
    if (parsed && parsed.country) {
      return { country: parsed.country, nationalNumber: parsed.nationalNumber };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Regional-indicator flag emoji for an ISO 3166-1 alpha-2 code. */
export function getFlagEmoji(country: string): string {
  const cc = country.toUpperCase();
  if (cc.length !== 2) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + (cc.charCodeAt(0) - 65),
    A + (cc.charCodeAt(1) - 65),
  );
}

/** International dialing code for a country (e.g. 'TR' → '90'). */
export function countryDialCode(country: CountryCode): string {
  return getCountryCallingCode(country);
}

export interface CountryOption {
  code: CountryCode;
  name: string;
  dialCode: string;
  flag: string;
}

/**
 * Build the country dropdown list, localized to `locale` via Intl.DisplayNames
 * (falls back to the raw code where unavailable). `preferred` codes are hoisted
 * to the top (default Turkey first), the rest sorted by localized name.
 */
export function buildCountryOptions(
  locale: string,
  preferred: CountryCode[] = ['TR'],
): CountryOption[] {
  let display: Intl.DisplayNames | undefined;
  try {
    display = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    display = undefined;
  }
  const all = getCountries().map((code) => ({
    code,
    name: (() => {
      try {
        return display?.of(code) ?? code;
      } catch {
        return code;
      }
    })(),
    dialCode: getCountryCallingCode(code),
    flag: getFlagEmoji(code),
  }));
  const pref = preferred
    .map((p) => all.find((c) => c.code === p))
    .filter((c): c is CountryOption => Boolean(c));
  const rest = all
    .filter((c) => !preferred.includes(c.code))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  return [...pref, ...rest];
}
