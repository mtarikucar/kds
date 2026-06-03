import { Injectable } from "@nestjs/common";
import {
  CallerProvider,
  NormalisedCallerEvent,
} from "../caller-provider.interface";

/**
 * Mock caller provider. Reflects whatever JSON is posted into the test
 * webhook endpoint as if it were an upstream event. Used by CI and the
 * dashboard's "send test call" button so the call popup UI can be wired
 * before any VoIP integration is signed.
 */
@Injectable()
export class MockCallerProvider implements CallerProvider {
  readonly id = "mock";

  async parseWebhook(
    _signature: string,
    raw: Buffer | string,
  ): Promise<NormalisedCallerEvent[]> {
    const body = typeof raw === "string" ? raw : raw.toString("utf8");
    try {
      const parsed = JSON.parse(body);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((p) => ({
        providerId: this.id,
        callId: p.callId ?? "mock-" + Math.random().toString(36).slice(2),
        kind: p.kind ?? "incoming",
        e164: p.e164,
        occurredAt: p.occurredAt ?? new Date().toISOString(),
        durationMs: p.durationMs,
        meta: p.meta,
      }));
    } catch {
      return [];
    }
  }

  async healthCheck() {
    return { ok: true, details: { mode: "mock" } };
  }
}
