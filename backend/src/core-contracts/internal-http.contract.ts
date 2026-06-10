/**
 * Wire-level constants shared by EVERY service-to-service (`/api/internal/*`)
 * call between core and the kds-marketing service, plus the event-delivery
 * contract (core outbox → marketing ingress).
 *
 * This file is part of the vendored shared-kernel: the copy under
 * `backend/src/core-contracts/` and the copy under
 * `kds-marketing/backend/src/core-contracts/` MUST stay byte-identical.
 * Both sides import these constants instead of inlining string literals so
 * the two halves of the HTTP contract cannot drift apart silently.
 *
 * Route constants are RELATIVE — they exclude each service's global `api`
 * prefix. Clients compose the URL as `${baseUrl}/api/${ROUTE}`; Nest
 * controllers split them into `@Controller(BASE)` + `@Post(SEGMENT)`.
 */

/** Header carrying the shared INTERNAL_SERVICE_TOKEN secret, both directions. */
export const INTERNAL_TOKEN_HEADER = "x-internal-token";

/**
 * Event ingress on the kds-marketing service (core → marketing, POST).
 * Core's outbox worker relays marketing-bound rows (payment.succeeded.v1,
 * marketing.*) here; marketing appends them to its own outbox.
 */
export const INTERNAL_EVENTS_ROUTE = "internal/events";

/** Request body for POST {@link INTERNAL_EVENTS_ROUTE}. */
export interface DeliverEventRequest {
  /** Versioned dotted event name, e.g. "payment.succeeded.v1". */
  type: string;
  /** The full event body (producer contract, e.g. PaymentSucceededPayload). */
  payload: Record<string, unknown>;
  /**
   * Producer's deterministic dedup key from the originating outbox row.
   * Forwarded so redeliveries collapse onto one row on the receiving side.
   */
  idempotencyKey?: string;
  tenantId?: string;
  /** When the producer emitted the event (informational, ISO-8601). */
  occurredAt?: string;
}

/** 202 response body for POST {@link INTERNAL_EVENTS_ROUTE}. */
export interface DeliverEventResponse {
  /** The receiving outbox row id. */
  id: string;
}
