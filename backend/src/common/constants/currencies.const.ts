// NOT a selection list — a tenant's currency is DERIVED from its country
// profile (see backend/src/common/country/country-profile.const.ts,
// CountryService.currencyForTenant()) and is no longer user-writable
// (update-tenant-settings.dto.ts dropped `currency` in Task 7 of the
// multi-country work; SUPPORTED_CURRENCIES was already narrowed to TRY-only
// selection back in v3.2.9 when PayTR became the sole processor). This
// array now exists ONLY to key CURRENCY_INFO below — a symbol/name lookup
// table for wherever a currency code needs a human label (e.g. legacy
// non-TRY plan rendering on the bank-transfer/havale path).
export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "TRY",
  "CAD",
  "AUD",
] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_INFO: Record<
  SupportedCurrency,
  { name: string; symbol: string }
> = {
  USD: { name: "US Dollar", symbol: "$" },
  EUR: { name: "Euro", symbol: "€" },
  GBP: { name: "British Pound", symbol: "£" },
  TRY: { name: "Turkish Lira", symbol: "₺" },
  CAD: { name: "Canadian Dollar", symbol: "C$" },
  AUD: { name: "Australian Dollar", symbol: "A$" },
};

export const DEFAULT_CURRENCY: SupportedCurrency = "TRY";
