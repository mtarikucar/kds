import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";

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
    return uuidv7() + "." + randomBytes(32).toString("base64url");
  }

  private hash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  /** Admin: provision a new bridge agent slot for a branch. */
  async createSlot(
    tenantId: string,
    input: { branchId: string; productSku?: string; hostname?: string },
  ) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: input.branchId, tenantId },
    });
    if (!branch) throw new BadRequestException("Branch not found");

    const provisioningToken = this.newToken();
    const row = await this.prisma.localBridgeAgent.create({
      data: {
        tenantId,
        branchId: input.branchId,
        provisioningTokenHash: this.hash(provisioningToken),
        productSku: input.productSku,
        hostname: input.hostname,
        status: "claiming",
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
  async claim(input: {
    provisioningToken: string;
    hostname?: string;
    os?: string;
    agentVersion?: string;
  }) {
    const provisioningTokenHash = this.hash(input.provisioningToken);

    // Atomically transition the row out of `claiming` with the provisioning
    // token hash as the matching predicate. updateMany returns count=1 only
    // for the FIRST concurrent claim — the second sees count=0 and gets a
    // clean rejection instead of issuing a duplicate bearer.
    const token = this.newToken();
    const newTokenHash = this.hash(token);
    const tokenExpiresAt = new Date(
      Date.now() + LocalBridgeService.TOKEN_TTL_MS,
    );

    const claim = await this.prisma.localBridgeAgent.updateMany({
      where: { provisioningTokenHash, status: "claiming" },
      data: {
        tokenHash: newTokenHash,
        tokenExpiresAt,
        provisioningTokenHash: null, // single-use
        provisionedAt: new Date(),
        hostname: input.hostname,
        os: input.os,
        agentVersion: input.agentVersion,
        status: "online",
        lastSeenAt: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new NotFoundException("Invalid or already-used provisioning token");
    }

    // Re-read by the new token hash. Doing the lookup-by-result, not by id,
    // keeps the operation race-free even under concurrent identical claims
    // — only the winning replica's token hash points at this row.
    const updated = await this.prisma.localBridgeAgent.findFirstOrThrow({
      where: { tokenHash: newTokenHash },
    });

    // v2.8.95 — log on outbox append failure. Pre-fix
    //   .catch(() => undefined)
    // turned a missed `bridge.provisioned.v1` event into a silent gap
    // — downstream listeners (kds-routing, webhooks-outbound) would
    // never learn this bridge had come online, and the only sign would
    // be the absent inventory entry. The bridge row itself is already
    // committed (the operation needs to be idempotent at the client
    // for retries), but the event miss should at least surface in
    // logs for on-call investigation.
    await this.outbox
      .append({
        type: "bridge.provisioned.v1",
        tenantId: updated.tenantId,
        payload: { bridgeId: updated.id, branchId: updated.branchId },
      })
      .catch((err) => {
        this.logger.error(
          `bridge.provisioned.v1 outbox append failed for bridge=${updated.id} tenant=${updated.tenantId}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      });

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
    const row = await this.prisma.localBridgeAgent.findFirst({
      where: { tokenHash },
    });
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
        status: "online",
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
      where: { status: "online", lastSeenAt: { lt: cutoff } },
      data: { status: "offline" },
    });
    return res.count;
  }

  list(tenantId: string, branchId?: string) {
    return this.prisma.localBridgeAgent.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  async retire(tenantId: string, bridgeId: string) {
    // Atomic claim: compound WHERE both guarantees tenant scope AND
    // gives us the row in one round-trip. The previous find +
    // manual !== check then update-by-id shape was an IDOR-adjacent
    // surface — a refactor that drops the inequality check would
    // retire a cross-tenant bridge and null its tokenHash, locking
    // a different tenant out of their hardware.
    const claim = await this.prisma.localBridgeAgent.updateMany({
      where: { id: bridgeId, tenantId },
      data: { status: "retired", tokenHash: null, provisioningTokenHash: null },
    });
    if (claim.count === 0) throw new NotFoundException("Bridge not found");
    return this.prisma.localBridgeAgent.findFirstOrThrow({
      where: { id: bridgeId, tenantId },
    });
  }
}
