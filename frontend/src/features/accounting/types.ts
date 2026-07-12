export interface AccountingSettings {
  id: string;
  tenantId: string;
  autoGenerateInvoice: boolean;
  companyName?: string;
  companyTaxId?: string;
  companyTaxOffice?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  provider: string;
  autoSync: boolean;
  hasParasutCredentials: boolean;
  hasLogoCredentials: boolean;
  hasForibaCredentials: boolean;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  defaultPaymentTermDays: number;
}

/** KDV kırılımı — keyed by tax rate (e.g. "10", "20"). */
export type TaxBreakdown = Record<
  string,
  { taxableAmount: number; taxAmount: number }
>;

export interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  /** For REFUND documents: the SALES invoice this credit note reverses. */
  originalInvoiceId?: string | null;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerTaxId?: string;
  customerTaxOffice?: string;
  // Issuer/seller identity snapshotted from AccountingSettings at build time.
  sellerName?: string | null;
  sellerTaxId?: string | null;
  sellerTaxOffice?: string | null;
  sellerAddress?: string | null;
  sellerPhone?: string | null;
  sellerEmail?: string | null;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  discount: number;
  currency: string;
  taxBreakdown?: TaxBreakdown | null;
  withholdingTaxAmount?: number | null;
  withholdingCode?: string | null;
  paymentMethod?: string;
  orderId?: string | null;
  externalId?: string | null;
  externalProvider?: string;
  externalStatus?: string;
  syncedAt?: string;
  syncError?: string;
  issueDate: string;
  dueDate?: string;
  items: SalesInvoiceItem[];
}

export interface SalesInvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  total: number;
}
