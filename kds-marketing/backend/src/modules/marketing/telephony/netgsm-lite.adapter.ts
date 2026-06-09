import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TelephonyProvider,
  TelephonyCapability,
  PrepareCallRequest,
  PreparedCall,
} from './telephony-provider.interface';
import { TelephonyProviderRegistry } from './telephony-provider.registry';

/**
 * Netgsm Lite adapter — the Phase-2 sales line. Lite supports a single
 * concurrent call and no programmable-voice API, so this is a CLICK-TO-DIAL
 * provider: it returns a `tel:` URI the rep's softphone/handset dials, and the
 * outcome is logged manually (SalesCallService).
 *
 * The company sales line (Netgsm number) is configured separately from any
 * tenant/branch phone — there is intentionally no tenant context here. When
 * Netgsm's API/webhooks are adopted later, a NetgsmApiAdapter implements the
 * same interface with `api-dial`/`recording`/`webhook` capabilities and is
 * registered alongside; SalesCallService is unchanged.
 */
@Injectable()
export class NetgsmLiteAdapter implements TelephonyProvider, OnModuleInit {
  readonly id = 'netgsm-lite';
  readonly capabilities: readonly TelephonyCapability[] = [
    'click-to-dial',
    'manual-log',
  ];
  readonly maxConcurrentCalls = 1;

  private readonly logger = new Logger(NetgsmLiteAdapter.name);

  constructor(
    private readonly registry: TelephonyProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async prepareOutboundCall(req: PrepareCallRequest): Promise<PreparedCall> {
    // Click-to-dial: no upstream API call. The rep's device (bound to the
    // sales line) dials this tel: URI. externalCallId is null until a future
    // api-dial provider places the call programmatically.
    const dial = this.toDialNumber(req.toPhone);
    return {
      providerId: this.id,
      dialUri: `tel:${dial}`,
      mode: 'click-to-dial',
      externalCallId: null,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    // Click-to-dial needs no credentials; the line number is informational and
    // signals readiness for the future API/webhook upgrade.
    const salesLine = this.config.get<string>('NETGSM_SALES_LINE') ?? null;
    return { ok: true, details: { mode: 'click-to-dial', salesLineConfigured: !!salesLine } };
  }

  /** Normalise the dialled number to an E.164-ish form for the tel: link. */
  private toDialNumber(raw: string): string {
    const trimmed = (raw ?? '').replace(/[\s\-()]/g, '');
    if (trimmed.startsWith('+')) return trimmed;
    // Turkish mobile shapes → +90 5xxxxxxxxx
    if (/^0?5\d{9}$/.test(trimmed)) return `+90${trimmed.replace(/^0/, '')}`;
    if (/^90?5\d{9}$/.test(trimmed)) return `+${trimmed}`;
    return trimmed;
  }
}
