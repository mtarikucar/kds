import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';

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
  /** Producer-supplied dedup key. Defaults to the event id. */
  idempotencyKey?: string;
}

@Injectable()
export class OutboxService {
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
