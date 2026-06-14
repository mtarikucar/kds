import { createHmac } from "node:crypto";
import {
  CallerEventKind,
  CallerProvider,
  NormalisedCallerEvent,
} from "../caller-provider.interface";
import { verifyHmacHex } from "../../integration-gateway/sig-verify";

/**
 * Reject signed callbacks older than this many seconds. Mirrors the
 * delivery-platforms WebhookAuthGuard (WEBHOOK_MAX_AGE_SECONDS=300) so a
 * captured (signature, body, timestamp) tuple becomes useless once the
 * window lapses — defence in depth on top of the DB-level dedup.
 */
export const CALLER_WEBHOOK_MAX_AGE_SECONDS = 300;

/**
 * Per-request context the registry binds before handing the adapter to the
 * controller. parseWebhook() keeps the CallerProvider interface signature
 * (signature, raw) — tenant + timestamp travel out-of-band because they
 * come from the URL param / request headers, not the signed body.
 */
export interface HmacCallerContext {
  tenantId: string;
  /** Provider-supplied unix-seconds (or ms) timestamp header, if any. */
  timestamp?: string | number;
}

/**
 * Generic HMAC-signed caller provider. Provider-agnostic: it computes
 *
 *   createHmac('sha256', secret).update(rawBody).digest('hex')
 *
 * and compares it (constant-time, via the shared verifyHmacHex) against the
 * signature header. The per-tenant webhookSecret is supplied by the registry
 * from config. This mirrors getir.adapter.ts; provider-specific signing
 * quirks (timestamp-in-signed-payload, sha512, base64, header naming) are
 * intentionally NOT handled here — they belong to a concrete adapter built
 * once a real provider contract exists.
 */
export class HmacCallerAdapter implements CallerProvider {
  constructor(
    readonly id: string,
    private readonly webhookSecret: string | undefined,
    private readonly ctx: HmacCallerContext,
  ) {}

  async parseWebhook(
    signature: string,
    raw: Buffer | string,
  ): Promise<NormalisedCallerEvent[]> {
    if (!this.webhookSecret) {
      // Fail closed — never accept an unsigned/unverifiable callback.
      throw new Error(`${this.id}: webhook secret not configured`);
    }

    // Replay protection: a fresh timestamp is required so a captured
    // (signature, body) tuple can't be re-posted forever. Absent or stale
    // timestamps are rejected (fail-closed, mirroring the Trendyol path).
    this.assertFreshTimestamp();

    const body = typeof raw === "string" ? raw : raw.toString("utf8");
    const expected = createHmac("sha256", this.webhookSecret)
      .update(body)
      .digest("hex");
    if (!verifyHmacHex(expected, signature ?? "")) {
      throw new Error(`${this.id}: invalid signature`);
    }

    return this.normalise(body);
  }

  private assertFreshTimestamp(): void {
    const { timestamp } = this.ctx;
    if (timestamp === undefined || timestamp === null || timestamp === "") {
      throw new Error(`${this.id}: missing webhook timestamp`);
    }
    let ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      throw new Error(`${this.id}: invalid webhook timestamp`);
    }
    // Accept seconds or milliseconds — normalise ms to seconds.
    if (ts > 1e12) ts = ts / 1000;
    const nowSec = Date.now() / 1000;
    if (Math.abs(nowSec - ts) > CALLER_WEBHOOK_MAX_AGE_SECONDS) {
      throw new Error(`${this.id}: stale webhook timestamp`);
    }
  }

  private normalise(body: string): NormalisedCallerEvent[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return [];
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((p: any) => ({
      providerId: this.id,
      callId: String(p?.callId ?? p?.call_id ?? ""),
      kind: this.coerceKind(p?.kind),
      e164: p?.e164 ?? p?.from ?? undefined,
      occurredAt: p?.occurredAt ?? new Date().toISOString(),
      durationMs: typeof p?.durationMs === "number" ? p.durationMs : undefined,
      meta: p?.meta,
    }));
  }

  private coerceKind(raw: unknown): CallerEventKind {
    const allowed: CallerEventKind[] = [
      "incoming",
      "answered",
      "ended",
      "missed",
    ];
    return allowed.includes(raw as CallerEventKind)
      ? (raw as CallerEventKind)
      : "incoming";
  }

  async healthCheck() {
    return {
      ok: Boolean(this.webhookSecret),
      details: { mode: "hmac", configured: Boolean(this.webhookSecret) },
    };
  }
}
