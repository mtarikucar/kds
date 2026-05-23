import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventBus } from './domain-event-bus.service';

/**
 * Drains queued OutboxEvent rows onto the in-process DomainEventBus.
 *
 * Single-process implementation: a poll loop wakes every BASE_POLL_MS,
 * claims a batch of rows by flipping status='queued' → 'dispatching' inside
 * a transaction (with row-level locking via Postgres FOR UPDATE SKIP LOCKED
 * so multiple replicas would coordinate safely once we scale out), then
 * dispatches each onto the bus and flips to 'dispatched'. Failed dispatches
 * bump `attempts` with exponential backoff and surface in `lastError`.
 *
 * The polling is intentional rather than triggered by NOTIFY: it's robust
 * under crashes and replica restarts, has bounded recovery time, and trivial
 * to reason about. NOTIFY-driven fast path can be layered on later.
 */
@Injectable()
export class OutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private readonly BASE_POLL_MS = 500;
  private readonly BATCH = 50;
  private readonly MAX_ATTEMPTS = 8;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.scheduleNext(0);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => this.tick().catch(() => undefined), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.scheduleNext(this.BASE_POLL_MS);
      return;
    }
    this.running = true;
    try {
      const drained = await this.drainOnce();
      // If we drained a full batch, immediately try again — backlog catch-up.
      // Otherwise sleep until the next poll cycle.
      this.scheduleNext(drained >= this.BATCH ? 0 : this.BASE_POLL_MS);
    } catch (e) {
      this.logger.error(`outbox tick failed: ${(e as Error).message}`);
      this.scheduleNext(this.BASE_POLL_MS);
    } finally {
      this.running = false;
    }
  }

  private async drainOnce(): Promise<number> {
    // Claim a batch atomically. Using raw SQL because Prisma can't express
    // FOR UPDATE SKIP LOCKED on the same statement that returns the rows.
    // Postgres syntax: UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
    // LOCKED LIMIT N) RETURNING *.
    const now = new Date();
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      type: string;
      tenantId: string | null;
      payload: any;
      idempotencyKey: string;
      attempts: number;
      createdAt: Date;
    }>>`
      UPDATE "outbox_events"
         SET "status" = 'dispatching', "attempts" = "attempts" + 1
       WHERE "id" IN (
         SELECT "id" FROM "outbox_events"
          WHERE "status" = 'queued'
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          ORDER BY "id"
          FOR UPDATE SKIP LOCKED
          LIMIT ${this.BATCH}
       )
       RETURNING "id", "type", "tenantId", "payload", "idempotencyKey", "attempts", "createdAt";
    `;

    for (const r of rows) {
      try {
        await this.bus.dispatch({
          id: r.id,
          type: r.type,
          tenantId: r.tenantId,
          payload: r.payload,
          idempotencyKey: r.idempotencyKey,
          createdAt: r.createdAt,
        });
        await this.prisma.outboxEvent.update({
          where: { id: r.id },
          data: { status: 'dispatched', dispatchedAt: new Date(), lastError: null },
        });
      } catch (e) {
        const msg = (e as Error).message?.slice(0, 500) ?? 'unknown';
        const final = r.attempts >= this.MAX_ATTEMPTS;
        // Backoff: 0.5s, 1s, 2s, 4s, ... capped at 5min.
        const backoffMs = Math.min(500 * 2 ** r.attempts, 5 * 60_000);
        await this.prisma.outboxEvent.update({
          where: { id: r.id },
          data: {
            status: final ? 'failed' : 'queued',
            lastError: msg,
            nextAttemptAt: final ? null : new Date(Date.now() + backoffMs),
          },
        });
        this.logger.warn(
          `outbox event ${r.id} (${r.type}) ${final ? 'gave up' : 'will retry'} after ${r.attempts} attempts: ${msg}`,
        );
      }
    }
    return rows.length;
  }
}
