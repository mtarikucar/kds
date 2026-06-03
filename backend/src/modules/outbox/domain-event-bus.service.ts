import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { EventEmitter } from "node:events";

export type DomainEventHandler = (event: DomainEvent) => void | Promise<void>;

export interface DomainEvent<P = unknown> {
  /** UUIDv7 from the outbox row. Consumers MUST dedupe on this. */
  id: string;
  /** Versioned dotted name, e.g. "subscription.activated.v1". */
  type: string;
  tenantId: string | null;
  payload: P;
  /** Original producer-emitted idempotency key (often === id). */
  idempotencyKey: string;
  /** When the row was first persisted. */
  createdAt: Date;
}

/**
 * In-process pub/sub. Native EventEmitter is wrapped behind this thin
 * interface so the swap to @nestjs/event-emitter or a Redis-backed bus is
 * a one-file change. Listeners run sequentially per event; async handlers
 * are awaited so handlers complete in registration order.
 *
 * Kept intentionally synchronous on the producer side — producers write to
 * the outbox table inside a transaction and the worker does the publish,
 * so a slow listener cannot stall a business request.
 *
 * **Listener contract: idempotent + self-recovering.**
 * `dispatch()` swallows per-listener errors and logs them. Rationale:
 *   - One buggy listener used to (a) abort the dispatch loop, preventing
 *     later listeners from ever observing the event, and (b) bubble to the
 *     outbox worker which bumped `attempts` and rescheduled — at the next
 *     attempt the *already-successful* earlier listeners ran again,
 *     resulting in double projection.
 *   - This is the canonical event-bus pattern: transport delivery
 *     (in-process method call) is what's at-least-once; consumer success
 *     is the consumer's responsibility.
 * Consumers that need their own retry pipeline must persist a row + drive
 * a worker (see WebhookOutboundService.fanOut → WebhookDelivery for the
 * established pattern).
 */
@Injectable()
export class DomainEventBus implements OnModuleDestroy {
  private readonly logger = new Logger(DomainEventBus.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    // Default 10 is too low once each module subscribes to several events.
    this.emitter.setMaxListeners(200);
  }

  on(type: string, handler: DomainEventHandler): void {
    this.emitter.on(type, handler);
  }

  off(type: string, handler: DomainEventHandler): void {
    this.emitter.off(type, handler);
  }

  /** Wildcard subscribe for cross-cutting consumers (audit log, metrics). */
  onAny(handler: DomainEventHandler): void {
    this.emitter.on("*", handler);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const listeners = [
      ...(this.emitter.listeners(event.type) as DomainEventHandler[]),
      ...(this.emitter.listeners("*") as DomainEventHandler[]),
    ];
    for (const l of listeners) {
      // Per-listener isolation: a thrown handler is logged but does not
      // abort the loop or rethrow to the worker. See class docstring for
      // the rationale — short version: an aborted loop causes double
      // projection on the next attempt, and the at-least-once guarantee
      // is about transport, not consumer business logic.
      try {
        await l(event);
      } catch (err) {
        this.logger.error(
          `listener for event ${event.type} (id=${event.id}) threw: ${(err as Error)?.message ?? err}`,
          (err as Error)?.stack,
        );
      }
    }
  }

  onModuleDestroy(): void {
    this.emitter.removeAllListeners();
  }
}
