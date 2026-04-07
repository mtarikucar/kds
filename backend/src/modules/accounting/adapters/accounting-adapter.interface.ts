export interface AccountingInvoiceData {
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  customerName?: string;
  customerTaxId?: string;
  customerTaxOffice?: string;
  currency: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
  }>;
  paymentMethod?: string;
  totalAmount: number;
  notes?: string;
}

export interface AccountingAdapter {
  readonly name: string;
  authenticate(credentials: Record<string, string>): Promise<{ accessToken: string; expiresAt?: Date }>;
  pushInvoice(token: string, companyId: string, invoice: AccountingInvoiceData): Promise<{ externalId: string }>;
  testConnection(credentials: Record<string, string>): Promise<boolean>;
}
