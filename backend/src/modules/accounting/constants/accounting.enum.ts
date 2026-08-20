import { COUNTRY_PROFILES } from "../../../common/country/country-profile.const";

/**
 * TR-ONLY named tax bands. These read nicely at existing TR-scoped call
 * sites (invoice line items, receipts), but they are NOT the source of
 * truth for which rates are legal, and they do NOT apply to a non-Turkish
 * tenant. That source of truth is `COUNTRY_PROFILES.TR.taxRates` in
 * backend/src/common/country/country-profile.const.ts — a UZ tenant's
 * product tax band is validated against `COUNTRY_PROFILES.UZ.taxRates`
 * (0/6/12) via `@IsCountryTaxRate`/`CountryService`, never against this
 * enum. See country-tax-rate.validator.ts.
 */
export enum TaxRate {
  ZERO = 0,
  ONE = 1,
  TEN = 10,
  TWENTY = 20,
}

// Derived from the country profile rather than a second hardcoded 10 — one
// source of truth for "Turkey's default VAT rate".
export const DEFAULT_TAX_RATE = COUNTRY_PROFILES.TR.defaultTaxRate as TaxRate;

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  ISSUED = "ISSUED",
  SENT = "SENT",
  CANCELLED = "CANCELLED",
}

export enum AccountingProvider {
  NONE = "NONE",
  PARASUT = "PARASUT",
  LOGO = "LOGO",
  FORIBA = "FORIBA",
  NILVERA = "NILVERA",
}

export enum InvoiceType {
  SALES = "SALES",
  REFUND = "REFUND",
}

/**
 * A sales invoice stuck in externalStatus=SYNCING for longer than this is
 * considered crash-stuck (audit A6): the worker died between the SYNCING
 * claim and the outcome write, so nothing will ever move the row again.
 * Shared by the resync recovery sweep and the sync-status "stuck" counter
 * so both use the same definition of "stuck".
 */
export const STUCK_SYNCING_THRESHOLD_MS = 15 * 60 * 1000;
