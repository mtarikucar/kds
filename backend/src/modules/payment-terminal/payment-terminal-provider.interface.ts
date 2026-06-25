// Provider-neutral card-payment-terminal contracts. Every terminal model
// (integrated GMP-3 Yazarkasa-POS, external bank POS via ECR/OOS, SoftPOS/PSP
// API, and the fail-closed simulator) implements `PaymentTerminalProvider`.

export type TerminalCapability =
  | "sale"
  | "void"
  | "refund"
  | "fiscal_coupled" // charges AND prints the mali fiş in one device op (GMP-3)
  | "query_last"; // can re-query the last transaction for reconciliation

/** One mali-fiş line, identical in shape to the standalone yazarkasa rail. */
export interface TerminalFiscalLine {
  productCode: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  vatRate: number;
  discountCents: number;
}

/**
 * Fiş context for fiscal_coupled providers (GMP-3): the device charges the card
 * AND prints the mali fiş in one op, so the lines/KDV/tender ride along with the
 * sale. Built by the service from the order (same builder as the standalone
 * yazarkasa rail). Absent for charge-only providers.
 */
export interface TerminalFiscalContext {
  kind: "cash_receipt" | "einvoice" | "earsiv";
  lines: TerminalFiscalLine[];
  payments: { method: "cash" | "card"; amountCents: number }[];
  customer?: { taxId?: string; name?: string; addr?: string } | null;
}

export interface TerminalChargeRequest {
  tenantId: string;
  branchId?: string | null;
  orderId: string;
  amountCents: number;
  /** The configured terminal record (provider id, serial, encrypted config). */
  terminal: {
    id: string;
    providerId: string;
    deviceId: string | null;
    serial: string;
    config: Record<string, unknown> | null;
  };
  /** Deterministic per attempt — also the device-command idempotency key. */
  idempotencyKey: string;
  /** Set by the service only for fiscal_coupled providers. */
  fiscalContext?: TerminalFiscalContext | null;
}

export interface TerminalChargeResult {
  status: "APPROVED" | "DECLINED" | "TIMEOUT" | "ERROR";
  /** Bank/provider approval reference — written to Payment.transactionId. */
  approvalCode?: string;
  rrn?: string;
  cardBrand?: string;
  maskedPan?: string;
  /** Set by fiscal_coupled providers (GMP-3) that printed the fiş in the same op. */
  fiscalNo?: string;
  error?: string;
  raw?: Record<string, unknown>;
}

/** What a bridge-routed provider enqueues to the device-mesh charge_card queue. */
export interface TerminalSaleCommand {
  kind: "charge_card";
  payload: Record<string, unknown>;
  idempotencyKey: string;
  priority?: number;
}

export interface PaymentTerminalProvider {
  readonly id: string; // 'simulator' | 'gmp3_card' | 'bank_ecr' | 'softpos'
  readonly capabilities: TerminalCapability[];
  /**
   * 'bridge'  → charging runs through the on-prem agent (device-mesh
   *             charge_card command): buildSaleCommand() enqueues, mapAck()
   *             maps the bridge's ack once it lands (async, polled).
   * 'in_process' → the backend resolves the charge directly (simulator
   *             deterministic; SoftPOS/PSP via HTTP): charge() returns the
   *             result (may be sync or its own async).
   */
  readonly kind: "bridge" | "in_process";

  /** bridge providers only. */
  buildSaleCommand?(req: TerminalChargeRequest): TerminalSaleCommand;
  mapAck?(ack: {
    status: string;
    result: Record<string, unknown> | null;
    error: string | null;
  }): TerminalChargeResult;

  /** in_process providers only. */
  charge?(req: TerminalChargeRequest): Promise<TerminalChargeResult>;
}
