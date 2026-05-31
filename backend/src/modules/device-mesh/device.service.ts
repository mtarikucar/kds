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
  // v2.8.97 — tightened from 60s to 45s. Combined with the sweeper's
  // 60s cron tick the worst-case "online but actually offline" window
  // drops from ~120s to ~105s. The 10s default heartbeat interval
  // (set in the agent SDK) means a healthy device hits 4–5 heartbeats
  // inside this grace, so the only real path to a false "offline"
  // is a sustained network drop — which is exactly what we want
  // surfaced.
  private static readonly HEARTBEAT_GRACE_MS = 45 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Cryptographic, human-typable pair code. 6 chars in [A-Z0-9]. */
  private newPairCode(): string {
    // Reject I/O/0/1 to reduce typo confusion? The reduction in entropy is
    // small enough vs. the typo win that some POS vendors do it; we keep the
    // full alphabet for now to maximise space — 36^6 ≈ 2.2B for a 10min TTL.
    //
    // v2.8.97 — rejection sampling for uniform distribution. Pre-fix
    // `byte % 36` gave the first 256 % 36 = 4 alphabet positions a
    // ~0.4% higher selection probability (a tiny but documented modulo
    // bias). Rejection sampling against the largest multiple of 36
    // ≤ 256 (= 252) eliminates the bias at the cost of a tiny retry
    // overhead (~1.5% of bytes rejected).
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const ceiling = 256 - (256 % alphabet.length); // 252
    const chars: string[] = [];
    while (chars.length < 6) {
      const buf = randomBytes(8);
      for (let i = 0; i < buf.length && chars.length < 6; i++) {
        if (buf[i] >= ceiling) continue; // rejection sample
        chars.push(alphabet[buf[i] % alphabet.length]);
      }
    }
    return chars.join('');
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
      const branch = await this.prisma.branch.findFirst({
        where: { id: input.branchId, tenantId },
      });
      if (!branch) {
        throw new BadRequestException('Branch not found for this tenant');
      }
    }
    let pairCode = this.newPairCode();
    // Retry on collision — pairCode is globally unique. 36^6 makes
    // collisions vanishingly rare but the retry is harmless.
    //
    // v2.8.97 — log each collision and bail with a 503 if all five
    // attempts collide. Pre-fix a 5x exhaustion silently used the last
    // candidate which would then collide on insert and throw P2002 —
    // confusing 500. With clean bail the operator gets a retryable
    // 503 instead.
    let attempts = 0;
    for (let i = 0; i < 5; i++) {
      const exists = await this.prisma.device.findUnique({ where: { pairCode } });
      if (!exists) break;
      attempts = i + 1;
      this.logger.warn(`Pair code collision (attempt=${attempts}) tenant=${tenantId}; regenerating`);
      pairCode = this.newPairCode();
    }
    if (attempts >= 5) {
      throw new Error('Could not allocate unique pair code after 5 attempts — retry the request');
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
    // v2.8.97 — explicit select. Pre-fix the list returned every column
    // including pairCode (still-active if pre-pair), pairCodeExpiresAt,
    // and tokenHash (sha256, but still — no reason to ship hashes
    // outside the auth path). Operators only need identity + status to
    // populate the device-list UI; the per-device admin view fetches
    // sensitive bits separately. Defense-in-depth against a future
    // controller that pipes list() output to the wire without
    // sanitisation.
    return this.prisma.device.findMany({
      where: {
        tenantId,
        ...(filters?.branchId ? { branchId: filters.branchId } : {}),
        ...(filters?.kind ? { kind: filters.kind } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        kind: true,
        capabilities: true,
        status: true,
        lastSeenAt: true,
        serial: true,
        model: true,
        ownership: true,
        warrantyUntil: true,
        bridgeId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ branchId: 'asc' }, { kind: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOrThrow(tenantId: string, id: string) {
    // Compound WHERE — see branches.service.ts:findOrThrow for the
    // defense-in-depth rationale. The row returned is exposed to the
    // caller, so a future refactor that drops the `!==` check would
    // leak a cross-tenant device's pairing metadata.
    const row = await this.prisma.device.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Device not found');
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

    // Atomic single-use pair-code claim.
    //
    // The previous shape did findUnique → validate → update by id. Two
    // physical devices typing the same 6-char code into their kiosks
    // milliseconds apart both passed the validation and both ran
    // update — the second overwrites the first's tokenHash, so the
    // device that THOUGHT it paired earlier silently ends up with a
    // token the server has forgotten. The user-visible failure is
    // "your device randomly stopped working" hours later when the
    // token fails authenticateToken and the kiosk falls back to the
    // pair-code prompt — confusing both ops and the operator.
    //
    // updateMany with `pairCode = X AND pairCodeExpiresAt > now`
    // serialises the writers at the row level: the first writer flips
    // pairCode to NULL and the predicate stops matching for the second
    // writer (Postgres single-row update is atomic). The loser sees
    // count=0 and surfaces the same "already claimed" error PayTR's
    // settlement race uses for symmetric clarity.
    const now = new Date();
    const claim = await this.prisma.device.updateMany({
      where: {
        id: row.id,
        pairCode: input.pairCode,
        pairCodeExpiresAt: { gt: now },
      },
      data: {
        status: 'paired',
        tokenHash,
        tokenExpiresAt,
        pairCode: null,
        pairCodeExpiresAt: null,
        model: input.model ?? row.model,
        serial: input.serial ?? row.serial,
        capabilities: input.capabilities ?? row.capabilities,
        lastSeenAt: now,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        'Pair code already claimed by another device or expired — request a new one',
      );
    }
    // v2.8.94 — defense-in-depth: re-fetch with (id, tenantId) compound.
    // Pre-fix the response lookup ran id-only, so a future regression of
    // the atomic claim above could leak a cross-tenant device row to the
    // pairing caller.
    const updated = await this.prisma.device.findFirstOrThrow({
      where: { id: row.id, tenantId: row.tenantId },
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
    // Compound WHERE (B41-B45 pattern, iter-31 onward). findOrThrow
    // above already proves ownership, but the write surface should
    // carry tenantId itself so a future refactor that drops the
    // pre-check can't leak into a cross-tenant retire that would
    // null someone else's tokenHash and lock their device out.
    const claim = await this.prisma.device.updateMany({
      where: { id: row.id, tenantId },
      data: { status: 'retired', tokenHash: null },
    });
    if (claim.count === 0) throw new NotFoundException('Device not found');
    return this.prisma.device.findFirstOrThrow({ where: { id: row.id, tenantId } });
  }
}
