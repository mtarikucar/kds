// Provider-neutral fiscal contracts. Every yazarkasa brand or e-Fatura
// integration implements `FiscalProvider`.

export type FiscalCapability =
  | "receipt"
  | "invoice"
  | "cancel"
  | "z_report"
  | "x_report";

export interface FiscalLine {
  productCode: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  vatRate: number; // 0, 1, 8, 10, 18, 20 for TR
  vatGroup?: string; // 'A'..'F' yazarkasa dept code
  discountCents?: number;
}

export interface FiscalPaymentLine {
  method: "cash" | "card" | "qr" | "voucher" | "ticket";
  brand?: string; // VISA/MC for card; sodexo/multinet for ticket
  amountCents: number;
}

export interface FiscalReceiptRequest {
  tenantId: string;
  branchId?: string;
  fiscalDeviceId: string;
  orderId?: string;
  lines: FiscalLine[];
  payments: FiscalPaymentLine[];
  customer?: { taxId?: string; name?: string; addr?: string };
  idempotencyKey: string;
  // 'cash_receipt' (yazarkasa receipt) | 'einvoice' (e-Fatura) | 'earsiv' (e-Arşiv)
  kind?: "cash_receipt" | "einvoice" | "earsiv";
}

export interface FiscalReceiptResult {
  providerId: string;
  receiptId: string;
  fiscalNo?: string;
  fiscalZNo?: string;
  status: "queued" | "issued" | "failed";
  error?: string;
  raw?: Record<string, unknown>;
}

export interface FiscalDeviceStatus {
  providerId: string;
  fiscalDeviceId: string;
  status: "online" | "offline" | "error" | "maintenance";
  details?: Record<string, unknown>;
}

export interface ZReport {
  providerId: string;
  fiscalDeviceId: string;
  zNo: string;
  openedAt: string;
  closedAt: string;
  totals: Record<string, number>;
}

export interface FiscalProvider {
  readonly id: string;
  readonly capabilities: FiscalCapability[];

  /** Idempotent: same idempotencyKey → same receiptId. */
  issueReceipt(req: FiscalReceiptRequest): Promise<FiscalReceiptResult>;

  cancelReceipt(receiptId: string, reason: string): Promise<void>;
  reprintReceipt(receiptId: string): Promise<void>;
  status(fiscalDeviceId: string): Promise<FiscalDeviceStatus>;
  zReport(fiscalDeviceId: string, date: Date): Promise<ZReport>;
  closeDay(fiscalDeviceId: string): Promise<ZReport>;
  healthCheck(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}
