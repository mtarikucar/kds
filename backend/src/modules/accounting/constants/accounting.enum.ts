export enum TaxRate {
  ZERO = 0,
  ONE = 1,
  TEN = 10,
  TWENTY = 20,
}

export const DEFAULT_TAX_RATE = TaxRate.TEN;

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
