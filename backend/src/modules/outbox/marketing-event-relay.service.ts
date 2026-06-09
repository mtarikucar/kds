import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { EventTypes } from "./event-types";
import { DomainEvent } from "./domain-event-bus.service";

/**
 * Phase-5 transport for the events that used to be consumed in-process by the
 * marketing bounded context (SettlementCommissionConsumer reacting to
 * `payment.succeeded.v1`). That consumer now lives in the kds-marketing
 * service, so marketing-bound rows are relayed over HTTP as they drain:
 *
 *   POST ${MARKETING_SERVICE_URL}/api/internal/events
 *   headers: x-internal-token: ${INTERNAL_SERVICE_TOKEN}
 *   body:    { type, payload }
 *
 * Relayed types: `payment.succeeded.v1` plus anything under the `marketing.`
 * prefix (core emits none today — marketing.* producers shipped with the
 * marketing service — but the prefix is kept so a future core-side producer
 * doesn't silently drop events).
 *
 * Invoked by OutboxWorkerService inside its per-row dispatch. A failed relay
 * THROWS, which rides the outbox's existing retry machinery (exponential
 * backoff, DLQ after MAX_ATTEMPTS with the loud "outbox DLQ" log ops alerts
 * on). Local bus listeners may re-observe the event on a retry — that is the
 * documented at-least-once contract; listeners are idempotent by design.
 *
 * When MARKETING_SERVICE_URL is unset the relay is a no-op (single-process /
 * pre-split deployments): events drain onto the in-process bus exactly as
 * before, and we log once at startup so the gap is visible.
 */
@Injectable()
export class MarketingEventRelayService implements OnModuleInit {
  private readonly logger = new Logger(MarketingEventRelayService.name);
  private readonly TIMEOUT_MS = 5_000;

  private readonly baseUrl: string | null;
  private readonly internalToken: string | undefined;

  constructor(config: ConfigService) {
    const raw = config.get<string>("MARKETING_SERVICE_URL")?.trim();
    this.baseUrl = raw ? raw.replace(/\/+$/, "") : null;
    this.internalToken = config.get<string>("INTERNAL_SERVICE_TOKEN");
  }

  onModuleInit(): void {
    if (!this.baseUrl) {
      this.logger.warn(
        "MARKETING_SERVICE_URL is not set — payment.succeeded.v1 events will NOT be relayed " +
          "to the kds-marketing service (commission crediting is paused until it is configured).",
      );
    }
  }

  get enabled(): boolean {
    return this.baseUrl !== null;
  }

  /** True for event types the kds-marketing service consumes. */
  isMarketingBound(type: string): boolean {
    return type === EventTypes.PaymentSucceeded || type.startsWith("marketing.");
  }

  /**
   * Relay one drained outbox row. Throws on any non-2xx / network failure so
   * the outbox worker re-queues the row with backoff.
   */
  async relay(event: Pick<DomainEvent, "type" | "payload">): Promise<void> {
    if (!this.baseUrl || !this.isMarketingBound(event.type)) return;

    const response = await axios.post(
      `${this.baseUrl}/api/internal/events`,
      { type: event.type, payload: event.payload },
      {
        headers: { "x-internal-token": this.internalToken ?? "" },
        timeout: this.TIMEOUT_MS,
        validateStatus: () => true,
      },
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `marketing event relay rejected ${event.type} with status ${response.status}`,
      );
    }
  }
}
