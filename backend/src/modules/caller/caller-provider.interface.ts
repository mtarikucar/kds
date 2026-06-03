// Normalised event a caller provider emits. The adapter is responsible for
// turning Twilio / Verimor / 3CX / analog hardware events into this shape.

export type CallerEventKind = "incoming" | "answered" | "ended" | "missed";

export interface NormalisedCallerEvent {
  providerId: string;
  callId: string;
  kind: CallerEventKind;
  e164?: string;
  occurredAt: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface CallerProvider {
  readonly id: string;
  /** Parse the raw webhook payload + verify signature. */
  parseWebhook(
    signature: string,
    raw: Buffer | string,
  ): Promise<NormalisedCallerEvent[]>;
  /** Optional outbound: place a callback, initiate call recording, etc. */
  callback?(callId: string): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}
