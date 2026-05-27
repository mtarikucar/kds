import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventBus } from '../outbox/domain-event-bus.service';
import { KMS_PROVIDER_TOKEN } from '../kms/kms.module';
import { KmsProvider } from '../kms/kms-provider.interface';
import { assertPublicHttpUrl, UnsafeUrlError } from '../../common/net/url-safety';

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

// Event-type allowlist gate. Outbound webhooks fire `*` subscriptions for
// every tenant event by default — without this filter, a tenant could
// subscribe `*` and receive internal events that were never intended for
// external receivers (password-reset state, billing internals, audit
// records, KMS rotation flags, etc.). The check runs in fanOut before
// per-subscription matching, so no explicit-named subscription can bypass
// it either.
//
// Block by prefix instead of allowlist to keep adding new business events
// frictionless; only sensitive events need to be added here.
const BLOCKED_EVENT_TYPE_PREFIXES: readonly string[] = [
  'user.password',
  'user.email_verification',
  'auth.',
  'subscription.upgrade.requested',
  'subscription.renewal.failed',
  'subscription.payment.',
  'kms.',
  'audit.',
];

function isPublishableEventType(type: string): boolean {
  return !BLOCKED_EVENT_TYPE_PREFIXES.some((p) => type.startsWith(p));
}

// Per-tenant cap on active subscriptions. Without this a tenant — by
// mistake or by design — can subscribe N endpoints to `*` and turn each
// emitted event into N WebhookDelivery rows + N outbound HTTP attempts.
// Auto-pause after 20 consecutive failures helps tame dead endpoints but
// doesn't bound the *creation* rate, which is the resource-DoS shape
// this cap closes. Default 20 fits even the largest real integrators
// (most use 1–3); ops can raise via env without a deploy if a partner
// genuinely needs more.
const SUBSCRIPTION_CAP_PER_TENANT = Math.max(
  1,
  Number(process.env.WEBHOOK_SUBSCRIPTION_CAP_PER_TENANT ?? '20'),
);

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
    // Resource cap. Count `active` rows only — paused rows don't fan out
    // and shouldn't block the tenant from creating a healthy replacement.
    // We accept the small race window where two concurrent calls both see
    // (cap-1) and create the cap-th row; the absolute bound is N+1 which
    // is acceptable for what is a DoS guard, not a precise quota.
    const activeCount = await this.prisma.tenantWebhookSubscription.count({
      where: { tenantId, status: 'active' },
    });
    if (activeCount >= SUBSCRIPTION_CAP_PER_TENANT) {
      throw new BadRequestException(
        `subscription cap reached (${SUBSCRIPTION_CAP_PER_TENANT}); revoke unused subscriptions first`,
      );
    }

    // SSRF gate. The bare `^https?://` regex used to be all that stood
    // between a tenant and a self-fetch of `169.254.169.254/...` (AWS
    // IMDS) or any internal service — combined with the worker's storage
    // of `lastResponseSnippet` that's a clean authenticated exfil channel
    // for the tenant. assertPublicHttpUrl also blocks userinfo, dangerous
    // ports (Redis, Postgres, …), and IPv4-mapped IPv6 of any of the
    // above. The worker calls it again before each fetch to catch DNS-
    // rebind attacks; this is the subscribe-time front line.
    let canonical: URL;
    try {
      const { url } = await assertPublicHttpUrl(input.url);
      canonical = url;
    } catch (e) {
      const msg = e instanceof UnsafeUrlError ? e.message : 'invalid webhook URL';
      throw new BadRequestException(msg);
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
        // Store the canonical (lowercased-host) URL so duplicate
        // subscriptions for the same endpoint look like duplicates.
        url: canonical.toString(),
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
    // Internal events (password resets, billing internals, audit records,
    // KMS rotation) must never reach an external webhook subscriber. This
    // guard runs *before* per-subscription matching so no explicit-named
    // subscription can opt in either.
    if (!isPublishableEventType(event.type)) return;
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
