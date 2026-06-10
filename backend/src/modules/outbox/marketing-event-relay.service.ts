import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { EventTypes } from "./event-types";
import { DomainEvent } from "./domain-event-bus.service";
import {
  DeliverEventRequest,
  INTERNAL_EVENTS_ROUTE,
  INTERNAL_TOKEN_HEADER,
} from "../../core-contracts/internal-http.contract";

/**
 * Outcome of a relay attempt for one drained outbox row:
 *
 *   - "relayed"               → delivered to the marketing service (2xx).
 *   - "skipped-not-marketing" → the event type is not marketing-bound;
 *                               nothing to do, row completes normally.
 *   - "skipped-unconfigured"  → the event IS marketing-bound but
 *                               MARKETING_SERVICE_URL is unset. The worker
 *                               PARKS the row (stays pending, no attempt
 *                               burned) so configuring the URL later
 *                               backfills instead of losing the event.
 */
export type MarketingRelayResult =
  | "relayed"
  | "skipped-not-marketing"
  | "skipped-unconfigured";

/**
 * Phase-5 transport for the events that used to be consumed in-process by the
 * marketing bounded context (SettlementCommissionConsumer reacting to
 * `payment.succeeded.v1`). That consumer now lives in the kds-marketing
 * service, so marketing-bound rows are relayed over HTTP as they drain:
 *
 *   POST ${MARKETING_SERVICE_URL}/api/internal/events
 *   headers: x-internal-token: ${INTERNAL_SERVICE_TOKEN}
 *   body:    { type, payload, idempotencyKey, tenantId }   (DeliverEventRequest)
 *
 * `idempotencyKey` and `tenantId` are forwarded from the drained outbox row
 * so the producer's deterministic dedup key survives the hop — the receiving
 * outbox collapses redeliveries onto one row instead of minting a fresh
 * UUIDv7 key per delivery.
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
 * When MARKETING_SERVICE_URL is unset, marketing-bound rows are NOT dropped:
 * relay() reports "skipped-unconfigured" and the worker parks the row as
 * pending (long nextAttemptAt, attempt counter untouched), so commission
 * crediting is genuinely paused — configuring the URL later delivers the
 * backlog. We log once at startup so the pause is visible.
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
          "to the kds-marketing service. Marketing-bound outbox rows are PARKED (kept pending), " +
          "so commission crediting is paused until it is configured and resumes with the backlog.",
      );
    } else if (!this.internalToken?.trim()) {
      // Loud and unmissable: with the URL set but no token, every relay
      // would send an empty x-internal-token header, the marketing service
      // would 401 it, and after MAX_ATTEMPTS the row lands in the DLQ.
      this.logger.error(
        "MARKETING_SERVICE_URL is set but INTERNAL_SERVICE_TOKEN is unset/empty — " +
          "every relay to the kds-marketing service will be rejected with 401 and " +
          "marketing-bound events will pile up in the outbox DLQ. Set INTERNAL_SERVICE_TOKEN " +
          "to the same shared secret as the kds-marketing deployment.",
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
   * the outbox worker re-queues the row with backoff; returns the outcome
   * otherwise (see {@link MarketingRelayResult} — "skipped-unconfigured"
   * makes the worker park the row instead of marking it dispatched).
   */
  async relay(
    event: Pick<DomainEvent, "type" | "payload" | "idempotencyKey" | "tenantId">,
  ): Promise<MarketingRelayResult> {
    if (!this.isMarketingBound(event.type)) return "skipped-not-marketing";
    if (!this.baseUrl) return "skipped-unconfigured";

    const body: DeliverEventRequest = {
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      idempotencyKey: event.idempotencyKey,
      tenantId: event.tenantId ?? undefined,
    };
    const response = await axios.post(
      `${this.baseUrl}/api/${INTERNAL_EVENTS_ROUTE}`,
      body,
      {
        headers: { [INTERNAL_TOKEN_HEADER]: this.internalToken ?? "" },
        timeout: this.TIMEOUT_MS,
        validateStatus: () => true,
      },
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `marketing event relay rejected ${event.type} with status ${response.status}`,
      );
    }
    return "relayed";
  }
}
