import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';

/**
 * Device registry + pairing + heartbeat + command queue.
 *
 * Lifecycle:
 *   admin creates slot   -> status='unprovisioned', pairCode generated (10m TTL)
 *   device pairs          -> status='paired', tokenHash set, pairCode cleared
 *   first heartbeat       -> status='online', lastSeenAt updated
 *   no heartbeat for 60s  -> status='offline' (set by sweepStale cron)
 *   admin retires         -> status='retired'
 *
 * Tokens are stored as sha256 hashes. The raw token is returned exactly once
 * (at pair time and on refresh) and never persisted.
 */
@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);
  private static readonly PAIR_CODE_TTL_MS = 10 * 60 * 1000;
  private static readonly TOKEN_TTL_MS = 24 * 3600 * 1000;
  private static readonly HEARTBEAT_GRACE_MS = 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Cryptographic, human-typable pair code. 6 chars in [A-Z0-9]. */
  private newPairCode(): string {
    // Reject I/O/0/1 to reduce typo confusion? The reduction in entropy is
    // small enough vs. the typo win that some POS vendors do it; we keep the
    // full alphabet for now to maximise space — 36^6 ≈ 2.2B for a 10min TTL.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = randomBytes(6);
    let s = '';
    for (let i = 0; i < 6; i++) s += alphabet[bytes[i] % alphabet.length];
    return s;
  }

  private newToken(): string {
    return uuidv7() + '.' + randomBytes(24).toString('base64url');
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async createSlot(
    tenantId: string,
    input: { kind: string; branchId?: string; capabilities?: string[]; model?: string; serial?: string; ownership?: 'sold' | 'rented' | 'byo' },
  ) {
    if (input.branchId) {
      const branch = await this.prisma.branch.findUnique({ where: { id: input.branchId } });
      if (!branch || branch.tenantId !== tenantId) {
        throw new BadRequestException('Branch not found for this tenant');
      }
    }
    let pairCode = this.newPairCode();
    // Retry on collision — pairCode is globally unique. 36^6 makes collisions
    // vanishingly rare but the retry is harmless.
    for (let i = 0; i < 5; i++) {
      const exists = await this.prisma.device.findUnique({ where: { pairCode } });
      if (!exists) break;
      pairCode = this.newPairCode();
    }

    const row = await this.prisma.device.create({
      data: {
        tenantId,
        branchId: input.branchId ?? null,
        kind: input.kind,
        capabilities: input.capabilities ?? [],
        status: 'unprovisioned',
        model: input.model,
        serial: input.serial,
        ownership: input.ownership ?? 'byo',
        pairCode,
        pairCodeExpiresAt: new Date(Date.now() + DeviceService.PAIR_CODE_TTL_MS),
      },
    });

    await this.outbox
      .append({
        type: 'device.slot_created.v1',
        tenantId,
        payload: { deviceId: row.id, kind: row.kind, branchId: row.branchId },
      })
      .catch(() => undefined);

    // Return the pair code in the slot-creation response — it's not a
    // secret per se, but it gates pairing for 10 minutes. UI shows it on
    // the screen the operator uses to pair the device.
    return { ...row, pairCode };
  }

  async list(tenantId: string, filters?: { branchId?: string; kind?: string; status?: string }) {
    return this.prisma.device.findMany({
      where: {
        tenantId,
        ...(filters?.branchId ? { branchId: filters.branchId } : {}),
        ...(filters?.kind ? { kind: filters.kind } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      orderBy: [{ branchId: 'asc' }, { kind: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOrThrow(tenantId: string, id: string) {
    const row = await this.prisma.device.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Device not found');
    return row;
  }

  /** Device → server pair. Returns the raw token; never stored raw. */
  async pair(input: { pairCode: string; model?: string; serial?: string; capabilities?: string[] }) {
    const row = await this.prisma.device.findUnique({ where: { pairCode: input.pairCode } });
    if (!row) throw new NotFoundException('Pair code invalid or expired');
    if (!row.pairCodeExpiresAt || row.pairCodeExpiresAt < new Date()) {
      // Atomically clear the expired code so it cannot be reused.
      await this.prisma.device.update({
        where: { id: row.id },
        data: { pairCode: null, pairCodeExpiresAt: null },
      });
      throw new BadRequestException('Pair code expired — request a new one');
    }

    const token = this.newToken();
    const tokenHash = this.hashToken(token);
    const tokenExpiresAt = new Date(Date.now() + DeviceService.TOKEN_TTL_MS);

    const updated = await this.prisma.device.update({
      where: { id: row.id },
      data: {
        status: 'paired',
        tokenHash,
        tokenExpiresAt,
        // Pair code is single-use.
        pairCode: null,
        pairCodeExpiresAt: null,
        model: input.model ?? row.model,
        serial: input.serial ?? row.serial,
        capabilities: input.capabilities ?? row.capabilities,
        lastSeenAt: new Date(),
      },
    });

    await this.outbox
      .append({
        type: 'device.paired.v1',
        tenantId: row.tenantId,
        payload: { deviceId: row.id, kind: row.kind, branchId: row.branchId },
      })
      .catch(() => undefined);

    return {
      deviceId: updated.id,
      tenantId: updated.tenantId,
      branchId: updated.branchId,
      kind: updated.kind,
      token,
      tokenExpiresAt,
      capabilities: updated.capabilities,
    };
  }

  /** Authenticate a device token (raw). Returns the device row. */
  async authenticateToken(rawToken: string) {
    if (!rawToken) return null;
    const tokenHash = this.hashToken(rawToken);
    const row = await this.prisma.device.findFirst({
      where: { tokenHash },
    });
    if (!row) return null;
    if (row.tokenExpiresAt && row.tokenExpiresAt < new Date()) return null;
    return row;
  }

  async heartbeat(deviceId: string, payload: { batteryPct?: number; ip?: string; agentVersion?: string; queueDepth?: number }) {
    const now = new Date();
    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        status: 'online',
        lastSeenAt: now,
      },
    });
    if (payload && Object.keys(payload).length > 0) {
      await this.prisma.deviceLog
        .create({
          data: {
            id: uuidv7(),
            tenantId: (await this.prisma.device.findUnique({ where: { id: deviceId }, select: { tenantId: true } }))!.tenantId,
            deviceId,
            level: 'info',
            category: 'heartbeat',
            message: 'heartbeat',
            payload: payload as any,
          },
        })
        .catch(() => undefined);
    }
    return { ok: true, ts: now.toISOString() };
  }

  /**
   * Background sweep: any device with lastSeenAt older than the grace window
   * gets flipped to offline. Idempotent; safe to run every minute.
   */
  async sweepStale(): Promise<number> {
    const cutoff = new Date(Date.now() - DeviceService.HEARTBEAT_GRACE_MS);
    const res = await this.prisma.device.updateMany({
      where: {
        status: 'online',
        lastSeenAt: { lt: cutoff },
      },
      data: { status: 'offline' },
    });
    if (res.count > 0) this.logger.debug(`Marked ${res.count} devices offline`);
    return res.count;
  }

  async retire(tenantId: string, deviceId: string) {
    const row = await this.findOrThrow(tenantId, deviceId);
    return this.prisma.device.update({
      where: { id: row.id },
      data: { status: 'retired', tokenHash: null },
    });
  }
}
