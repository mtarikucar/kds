import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';

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
 * are awaited so backpressure surfaces cleanly to the worker.
 *
 * Kept intentionally synchronous on the producer side — producers write to
 * the outbox table inside a transaction and the worker does the publish,
 * so a slow listener cannot stall a business request.
 */
@Injectable()
export class DomainEventBus implements OnModuleDestroy {
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
    this.emitter.on('*', handler);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    // 'await' the listeners so a thrown error reaches the outbox worker and
    // bumps `attempts`. EventEmitter itself is fire-and-forget, but we wrap
    // each listener in a Promise so async handlers are observed.
    const listeners = [
      ...(this.emitter.listeners(event.type) as DomainEventHandler[]),
      ...(this.emitter.listeners('*') as DomainEventHandler[]),
    ];
    for (const l of listeners) {
      await l(event);
    }
  }

  onModuleDestroy(): void {
    this.emitter.removeAllListeners();
  }
}
