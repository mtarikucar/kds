import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CallerProvider } from "./caller-provider.interface";
import {
  HmacCallerAdapter,
  HmacCallerContext,
} from "./adapters/hmac-caller.adapter";

/**
 * Provider registry. Replaces the controller's `events = []` stub for the
 * non-mock path: a configured generic HMAC adapter is selected by
 * providerId and bound to the request's tenant + timestamp.
 *
 * The `mock` provider is deliberately NOT served here — the controller keeps
 * its own mock branch with the prod-refusal guard untouched. Likewise the
 * prod-refusal for mock stays in the controller; this registry only ever
 * produces real, signature-verifying adapters.
 *
 * Per-tenant secret sourcing (config-driven, no schema coupling): a secret
 * is looked up by, in order of precedence:
 *   1. CALLER_WEBHOOK_SECRET__<PROVIDER>__<TENANT>  (per-tenant override)
 *   2. CALLER_WEBHOOK_SECRET__<PROVIDER>            (provider default)
 * Provider/tenant ids are upper-cased and non-alphanumerics → '_' so they
 * map to valid env-var key shapes. A provider with no configured secret
 * yields an adapter that fails closed on the first callback.
 */
@Injectable()
export class CallerProviderRegistry {
  /** Providers the generic HMAC path is allowed to serve. */
  private static readonly GENERIC_PROVIDER_IDS = new Set([
    "twilio",
    "verimor",
    "netgsm",
    "3cx",
    "generic",
  ]);

  constructor(private readonly config: ConfigService) {}

  /**
   * Whether a configured generic adapter exists for this providerId. Unknown
   * providers (and `mock`) return false so the controller can no-op safely.
   */
  supports(providerId: string): boolean {
    return CallerProviderRegistry.GENERIC_PROVIDER_IDS.has(providerId);
  }

  /**
   * Resolve a tenant+timestamp-bound provider for the webhook ingest path.
   * Returns null when the providerId isn't a known generic provider (the
   * controller then keeps the events=[] no-op for forward-compat).
   */
  resolve(providerId: string, ctx: HmacCallerContext): CallerProvider | null {
    if (!this.supports(providerId)) return null;
    const secret = this.secretFor(providerId, ctx.tenantId);
    return new HmacCallerAdapter(providerId, secret, ctx);
  }

  private secretFor(providerId: string, tenantId: string): string | undefined {
    const p = this.envSegment(providerId);
    const t = this.envSegment(tenantId);
    return (
      this.config.get<string>(`CALLER_WEBHOOK_SECRET__${p}__${t}`) ??
      this.config.get<string>(`CALLER_WEBHOOK_SECRET__${p}`) ??
      undefined
    );
  }

  private envSegment(raw: string): string {
    return raw.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  }
}
