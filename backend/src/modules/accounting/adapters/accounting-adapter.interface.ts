export interface AccountingInvoiceData {
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  customerName?: string;
  customerTaxId?: string;
  customerTaxOffice?: string;
  // Resolved e-document type (e-document-routing.resolveEDocumentType). Selects
  // the UBL-TR ProfileID: EFATURA → TICARIFATURA (B2B), EARSIVFATURA → e-Arşiv
  // (B2C). Defaults to EARSIVFATURA when unset — the safe final-consumer path.
  eDocumentType?: "EFATURA" | "EARSIVFATURA";
  // KDV tevkifatı (VAT withholding) — amount withheld by the buyer + GİB code.
  // When present the UBL carries a WithholdingTaxTotal and a reduced payable.
  withholdingTaxAmount?: number;
  withholdingCode?: string;
  // Issuer / seller (satıcı) identity — snapshotted onto the SalesInvoice
  // from the tenant's AccountingSettings "Company Info". A valid UBL-TR
  // document needs an AccountingSupplierParty; these feed that block.
  sellerName?: string;
  sellerTaxId?: string;
  sellerTaxOffice?: string;
  sellerAddress?: string;
  sellerPhone?: string;
  sellerEmail?: string;
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
  authenticate(
    credentials: Record<string, string>,
  ): Promise<{ accessToken: string; expiresAt?: Date }>;
  pushInvoice(
    token: string,
    companyId: string,
    invoice: AccountingInvoiceData,
  ): Promise<{ externalId: string }>;
  testConnection(credentials: Record<string, string>): Promise<boolean>;
}
