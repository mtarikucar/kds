export enum TaxRate {
  ZERO = 0,
  ONE = 1,
  TEN = 10,
  TWENTY = 20,
}

export const DEFAULT_TAX_RATE = TaxRate.TEN;

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  SENT = 'SENT',
  CANCELLED = 'CANCELLED',
}

export enum AccountingProvider {
  NONE = 'NONE',
  PARASUT = 'PARASUT',
  LOGO = 'LOGO',
  FORIBA = 'FORIBA',
}

export enum InvoiceType {
  SALES = 'SALES',
  REFUND = 'REFUND',
}
