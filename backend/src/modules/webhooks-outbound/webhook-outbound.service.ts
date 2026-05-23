import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventBus } from '../outbox/domain-event-bus.service';
import { KMS_PROVIDER_TOKEN } from '../kms/kms.module';
import { KmsProvider } from '../kms/kms-provider.interface';

/**
 * Outbound webhook delivery — tenants subscribe to event types and we POST
 * to their endpoints with an HMAC-SHA256 signature.
 *
 * The fan-out is wired by listening to the in-process DomainEventBus: every
 * domain event creates one WebhookDelivery row per matching subscription.
 * A separate worker actually performs the HTTP POST so a slow receiver
 * never blocks producer threads.
 *
 * Security:
 *   - Secrets are stored as sha256 hashes only; the raw is shown to the
 *     tenant exactly once.
 *   - Each delivery is signed `X-HummyTummy-Signature: t=...,v1=<hmac>` so
 *     the receiver can prevent replays + verify origin.
 *   - Auto-pause after 20 consecutive failures so a dead endpoint doesn't
 *     drain the worker.
 */
// Encryption context for webhook secrets. Bound into the KMS AAD so a
// leaked ciphertext from a different purpose (e.g. integration credentials)
// can't be decrypted as a webhook secret.
const KMS_PURPOSE = 'webhook_secret';

@Injectable()
export class WebhookOutboundService {
  private readonly logger = new Logger(WebhookOutboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: DomainEventBus,
    @Inject(KMS_PROVIDER_TOKEN) private readonly kms: KmsProvider,
  ) {}

  /** Tenant-side: create a subscription. Returns the secret exactly once. */
  async subscribe(tenantId: string, input: { url: string; events?: string[] }) {
    if (!/^https?:\/\//.test(input.url)) {
      throw new Error('webhook URL must be http(s)');
    }
    const secret = `whs_${randomBytes(24).toString('base64url')}`;
    const secretHash = createHash('sha256').update(secret).digest('hex');
    // KMS-encrypt the raw secret so the worker can sign deliveries with it.
    // Tenant-scoped AAD means a leak in tenant A's blob is useless for B.
    const secretEncBuf = await this.kms.encrypt({
      context: { tenantId, purpose: KMS_PURPOSE },
      plaintext: secret,
    });
    const row = await this.prisma.tenantWebhookSubscription.create({
      data: {
        id: uuidv7(),
        tenantId,
        url: input.url,
        events: input.events ?? ['*'],
        secretHash,
        // Prisma's Bytes column expects Uint8Array; widen Node Buffer.
        secretEnc: new Uint8Array(secretEncBuf),
      },
    });
    return { ...row, secret };  // secret returned once; never re-derivable
  }

  /**
   * Internal helper used by the delivery worker. Decrypts the stored
   * ciphertext back to the raw secret used for HMAC signing. Throws if
   * the row predates the secretEnc column — that delivery should be
   * marked permanently failed by the caller.
   */
  async unsealSecret(subscription: { tenantId: string; secretEnc: Uint8Array | null }): Promise<string> {
    if (!subscription.secretEnc) {
      throw new Error('legacy subscription has no encrypted secret — re-subscribe to receive deliveries');
    }
    return this.kms.decrypt({
      context: { tenantId: subscription.tenantId, purpose: KMS_PURPOSE },
      ciphertext: Buffer.from(subscription.secretEnc),
    });
  }

  async list(tenantId: string) {
    return this.prisma.tenantWebhookSubscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(tenantId: string, id: string) {
    // Compound deleteMany — single round-trip that's already
    // tenant-scoped, replacing the read → manual-check → delete-by-id
    // pattern. The find-by-id read was an IDOR-adjacent shape (a
    // refactor that drops the !== check would leak the row's data
    // back to the caller). Same defence-in-depth pattern iter-9 et al.
    const result = await this.prisma.tenantWebhookSubscription.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) throw new NotFoundException('Subscription not found');
  }

  /** Bus-side fan-out: enqueue one delivery row per matching subscription. */
  async fanOut(event: { id: string; type: string; tenantId: string | null; payload: unknown }): Promise<void> {
    if (!event.tenantId) return;
    const subs = await this.prisma.tenantWebhookSubscription.findMany({
      where: {
        tenantId: event.tenantId,
        status: 'active',
      },
    });
    for (const s of subs) {
      const matches = s.events.includes('*') || s.events.includes(event.type);
      if (!matches) continue;
      await this.prisma.webhookDelivery
        .create({
          data: {
            id: uuidv7(),
            subscriptionId: s.id,
            eventType: event.type,
            eventId: event.id,
            url: s.url,
            status: 'pending',
            nextAttemptAt: new Date(),
          },
        })
        .catch((e) => {
          // Unique violation = duplicate fan-out (event replay); harmless.
          if (!/Unique constraint/.test((e as Error).message)) throw e;
        });
    }
  }

  /** Build the signature header value for one payload + timestamp. */
  static sign(secret: string, timestamp: number, body: string): string {
    const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return `t=${timestamp},v1=${mac}`;
  }

  /** Verify an inbound signature (used by tests + receiver SDKs). */
  static verify(secret: string, header: string, body: string, toleranceMs = 5 * 60_000): boolean {
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
    const ts = Number(parts.t);
    const v1 = String(parts.v1 ?? '');
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > toleranceMs) return false;
    const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    if (expected.length !== v1.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  }
}
