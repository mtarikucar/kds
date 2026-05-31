import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';

/**
 * Per-device FIFO command queue with priority.
 *
 * Enqueue is idempotent on (deviceId, idempotencyKey). The device pulls the
 * next queued command, transitions it to `inflight`, and acks with done/failed.
 * Cancellation of an inflight command is intentionally NOT supported — the
 * device has already started executing, and the safe model is "let it finish,
 * then send a compensating command".
 */
@Injectable()
export class CommandQueueService {
  private readonly logger = new Logger(CommandQueueService.name);
  private static readonly MAX_ATTEMPTS = 5;
  // 30 minutes — long enough for slow ESC/POS prints + occasional yazarkasa
  // network blips, short enough that operators see stuck commands cleared.
  private static readonly DEFAULT_TTL_MS = 30 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async enqueue(
    tenantId: string,
    deviceId: string,
    input: { kind: string; payload: Record<string, unknown>; priority?: number; idempotencyKey?: string },
  ) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, tenantId },
      select: { id: true, status: true },
    });
    if (!device) throw new NotFoundException('Device not found');
    if (device.status === 'retired') throw new BadRequestException('Device retired');

    const idempotencyKey = input.idempotencyKey ?? uuidv7();
    try {
      const row = await this.prisma.deviceCommand.create({
        data: {
          id: uuidv7(),
          tenantId,
          deviceId,
          kind: input.kind,
          payload: input.payload as any,
          priority: input.priority ?? 0,
          idempotencyKey,
          expiresAt: new Date(Date.now() + CommandQueueService.DEFAULT_TTL_MS),
        },
      });
      await this.outbox
        .append({
          type: 'device.command.created.v1',
          tenantId,
          payload: { commandId: row.id, deviceId, kind: row.kind },
        })
        .catch(() => undefined);
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Idempotency hit — return the existing row so the caller sees the
        // same outcome as if they'd been the first to send.
        const existing = await this.prisma.deviceCommand.findUnique({
          where: { deviceId_idempotencyKey: { deviceId, idempotencyKey } },
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  /**
   * Atomically claim the next queued command. Used by the device polling loop
   * (REST) or the WSS push notifier. Returns null when nothing is queued.
   *
   * The `FOR UPDATE SKIP LOCKED` shape keeps this safe under multiple
   * simultaneous claimers (e.g. a buggy device opening two connections).
   */
  async claimNext(deviceId: string) {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      tenantId: string;
      kind: string;
      payload: any;
      priority: number;
      attempts: number;
      idempotencyKey: string;
    }>>`
      UPDATE "device_commands"
         SET "status" = 'inflight', "attempts" = "attempts" + 1
       WHERE "id" IN (
         SELECT "id" FROM "device_commands"
          WHERE "deviceId" = ${deviceId}
            AND "status" = 'queued'
            AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
          ORDER BY "priority" DESC, "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       RETURNING "id", "tenantId", "kind", "payload", "priority", "attempts", "idempotencyKey";
    `;
    return rows[0] ?? null;
  }

  async ack(
    deviceId: string,
    commandId: string,
    input: { status: 'done' | 'failed'; result?: Record<string, unknown>; error?: string },
  ) {
    // Compound WHERE at the DB layer rather than `findUnique` + in-JS
    // `deviceId !==` check. The post-fetch check is an IDOR-adjacent
    // pattern — if a future refactor drops the comparison, the row's
    // tenantId/payload leaks back via the throw path. Codebase
    // convention (see orders.service, kds.service, webhook-outbound)
    // is to enforce scope at the query layer.
    const cmd = await this.prisma.deviceCommand.findFirst({
      where: { id: commandId, deviceId },
    });
    if (!cmd) throw new NotFoundException('Command not found');
    if (cmd.status !== 'inflight') throw new BadRequestException(`Cannot ack — status is ${cmd.status}`);

    // Failed commands with retries remaining go back to `queued`; otherwise
    // they terminate in `failed`. Done commands are terminal regardless.
    let nextStatus: 'done' | 'failed' | 'queued' = input.status;
    if (input.status === 'failed' && cmd.attempts < CommandQueueService.MAX_ATTEMPTS) {
      nextStatus = 'queued';
    }

    // Compound-WHERE updateMany + count check closes the same TOCTOU
    // window as the read above: the deviceId stays in scope from query
    // to write, so a row-id-only update can't accidentally clobber a
    // different device's command if the JS code is refactored.
    const claim = await this.prisma.deviceCommand.updateMany({
      where: { id: commandId, deviceId, status: 'inflight' },
      data: {
        status: nextStatus,
        result: (input.result as any) ?? undefined,
        error: input.error ?? null,
        ackedAt: input.status === 'done' || nextStatus === 'failed' ? new Date() : null,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Command status changed concurrently — refresh and retry');
    }
    const updated = await this.prisma.deviceCommand.findUniqueOrThrow({
      where: { id: commandId },
    });

    await this.outbox
      .append({
        type:
          input.status === 'done'
            ? 'device.command.completed.v1'
            : nextStatus === 'failed'
              ? 'device.command.failed.v1'
              : 'device.command.requeued.v1',
        tenantId: cmd.tenantId,
        payload: {
          commandId,
          deviceId,
          kind: cmd.kind,
          attempts: cmd.attempts,
          error: input.error,
        },
      })
      .catch(() => undefined);

    return updated;
  }

  /**
   * Sweeper for expired in-flight commands — devices that crashed mid-ack.
   * Flips inflight → queued so the next claim attempt can pick them up,
   * unless attempts >= MAX in which case they go to `failed`.
   *
   * The signal is "this command was last touched > 5min ago". `updatedAt`
   * bumps on every status transition (queued → inflight → ...), so it's
   * the correct proxy for "claimed and never ack'd". Using `createdAt`
   * would sweep a slow-claim queue: a command created an hour ago that
   * JUST went inflight 10s ago would be wrongly marked stuck.
   *
   * Implemented as two updateMany calls — one per attempts branch —
   * rather than the previous findMany + per-row update loop. The old
   * shape was an N+1 (one round-trip per stuck command), so a sweep
   * with 10K stale rows held the connection for as many serialised
   * writes; the new shape is two statements regardless of N and lets
   * Postgres pick the index path it likes.
   */
  async sweepStuck(): Promise<number> {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const now = new Date();
    // v2.8.97 — also transition expired-queued commands to `expired`
    // so they're explicitly visible to the admin instead of sitting
    // in `queued` status with expiresAt in the past (where claimNext
    // silently skips them and nobody is alerted). The `expired` row
    // still carries the original payload for forensic review.
    const [requeue, fail, expired] = await this.prisma.$transaction([
      this.prisma.deviceCommand.updateMany({
        where: {
          status: 'inflight',
          updatedAt: { lt: cutoff },
          attempts: { lt: CommandQueueService.MAX_ATTEMPTS },
        },
        data: { status: 'queued', error: 'No ack received; requeued' },
      }),
      this.prisma.deviceCommand.updateMany({
        where: {
          status: 'inflight',
          updatedAt: { lt: cutoff },
          attempts: { gte: CommandQueueService.MAX_ATTEMPTS },
        },
        data: { status: 'failed', error: 'No ack received; giving up' },
      }),
      this.prisma.deviceCommand.updateMany({
        where: {
          status: 'queued',
          expiresAt: { lt: now, not: null },
        },
        data: { status: 'expired', error: 'TTL expired before device claimed' },
      }),
    ]);
    const total = requeue.count + fail.count + expired.count;
    if (total > 0) {
      this.logger.warn(
        `Swept ${total} stuck device commands (requeued=${requeue.count} failed=${fail.count} expired=${expired.count})`,
      );
    }
    return total;
  }

  async listForDevice(tenantId: string, deviceId: string, filters?: { status?: string; limit?: number }) {
    return this.prisma.deviceCommand.findMany({
      where: {
        tenantId,
        deviceId,
        ...(filters?.status ? { status: filters.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters?.limit ?? 100, 500),
    });
  }
}
