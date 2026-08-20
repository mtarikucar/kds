import { useGetTenantSettings } from './useCurrency';

/**
 * The tenant's country-derived parameters. Tax bands today
 * (`taxRates`/`defaultTaxRate`, backing the product-editor and
 * menu-import-review taxRate dropdowns) — Task 7 extends this SAME hook
 * with `currency`/`displayDecimals`, so this is deliberately named and
 * shaped as a general country-profile view, not a tax-only one. Any new
 * country-derived field belongs here, not in a second hook.
 */
export interface CountryProfileView {
  countryCode: string;
  taxRates: number[];
  defaultTaxRate: number;
}

// Deliberate: while tenant settings are still loading (or unauthenticated /
// a request failed), this is TODAY's existing behaviour — a TR-shaped UI —
// so nothing regresses for the common case during the loading flash.
const TR_FALLBACK: CountryProfileView = {
  countryCode: 'TR',
  taxRates: [0, 1, 10, 20],
  defaultTaxRate: 10,
};

export function useCountryProfile(): CountryProfileView {
  const { data } = useGetTenantSettings();
  return {
    countryCode: data?.countryCode ?? TR_FALLBACK.countryCode,
    taxRates: data?.taxRates ?? TR_FALLBACK.taxRates,
    defaultTaxRate: data?.defaultTaxRate ?? TR_FALLBACK.defaultTaxRate,
  };
}
