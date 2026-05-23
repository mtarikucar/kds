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
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, tenantId: true, status: true },
    });
    if (!device || device.tenantId !== tenantId) throw new NotFoundException('Device not found');
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
    const cmd = await this.prisma.deviceCommand.findUnique({ where: { id: commandId } });
    if (!cmd || cmd.deviceId !== deviceId) throw new NotFoundException('Command not found');
    if (cmd.status !== 'inflight') throw new BadRequestException(`Cannot ack — status is ${cmd.status}`);

    // Failed commands with retries remaining go back to `queued`; otherwise
    // they terminate in `failed`. Done commands are terminal regardless.
    let nextStatus: 'done' | 'failed' | 'queued' = input.status;
    if (input.status === 'failed' && cmd.attempts < CommandQueueService.MAX_ATTEMPTS) {
      nextStatus = 'queued';
    }

    const updated = await this.prisma.deviceCommand.update({
      where: { id: commandId },
      data: {
        status: nextStatus,
        result: (input.result as any) ?? undefined,
        error: input.error ?? null,
        ackedAt: input.status === 'done' || nextStatus === 'failed' ? new Date() : null,
      },
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
   */
  async sweepStuck(): Promise<number> {
    const stale = await this.prisma.deviceCommand.findMany({
      where: {
        status: 'inflight',
        // 5 minutes is generous; covers slow ESC/POS receipts.
        // expiresAt is the wall clock TTL, but a stuck inflight is detected
        // by lack of ack rather than TTL.
        // Using updatedAt would require a separate column; for now use a
        // 5-minute wall-clock window from createdAt + attempts*minute.
        // Conservative — false positives just retry.
        createdAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { id: true, attempts: true, tenantId: true, deviceId: true, kind: true },
    });
    let requeued = 0;
    for (const c of stale) {
      const nextStatus = c.attempts < CommandQueueService.MAX_ATTEMPTS ? 'queued' : 'failed';
      await this.prisma.deviceCommand.update({
        where: { id: c.id },
        data: {
          status: nextStatus,
          error: nextStatus === 'failed' ? 'No ack received; giving up' : 'No ack received; requeued',
        },
      });
      requeued++;
    }
    if (requeued > 0) this.logger.warn(`Swept ${requeued} stuck device commands`);
    return requeued;
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
