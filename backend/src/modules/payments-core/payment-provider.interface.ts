// Provider-neutral payment contracts. Existing PayTR/Iyzico/Stripe code keeps
// running as-is; this interface is the integration seam for new providers
// (Adyen, ÖdeAl, Param, etc.) and for the card-present Phase 7 terminals.
//
// The split between `online` and `cardPresent` modes lives at the provider
// level — same interface, different `modes`. Webhook ingest is uniform.

export type PaymentMode = 'online' | 'cardPresent' | 'qr' | 'cash' | 'voucher';

export type PaymentStatus =
  | 'requires_action'  // 3DS challenge etc.
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partial_refund'
  | 'cancelled';

export interface PaymentIntentRequest {
  tenantId: string;
  // External reference: orderId, hardwareOrderId, subscriptionId, etc.
  externalRef: string;
  // Caller-side dedup. The provider's local store maps this to its own id.
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  // 'subscription' | 'hardware' | 'pos' | 'service'
  purpose: string;
  // Optional buyer info — providers like Iyzico require it.
  buyer?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: Record<string, unknown>;
    taxId?: string;
  };
  // Where to send the buyer for 3DS / success / failure pages.
  returnUrl?: string;
  // Buyer IP — passed to the acquirer for fraud-scoring (most TR providers
  // weight this heavily). Optional so non-online modes don't have to set
  // it; online-mode adapters MUST reject the intent when missing rather
  // than fall back to 0.0.0.0, which fraud-pollutes the payments log.
  buyerIp?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentIntent {
  providerId: string;
  intentId: string;
  status: PaymentStatus;
  // Optional opaque payload the client uses to render the next step
  // (3DS URL, terminal command, qr png, etc.).
  clientAction?: Record<string, unknown>;
  amountCents: number;
  currency: string;
}

export interface PaymentTransaction {
  providerId: string;
  intentId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  // Acquirer reference shown on the customer statement.
  acquirerRef?: string;
  authCode?: string;
  cardBrand?: string;
  cardLast4?: string;
  raw?: Record<string, unknown>;
}

export interface RefundRequest {
  intentId: string;
  amountCents?: number; // omitted = full refund
  reason?: string;
  idempotencyKey: string;
}

export interface RefundTransaction {
  providerId: string;
  intentId: string;
  refundId: string;
  status: PaymentStatus;
  amountCents: number;
}

export interface ProviderWebhookEvent {
  providerId: string;
  type: string;
  // Signature already verified before being handed off.
  payload: Record<string, unknown>;
}

export interface SettlementReport {
  providerId: string;
  date: string; // YYYY-MM-DD
  totalCents: number;
  currency: string;
  count: number;
  lines: Array<{ intentId: string; amountCents: number; status: PaymentStatus }>;
}

/**
 * Every provider implements this. The Payments façade dispatches by
 * `providerId` so business code never imports a vendor SDK directly.
 */
export interface PaymentProvider {
  readonly id: string;
  readonly modes: PaymentMode[];
  /** Idempotent: same idempotencyKey → same intent row returned. */
  createIntent(req: PaymentIntentRequest): Promise<PaymentIntent>;
  status(intentId: string): Promise<PaymentTransaction>;
  refund(req: RefundRequest): Promise<RefundTransaction>;
  /** Verify HMAC/sig and surface a normalized event. */
  parseWebhook(signature: string, raw: Buffer | string): Promise<ProviderWebhookEvent[]>;
  /** Optional batch report — providers without per-day batch return null. */
  settlements?(tenantId: string, day: Date): Promise<SettlementReport | null>;
  healthCheck(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}

/**
 * Card-present terminal — a thin sibling of PaymentProvider that targets the
 * physical POS device via the Device Mesh.
 */
export interface PaymentTerminal {
  readonly id: string;
  readonly providerId: string;
  readonly deviceId: string;
  charge(req: { amountCents: number; currency: string; idempotencyKey: string }): Promise<PaymentTransaction>;
  void(transactionId: string): Promise<void>;
  status(): Promise<{ status: 'online' | 'offline' | 'busy' | 'error'; details?: Record<string, unknown> }>;
}
