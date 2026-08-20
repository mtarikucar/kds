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
  /**
   * FiscalProviderRegistry ids that are LEGAL in this country. Plural on
   * purpose: which fiscal device a restaurant owns is a tenant fact, not a
   * country fact — Turkey alone has four registered adapters. The country
   * constrains the legal set; the tenant picks from within it.
   * Empty = no fiscal device applies here yet.
   */
  fiscalProviderIds: string[];
  /** PaymentProviderRegistry ids, in preference order. Empty = none built. */
  paymentProviderIds: string[];
  /** AccountingProvider enum value for e-invoicing, or null where none. */
  eDocumentAdapterId: string | null;
  /** EscPosBuilderRegistry id. */
  escposBuilderId: string;
  /** SMS_PROVIDER value, or null where no local provider is built yet. */
  smsProviderId: string | null;
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

// `satisfies` rather than a `Record<string, …>` annotation: the annotation
// widens the key type to `string`, so `CountryCode` would accept any string
// and every downstream task would lose compile-time safety.
export const COUNTRY_PROFILES = {
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
      // Every id below is verbatim what the adapter registers itself under.
      // Task 9 adds a test that walks every profile and asserts the registry
      // actually has each id — a typo here is otherwise invisible until a
      // payment or a receipt fails in production.
      fiscalProviderIds: [
        "fiscal_hugin",
        "fiscal_paygo",
        "fiscal_beko",
        "efatura",
      ],
      paymentProviderIds: ["paytr"],
      eDocumentAdapterId: "NILVERA", // AccountingProvider enum value, upper-case
      escposBuilderId: "escpos-tr",
      smsProviderId: "netgsm", // the SMS_PROVIDER value sms.service.ts checks
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
    // UNVERIFIED AGAINST A PRIMARY SOURCE. The repo's own Uzbekistan
    // benchmark corroborates the currency, the 12% QQS, the 6% catering
    // rate, the timezone and the phone region — but NOT these two digit
    // counts. Confirm with the local partner before the first UZ tenant
    // takes real money.
    taxIdRules: [
      { name: "STIR", pattern: /^\d{9}$/, labelKey: "country.taxId.stir" },
      { name: "PINFL", pattern: /^\d{14}$/, labelKey: "country.taxId.pinfl" },
    ],
    defaultLocale: "uz",
    intlLocale: "uz-UZ",
    defaultTimezone: "Asia/Tashkent",
    capabilities: {
      // No Uzbek fiscal/payment/e-document/SMS adapter exists yet — those are
      // P3+ and each waits on a local legal entity. Empty/null here is
      // honest: the resolver refuses rather than silently falling back to
      // the Turkish provider.
      fiscalProviderIds: [],
      paymentProviderIds: [],
      eDocumentAdapterId: null,
      // Task 13: was "escpos-tr" (the shared Turkish builder) — its CP857
      // codepage cannot represent Cyrillic at all, so any Cyrillic product
      // name printed as a row of '?'. "escpos-uz" (escpos-builder-uz.
      // service.ts) selects CP866 instead; see that file's class doc
      // comment for why CP866 over CP1251.
      escposBuilderId: "escpos-uz",
      smsProviderId: null,
    },
  },
} satisfies Record<string, CountryProfile>;

export const DEFAULT_COUNTRY = "TR";
/**
 * Named CountryProfileCode, not CountryCode: libphonenumber-js already
 * exports a `CountryCode` that normalize-phone.ts imports, and two different
 * `CountryCode`s in the same codebase is a foot-gun for Task 5.
 */
export type CountryProfileCode = keyof typeof COUNTRY_PROFILES;

/**
 * Compile-time proof that the key type actually narrowed.
 *
 * This lives HERE, in the source file, and not in the spec — tsconfig.json
 * excludes `**\/*.spec.ts`, so a `@ts-expect-error` written in a test is
 * never typechecked and proves nothing. (Verified: reverting `satisfies` to
 * a `Record<string, CountryProfile>` annotation left both jest and
 * `tsc -p tsconfig.json` green.)
 *
 * If COUNTRY_PROFILES ever regains that annotation, CountryProfileCode
 * widens to `string`, `string extends "TR" | "UZ"` becomes false, and this
 * line stops compiling — which is the whole point.
 */
type AssertExtends<Bound, T extends Bound> = T;
export type _CountryCodeIsNarrow = AssertExtends<
  "TR" | "UZ",
  CountryProfileCode
>;
