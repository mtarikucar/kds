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
    const row = await this.prisma.integrationConnection.findUnique({ where: { id: connectionId } });
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Connection not found');
    await this.prisma.integrationConnection.update({
      where: { id: connectionId },
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

  async ingestWebhook(
    providerId: string,
    tenantId: string | null,
    headers: Record<string, string | string[] | undefined>,
    raw: Buffer,
  ) {
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
    const base = process.env.INTEGRATION_KEY ?? 'dev-only-do-not-use-in-prod';
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
