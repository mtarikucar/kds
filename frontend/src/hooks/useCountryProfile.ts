import { useGetTenantSettings, TaxIdRuleView } from './useCurrency';

/**
 * The tenant's country-derived parameters. Tax bands today
 * (`taxRates`/`defaultTaxRate`, backing the product-editor and
 * menu-import-review taxRate dropdowns) — Task 7 extends this SAME hook
 * with `currency`/`displayDecimals`, so this is deliberately named and
 * shaped as a general country-profile view, not a tax-only one. Any new
 * country-derived field belongs here, not in a second hook.
 *
 * `taxIdRules` (Task 6) is the tenant's OWN tax-id shapes — TR: VKN(10) /
 * TCKN(11), UZ: STIR(9) / PINFL(14). Before this, the branding/accounting
 * settings pages and the manual-invoice modal hardcoded the TR shape, so
 * every UZ tenant's tax id was rejected regardless of country.
 */
export interface CountryProfileView {
  countryCode: string;
  /** DERIVED from the country profile — never the tenant's independent
   *  choice (Task 7 removed `currency` from UpdateTenantSettingsDto). */
  currency: string;
  /** DISPLAY decimals only — storage/wire stays x100 for every currency,
   *  always. UZS is 0 (so'm quoted whole), TRY is 2. */
  displayDecimals: number;
  taxRates: number[];
  defaultTaxRate: number;
  taxIdRules: TaxIdRuleView[];
}

// Deliberate: while tenant settings are still loading (or unauthenticated /
// a request failed), this is TODAY's existing behaviour — a TR-shaped UI —
// so nothing regresses for the common case during the loading flash.
const TR_FALLBACK: CountryProfileView = {
  countryCode: 'TR',
  currency: 'TRY',
  displayDecimals: 2,
  taxRates: [0, 1, 10, 20],
  defaultTaxRate: 10,
  taxIdRules: [
    { name: 'VKN', pattern: '^\\d{10}$', labelKey: 'country.taxId.vkn' },
    { name: 'TCKN', pattern: '^\\d{11}$', labelKey: 'country.taxId.tckn' },
  ],
};

export function useCountryProfile(): CountryProfileView {
  const { data } = useGetTenantSettings();
  return {
    countryCode: data?.countryCode ?? TR_FALLBACK.countryCode,
    currency: data?.currency ?? TR_FALLBACK.currency,
    displayDecimals: data?.displayDecimals ?? TR_FALLBACK.displayDecimals,
    taxRates: data?.taxRates ?? TR_FALLBACK.taxRates,
    defaultTaxRate: data?.defaultTaxRate ?? TR_FALLBACK.defaultTaxRate,
    taxIdRules: data?.taxIdRules ?? TR_FALLBACK.taxIdRules,
  };
}

/**
 * Mirrors backend/src/common/country/tax-id.validator.ts#isValidTaxId — true
 * when `value` matches ANY of the given rules. A fixed client-side pattern
 * (the old `pattern="\d{10,11}"` / `/^\d{10,11}$/` littered across the
 * settings pages) is wrong once the shape is country-dependent, so every
 * caller drives this off the tenant's OWN `taxIdRules` instead.
 */
export function isValidTaxId(value: string, rules: TaxIdRuleView[]): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return rules.some((rule) => new RegExp(rule.pattern).test(value));
}

/**
 * The longest digit-count across the given rules' `^\d{N}$` patterns —
 * sizes an <input maxLength> that must fit every one of them (e.g. UZ's
 * 14-digit PINFL, where TR's fixed 11 used to cut input off). Falls back to
 * a generous 20 if a pattern isn't shaped that way.
 */
export function taxIdMaxLength(rules: TaxIdRuleView[]): number {
  const lengths = rules.map((r) => Number(r.pattern.match(/\{(\d+)\}/)?.[1] ?? 0));
  const max = lengths.length ? Math.max(...lengths) : 0;
  return max > 0 ? max : 20;
}
