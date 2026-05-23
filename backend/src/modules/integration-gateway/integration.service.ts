import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';

/**
 * Integration Gateway: catalog of installable providers, tenant-side
 * connection management, and webhook ingestion.
 *
 * Credentials are envelope-encrypted at rest. The key is derived from the
 * server's `INTEGRATION_KEY` env var using HKDF-style sha256 against the
 * tenantId so a single leaked key doesn't cross-decrypt other tenants'
 * credentials. Real KMS lands in Phase 12.
 */
@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  // -- Provider catalog --------------------------------------------------

  listProviders(kind?: string) {
    return this.prisma.integrationProviderDef.findMany({
      where: { status: 'published', ...(kind ? { kind } : {}) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  async findProviderOrThrow(id: string) {
    const row = await this.prisma.integrationProviderDef.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Provider not found: ${id}`);
    return row;
  }

  // -- Connection management --------------------------------------------

  async connect(
    tenantId: string,
    input: { providerId: string; branchId?: string; credentials?: Record<string, unknown>; config?: Record<string, unknown> },
  ) {
    const provider = await this.findProviderOrThrow(input.providerId);
    if (provider.status !== 'published') throw new BadRequestException('Provider not available');

    const credentialsEnc = input.credentials
      ? this.encrypt(tenantId, JSON.stringify(input.credentials))
      : null;

    const row = await this.prisma.integrationConnection.create({
      data: {
        id: uuidv7(),
        tenantId,
        branchId: input.branchId,
        providerId: input.providerId,
        // Prisma's Bytes column expects Uint8Array; the Node@22 lib.dom
        // typings narrowed `Buffer` such that a direct assignment trips
        // the structural check on SharedArrayBuffer. Widen explicitly.
        credentialsEnc: credentialsEnc ? new Uint8Array(credentialsEnc) : null,
        config: input.config as any,
        status: 'connected',
      },
    });
    await this.outbox
      .append({
        type: 'integration.connected.v1',
        tenantId,
        payload: { connectionId: row.id, providerId: input.providerId },
      })
      .catch(() => undefined);
    return row;
  }

  async listMyConnections(tenantId: string) {
    return this.prisma.integrationConnection.findMany({
      where: { tenantId },
      include: { provider: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async disconnect(tenantId: string, connectionId: string) {
    const row = await this.prisma.integrationConnection.findFirst({
      where: { id: connectionId, tenantId },
    });
    if (!row) throw new NotFoundException('Connection not found');
    // Compound WHERE on the write too — providerId outbox emit below
    // reads from `row`, but the update itself must remain tenant-scoped
    // in case the row's tenantId mutates (today it can't, but defense-
    // in-depth).
    await this.prisma.integrationConnection.updateMany({
      where: { id: connectionId, tenantId },
      data: { status: 'disconnected', credentialsEnc: null },
    });
    await this.outbox
      .append({
        type: 'integration.disconnected.v1',
        tenantId,
        payload: { connectionId, providerId: row.providerId },
      })
      .catch(() => undefined);
  }

  // -- Webhook ingestion -------------------------------------------------

  // Cap on stored webhook payload bytes. Real provider webhooks are
  // generally <10kB; bigger requests are either misconfigured or hostile.
  // Storing the full body in JSONB unbounded is a storage-flood vector
  // against the public /v1/integrations/webhooks/* route.
  private static readonly WEBHOOK_MAX_BYTES = 64 * 1024;

  async ingestWebhook(
    providerId: string,
    tenantId: string | null,
    headers: Record<string, string | string[] | undefined>,
    raw: Buffer,
  ) {
    // Storage-DoS guard. The public route accepts any (providerId, tenantId)
    // from the URL and previously wrote unconditionally — a spammer could
    // pour rows into integration_webhook_events for non-existent tenants /
    // providers. Validate both exist first; on miss we still return a 200
    // (no NotFoundException) so the caller — likely the real provider on
    // a typo'd URL — doesn't see a hint that other paths return 200, and
    // PayTR-style infinite-retry providers don't hammer us indefinitely.
    // Internal observability via the logger gets the operator's attention.
    if (!tenantId) {
      this.logger.warn(`Dropping webhook with empty tenantId (provider=${providerId})`);
      return { ignored: true, reason: 'missing tenant' };
    }
    const [tenant, provider] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }),
      this.prisma.integrationProviderDef.findUnique({ where: { id: providerId }, select: { id: true } }),
    ]);
    if (!tenant) {
      this.logger.warn(`Dropping webhook for unknown tenantId=${tenantId} (provider=${providerId})`);
      return { ignored: true, reason: 'unknown tenant' };
    }
    if (!provider) {
      this.logger.warn(`Dropping webhook for unknown providerId=${providerId} (tenant=${tenantId})`);
      return { ignored: true, reason: 'unknown provider' };
    }

    // Bound the body BEFORE JSON.parse so a 100MB blob doesn't burn CPU
    // building a giant object only to be rejected after.
    if (raw.length > IntegrationService.WEBHOOK_MAX_BYTES) {
      this.logger.warn(
        `Dropping oversized webhook body (provider=${providerId} tenant=${tenantId} bytes=${raw.length})`,
      );
      return { ignored: true, reason: 'payload too large' };
    }

    const signature = String(headers['x-signature'] ?? headers['x-hub-signature-256'] ?? headers['stripe-signature'] ?? '').slice(0, 200);
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      // Some providers send urlencoded — leave parsed as raw bytes in payload.
      parsed = { _raw: raw.toString('utf8') };
    }

    const row = await this.prisma.integrationWebhookEvent.create({
      data: {
        id: uuidv7(),
        tenantId,
        connectionId: null,
        providerId,
        type: parsed?.type ?? parsed?.event ?? 'unknown',
        signature,
        payload: parsed as any,
        result: 'received',
      },
    });

    await this.outbox
      .append({
        type: `integration.webhook.${providerId}.received.v1`,
        tenantId,
        payload: { webhookEventId: row.id, providerId, type: row.type },
      })
      .catch(() => undefined);

    return row;
  }

  // -- Crypto helpers ----------------------------------------------------

  private deriveKey(tenantId: string): Buffer {
    const base = process.env.INTEGRATION_KEY;
    if (!base) {
      // Hard fail in production. The earlier fallback to a literal string
      // ("dev-only-do-not-use-in-prod") meant a deploy with a missing env
      // var silently used a key that lives in the source — anyone with
      // read access to the repo could decrypt every tenant's integration
      // credentials. Dev/test still falls back so local workflows don't
      // demand the env be set.
      if (process.env.NODE_ENV === 'production') {
        throw new Error('INTEGRATION_KEY env var must be set in production');
      }
      return createHash('sha256').update(`dev-only-do-not-use-in-prod:${tenantId}`).digest();
    }
    // Per-tenant key derivation — leaking one tenant's payload doesn't help
    // decrypt another's. Cheap and fast; replace with KMS-issued DEKs.
    return createHash('sha256').update(`${base}:${tenantId}`).digest();
  }

  private encrypt(tenantId: string, plaintext: string): Buffer {
    const key = this.deriveKey(tenantId);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: iv (12) || tag (16) || ct
    return Buffer.concat([iv, tag, ct]);
  }

  // Currently unused but kept paired with encrypt for symmetry; callers will
  // pull credentials via this helper when adapters are wired live.
  decrypt(tenantId: string, blob: Buffer): string {
    const key = this.deriveKey(tenantId);
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const ct = blob.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}
