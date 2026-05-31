import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { isKnownEventType } from './event-types';

/**
 * The write side of the outbox. Producers call `append` inside the same
 * transaction that mutates business state — this is the *only* way to make
 * event delivery durable without distributed transactions. The worker drains
 * the rows asynchronously onto the in-process bus (see OutboxWorkerService).
 *
 * Why UUIDv7: it sorts by creation time, so the worker can scan oldest-first
 * with a plain ORDER BY id (cheap on the primary key) instead of needing a
 * separate `createdAt` index.
 */
export interface AppendOptions {
  type: string;
  payload: Record<string, unknown>;
  tenantId?: string | null;
  /**
   * Producer-supplied dedup key.
   *
   * ⚠ The default fallback `id` (a fresh UUIDv7) is NOT a dedup key — every
   *   call generates a new one, so two retries of the same logical action
   *   produce two distinct outbox rows and consumers can't dedupe.
   *
   * Pass a deterministic key whenever the producer can be retried with the
   * same logical intent (webhook re-delivery, idempotent HTTP requests,
   * cron sweeps). Good shapes:
   *   - `{tenantId}:{aggregateId}:{action}:{logicalSequence}`
   *   - `{paymentRef}` for PayTR settlement
   *   - `{eventId}` when re-emitting a received external event
   */
  idempotencyKey?: string;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append an event to the outbox.
   *
   * Pass a `tx` Prisma client when calling inside an existing transaction
   * (the usual case). When called outside a transaction, the implicit
   * single-statement insert is still atomic on the row, but the caller is
   * responsible for ensuring the business state actually got written.
   */
  async append(opts: AppendOptions, tx?: Pick<PrismaService, 'outboxEvent'>): Promise<string> {
    // Unknown event-type warning: catches typos at the producer→consumer
    // boundary. Dynamic prefixes (e.g. `integration.webhook.<provider>.…`)
    // are allowlisted via DYNAMIC_EVENT_TYPE_PREFIXES so the warning only
    // fires for typos and net-new types that should be registered.
    if (!isKnownEventType(opts.type)) {
      this.logger.warn(
        `outbox.append: emitting unregistered event type "${opts.type}" — add it to EventTypes in event-types.ts so subscribers find it`,
      );
    }
    // v2.8.97 — warn when a known-retryable event type lands without a
    // producer-supplied idempotencyKey. The UUIDv7 fallback is unique
    // per call, so retries of the same logical event produce N rows
    // and consumers can't dedupe. Types matching this list are the
    // ones where a duplicate has actual downstream impact (double
    // notification, double commission, double settlement). Catch typos
    // at the producer; for fire-and-forget event types (e.g. metric
    // emits) the fallback is fine and there's no warning.
    if (!opts.idempotencyKey && DEDUP_REQUIRED_PREFIXES.some((p) => opts.type.startsWith(p))) {
      this.logger.warn(
        `outbox.append: ${opts.type} emitted without an idempotencyKey; UUIDv7 fallback is per-call, so retries will produce duplicate rows. Pass a deterministic key (e.g. {tenantId}:{aggregateId}:{action}).`,
      );
    }
    const client = tx ?? this.prisma;
    const id = uuidv7();
    await client.outboxEvent.create({
      data: {
        id,
        type: opts.type,
        tenantId: opts.tenantId ?? null,
        payload: opts.payload as any,
        idempotencyKey: opts.idempotencyKey ?? id,
        status: 'queued',
        nextAttemptAt: new Date(),
      },
    });
    return id;
  }
}

// v2.8.97 — event types where a duplicate row has tangible downstream
// impact (double-charge, double-notify, double-credit). Producers of
// these events SHOULD pass a deterministic idempotencyKey.
const DEDUP_REQUIRED_PREFIXES = [
  'subscription.',
  'payment.',
  'addon.',
  'commission.',
  'settlement.',
];
