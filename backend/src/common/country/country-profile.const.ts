/**
 * Per-country PARAMETERS. The single source of truth for everything that
 * varies by country but is not a regulation — currency, display precision,
 * tax bands, phone region, tax-id shapes, locale, timezone — plus the NAMES
 * of the providers that implement this country's regulations.
 *
 * Why a code constant and not a table: this repo already keeps platform
 * pricing in code (marketplace/alacarte-catalog.const.ts) for the same
 * reason. Countries change rarely, but a wrong tax rate typed into a
 * database row is a money incident. A constant goes through review, tests
 * and a release. The only DATA is Tenant.countryCode.
 *
 * NOTE — there is deliberately NO storage minor-unit exponent here. Money is
 * stored and wired as x100 for EVERY currency, always. That is an invariant,
 * not a parameter: UZS shows zero decimals but Payme/Uzum expect tiyin
 * (x100), so the storage boundary is already correct. Making it configurable
 * would invite someone to change it and silently break the 16 call sites that
 * cross that boundary. Only DISPLAY varies by country.
 */
export interface CountryTaxIdRule {
  /** Machine name, e.g. "VKN" | "TCKN" | "STIR" | "PINFL". */
  name: string;
  pattern: RegExp;
  /** i18n key for the human label shown next to the field. */
  labelKey: string;
}

export interface CountryCapabilities {
  /** FiscalProviderRegistry id, or null where no fiscal device applies yet. */
  fiscalProviderId: string | null;
  /** PaymentProviderRegistry ids, in preference order. */
  paymentProviderIds: string[];
  /** AccountingAdapter id for e-invoicing, or null. */
  eDocumentAdapterId: string | null;
  /** EscPosBuilderRegistry id. */
  escposBuilderId: string;
  /** SMS provider id. */
  smsProviderId: string;
}

export interface CountryProfile {
  code: string;
  currency: string;
  /** DISPLAY decimals only. Storage is always x100 — see the note above. */
  displayDecimals: number;
  taxRates: number[];
  defaultTaxRate: number;
  /** libphonenumber-js region for parsing a locally-typed number. */
  phoneRegion: string;
  taxIdRules: CountryTaxIdRule[];
  /** i18n locale key. */
  defaultLocale: string;
  /** Intl.NumberFormat / DateTimeFormat locale. */
  intlLocale: string;
  defaultTimezone: string;
  capabilities: CountryCapabilities;
}

export const COUNTRY_PROFILES: Record<string, CountryProfile> = {
  TR: {
    code: "TR",
    currency: "TRY",
    displayDecimals: 2,
    // KDV bands. Kept EXACTLY as the pre-existing TaxRate enum and the
    // product DTO's @IsIn — this profile must not change TR behaviour.
    taxRates: [0, 1, 10, 20],
    defaultTaxRate: 10,
    phoneRegion: "TR",
    taxIdRules: [
      { name: "VKN", pattern: /^\d{10}$/, labelKey: "country.taxId.vkn" },
      { name: "TCKN", pattern: /^\d{11}$/, labelKey: "country.taxId.tckn" },
    ],
    defaultLocale: "tr",
    intlLocale: "tr-TR",
    defaultTimezone: "Europe/Istanbul",
    capabilities: {
      fiscalProviderId: "hugin",
      paymentProviderIds: ["paytr"],
      eDocumentAdapterId: "nilvera",
      escposBuilderId: "generic",
      smsProviderId: "netgsm",
    },
  },

  UZ: {
    code: "UZ",
    currency: "UZS",
    // So'm is quoted without decimals in practice even though ISO-4217 gives
    // it two. Storage stays x100 (tiyin) because that is what Payme/Uzum
    // expect on the wire.
    displayDecimals: 0,
    // QQS is 12% (fixed through 2028). Catering may elect a 6% no-credit
    // rate from 2026-06, so both are offered plus exempt.
    taxRates: [0, 6, 12],
    defaultTaxRate: 12,
    phoneRegion: "UZ",
    taxIdRules: [
      { name: "STIR", pattern: /^\d{9}$/, labelKey: "country.taxId.stir" },
      { name: "PINFL", pattern: /^\d{14}$/, labelKey: "country.taxId.pinfl" },
    ],
    defaultLocale: "uz",
    intlLocale: "uz-UZ",
    defaultTimezone: "Asia/Tashkent",
    capabilities: {
      // No Uzbek fiscal/payment/e-document adapter exists yet — those are
      // P3/P4/P5 and each waits on a local legal entity. Null here is
      // honest: the resolver refuses rather than silently falling back to
      // the Turkish provider.
      fiscalProviderId: null,
      paymentProviderIds: [],
      eDocumentAdapterId: null,
      escposBuilderId: "generic",
      smsProviderId: "eskiz",
    },
  },
};

export const DEFAULT_COUNTRY = "TR";
export type CountryCode = keyof typeof COUNTRY_PROFILES;
