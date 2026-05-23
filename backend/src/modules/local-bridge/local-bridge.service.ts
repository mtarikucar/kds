import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';

/**
 * Local Bridge Agent registry + telemetry.
 *
 * Lifecycle:
 *   admin issues provisioning token -> status='claiming'
 *   bridge claims                    -> status='claiming' → tokenHash set
 *   first heartbeat                  -> status='online'
 *   60s without heartbeat            -> status='offline'
 *
 * The provisioning token is the secret material the buyer is shown ONCE at
 * order fulfilment. Stored sha256-hashed so a DB read doesn't yield usable
 * claim material. Bearer tokens issued post-claim are similarly hashed.
 */
@Injectable()
export class LocalBridgeService {
  private readonly logger = new Logger(LocalBridgeService.name);
  private static readonly TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
  private static readonly HEARTBEAT_GRACE_MS = 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  private newToken(): string {
    return uuidv7() + '.' + randomBytes(32).toString('base64url');
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Admin: provision a new bridge agent slot for a branch. */
  async createSlot(
    tenantId: string,
    input: { branchId: string; productSku?: string; hostname?: string },
  ) {
    const branch = await this.prisma.branch.findUnique({ where: { id: input.branchId } });
    if (!branch || branch.tenantId !== tenantId) throw new BadRequestException('Branch not found');

    const provisioningToken = this.newToken();
    const row = await this.prisma.localBridgeAgent.create({
      data: {
        tenantId,
        branchId: input.branchId,
        provisioningTokenHash: this.hash(provisioningToken),
        productSku: input.productSku,
        hostname: input.hostname,
        status: 'claiming',
      },
    });

    return {
      bridgeId: row.id,
      // ⚠ shown to the operator exactly once; printed on packing slip or
      // embedded at manufacturing. Never retrievable afterwards.
      provisioningToken,
    };
  }

  /** Bridge: exchange provisioning token for a long-lived bearer token. */
  async claim(input: { provisioningToken: string; hostname?: string; os?: string; agentVersion?: string }) {
    const provisioningTokenHash = this.hash(input.provisioningToken);
    const row = await this.prisma.localBridgeAgent.findFirst({
      where: { provisioningTokenHash, status: 'claiming' },
    });
    if (!row) throw new NotFoundException('Invalid or already-used provisioning token');

    const token = this.newToken();
    const updated = await this.prisma.localBridgeAgent.update({
      where: { id: row.id },
      data: {
        tokenHash: this.hash(token),
        tokenExpiresAt: new Date(Date.now() + LocalBridgeService.TOKEN_TTL_MS),
        // Provisioning token is single-use — clear it.
        provisioningTokenHash: null,
        provisionedAt: new Date(),
        hostname: input.hostname ?? row.hostname,
        os: input.os ?? row.os,
        agentVersion: input.agentVersion ?? row.agentVersion,
        status: 'online',
        lastSeenAt: new Date(),
      },
    });

    await this.outbox
      .append({
        type: 'bridge.provisioned.v1',
        tenantId: row.tenantId,
        payload: { bridgeId: row.id, branchId: row.branchId },
      })
      .catch(() => undefined);

    return {
      bridgeId: updated.id,
      tenantId: updated.tenantId,
      branchId: updated.branchId,
      token,
      tokenExpiresAt: updated.tokenExpiresAt,
    };
  }

  async authenticateToken(rawToken: string) {
    if (!rawToken) return null;
    const tokenHash = this.hash(rawToken);
    const row = await this.prisma.localBridgeAgent.findFirst({ where: { tokenHash } });
    if (!row) return null;
    if (row.tokenExpiresAt && row.tokenExpiresAt < new Date()) return null;
    return row;
  }

  async heartbeat(
    bridgeId: string,
    payload: { hostname?: string; os?: string; agentVersion?: string },
  ) {
    await this.prisma.localBridgeAgent.update({
      where: { id: bridgeId },
      data: {
        status: 'online',
        lastSeenAt: new Date(),
        hostname: payload.hostname,
        os: payload.os,
        agentVersion: payload.agentVersion,
      },
    });
    return { ok: true };
  }

  async sweepStale(): Promise<number> {
    const cutoff = new Date(Date.now() - LocalBridgeService.HEARTBEAT_GRACE_MS);
    const res = await this.prisma.localBridgeAgent.updateMany({
      where: { status: 'online', lastSeenAt: { lt: cutoff } },
      data: { status: 'offline' },
    });
    return res.count;
  }

  list(tenantId: string, branchId?: string) {
    return this.prisma.localBridgeAgent.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async retire(tenantId: string, bridgeId: string) {
    const row = await this.prisma.localBridgeAgent.findUnique({ where: { id: bridgeId } });
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Bridge not found');
    return this.prisma.localBridgeAgent.update({
      where: { id: bridgeId },
      data: { status: 'retired', tokenHash: null, provisioningTokenHash: null },
    });
  }
}
