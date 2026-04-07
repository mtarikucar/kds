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

export interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  customerName?: string;
  customerTaxId?: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  discount: number;
  currency: string;
  paymentMethod?: string;
  externalProvider?: string;
  externalStatus?: string;
  syncedAt?: string;
  syncError?: string;
  issueDate: string;
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
