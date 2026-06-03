// Generic adapter contract. Each integration kind narrows the command and
// event shapes via the type parameter, but the registry deals with the
// generic form so the gateway code is provider-agnostic.

export type IntegrationKind =
  | "delivery"
  | "payment"
  | "fiscal"
  | "voip"
  | "accounting"
  | "sms"
  | "whatsapp";

export interface IntegrationAdapter<
  TConfig = Record<string, unknown>,
  TEvent = unknown,
> {
  readonly id: string;
  readonly kind: IntegrationKind;
  readonly configSchema: Record<string, unknown>; // JSON Schema

  init(config: TConfig): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;

  /** Verify signature + parse webhook into normalised events. */
  parseWebhook?(signature: string, raw: Buffer | string): Promise<TEvent[]>;

  /** Optional sync: pull menu, push order status, etc. */
  syncMenu?(menu: unknown): Promise<void>;
  syncOrderStatus?(orderId: string, status: string): Promise<void>;
}
