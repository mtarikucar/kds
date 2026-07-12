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
    // Stored net line subtotal + tax (already reconciled with the order total).
    // When present the UBL emits these instead of recomputing unitPrice×qty,
    // avoiding kuruş drift that fails GİB total reconciliation.
    lineSubtotal?: number;
    lineTax?: number;
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
  /**
   * Void/cancel an invoice previously pushed to the provider (audit A3).
   * Never throws for a provider-side refusal — returns `{ success: false,
   * error }` so the caller can flag the row for manual cancellation.
   *
   * GATED: every current implementation is an honest stub returning
   * `success: false` ("cancel manually in the provider panel") until the
   * providers' real void/cancel APIs are integrated.
   */
  cancelInvoice(
    accessToken: string,
    companyId: string,
    externalInvoiceId: string,
  ): Promise<{ success: boolean; error?: string }>;
  testConnection(credentials: Record<string, string>): Promise<boolean>;
}
