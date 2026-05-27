import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { withAdvisoryLock } from '../../common/scheduling/advisory-lock';
import { WebhookOutboundService } from './webhook-outbound.service';
import { assertPublicHttpUrl, UnsafeUrlError } from '../../common/net/url-safety';

/**
 * Drains pending webhook deliveries and POSTs them.
 *
 * Runs every 30s; on each tick claims up to 50 pending rows and walks them.
 * Backoff: 30s, 2m, 10m, 1h, 6h (5 attempts cap). After 20 consecutive
 * failures the parent subscription is auto-paused.
 */
@Injectable()
export class WebhookDeliveryWorkerService {
  private readonly logger = new Logger(WebhookDeliveryWorkerService.name);
  private static readonly BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
  private static readonly AUTO_PAUSE_AFTER = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbound: WebhookOutboundService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    // Without the lock, two replicas would each `findMany` the same 50 due
    // rows and double-POST to every tenant URL. The webhook spec says
    // at-least-once delivery — but doubling the QPS for free is silly, and
    // we'd also race the auto-pause threshold from both sides.
    await withAdvisoryLock(
      this.prisma,
      'webhooks.delivery.tick',
      () => this.tickOnce(),
      this.logger,
    );
  }

  /** Inner body — extracted so tests can call it without the lock wrapper. */
  async tickOnce(): Promise<void> {
    try {
      const due = await this.prisma.webhookDelivery.findMany({
        where: {
          status: 'pending',
          OR: [{ nextAttemptAt: { lte: new Date() } }, { nextAttemptAt: null }],
        },
        take: 50,
        orderBy: { nextAttemptAt: 'asc' },
        include: { subscription: true },
      });

      for (const d of due) {
        if (d.subscription.status !== 'active') continue;
        await this.attempt(d);
      }
    } catch (e) {
      this.logger.warn(`webhook delivery tick failed: ${(e as Error).message}`);
    }
  }

  private async attempt(d: any): Promise<void> {
    // The outbox payload is loaded lazily from outbox_events. If retention
    // purged the source event (long-pending delivery + aggressive purge
    // policy), `loadPayload` returns null — sending {"payload":null} to
    // the receiver is silent data loss they can't detect. Mark this
    // delivery `failed` with an actionable message instead.
    const payload = await this.loadPayload(d.eventId);
    if (payload == null) {
      this.logger.warn(`webhook ${d.id}: source outbox event ${d.eventId} no longer exists; marking failed`);
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: 'failed',
          lastStatusCode: 0,
          lastResponseSnippet: 'source event purged before delivery — payload unavailable',
        },
      });
      return;
    }

    const body = JSON.stringify({
      id: d.eventId,
      type: d.eventType,
      tenantId: d.subscription.tenantId,
      payload,
    });
    const ts = Date.now();

    // Decrypt the raw secret stored at subscribe time so the HMAC matches
    // what the receiver computes with their copy. Legacy subscriptions
    // (pre-KMS migration) have a null secretEnc — those go straight to
    // `failed` with a clear message so ops sees them in the dashboard and
    // the tenant re-subscribes.
    let signature: string;
    try {
      const rawSecret = await this.outbound.unsealSecret(d.subscription);
      signature = WebhookOutboundService.sign(rawSecret, ts, body);
    } catch (e) {
      this.logger.warn(`webhook ${d.id}: cannot unseal secret: ${(e as Error).message}`);
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: 'failed',
          lastStatusCode: 0,
          lastResponseSnippet: 'subscription predates KMS encryption — tenant must re-subscribe',
        },
      });
      return;
    }

    // Re-validate the URL against the SSRF allowlist immediately before
    // fetching. The subscribe-time check caught the obvious cases, but a
    // tenant-controlled DNS server can answer "public IP" at subscribe
    // and "private IP" here (DNS rebind). Marking the delivery `failed`
    // — not retried — means the auto-pause threshold catches a
    // misconfigured-or-malicious endpoint quickly.
    try {
      await assertPublicHttpUrl(d.url);
    } catch (e) {
      const msg = e instanceof UnsafeUrlError ? e.message : 'invalid webhook URL';
      this.logger.warn(`webhook ${d.id}: URL safety check failed: ${msg}`);
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: 'failed',
          attempts: d.attempts + 1,
          lastStatusCode: 0,
          lastResponseSnippet: `URL rejected by SSRF guard: ${msg}`,
        },
      });
      return;
    }

    try {
      const res = await fetch(d.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'HummyTummy-Webhook/1',
          'X-HummyTummy-Event-Id': d.eventId,
          'X-HummyTummy-Event-Type': d.eventType,
          'X-HummyTummy-Signature': signature,
        },
        body,
        // Cap one delivery at 15s. Without this a slow-loris sink would
        // hold the worker tick (30s cron) hostage and starve every other
        // delivery in this and the next tick.
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text().catch(() => '');
      const success = res.status >= 200 && res.status < 300;
      const attempts = d.attempts + 1;
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: success ? 'delivered' : attempts >= WebhookDeliveryWorkerService.BACKOFF_MS.length ? 'failed' : 'pending',
          attempts,
          lastStatusCode: res.status,
          lastResponseSnippet: text.slice(0, 500),
          deliveredAt: success ? new Date() : null,
          nextAttemptAt: success
            ? null
            : new Date(Date.now() + (WebhookDeliveryWorkerService.BACKOFF_MS[attempts - 1] ?? 6 * 60 * 60_000)),
        },
      });

      // Atomic increment + threshold check in one statement so two parallel
      // failing deliveries can't miss the auto-pause threshold by racing the
      // read-then-write pattern. updateMany with a conditional WHERE on the
      // post-increment value flips status only when this delivery's failure
      // is the one that crosses the line.
      if (success) {
        await this.prisma.tenantWebhookSubscription.update({
          where: { id: d.subscriptionId },
          data: { lastDeliveryAt: new Date(), lastDeliveryCode: res.status, consecutiveFailures: 0 },
        });
      } else {
        const updated = await this.prisma.tenantWebhookSubscription.update({
          where: { id: d.subscriptionId },
          data: {
            lastDeliveryAt: new Date(),
            lastDeliveryCode: res.status,
            consecutiveFailures: { increment: 1 },
          },
          select: { id: true, consecutiveFailures: true },
        });
        if (updated.consecutiveFailures >= WebhookDeliveryWorkerService.AUTO_PAUSE_AFTER) {
          // Use updateMany with the status guard so a concurrent worker
          // that already paused us doesn't trip a no-op log line race.
          const r = await this.prisma.tenantWebhookSubscription.updateMany({
            where: { id: d.subscriptionId, status: 'active' },
            data: { status: 'paused' },
          });
          if (r.count > 0) {
            this.logger.warn(
              `Auto-paused subscription ${d.subscriptionId} after ${updated.consecutiveFailures} failures`,
            );
          }
        }
      }
    } catch (e) {
      // Network error — no status code, treat like 599.
      const attempts = d.attempts + 1;
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: attempts >= WebhookDeliveryWorkerService.BACKOFF_MS.length ? 'failed' : 'pending',
          attempts,
          lastStatusCode: 0,
          lastResponseSnippet: (e as Error).message.slice(0, 500),
          nextAttemptAt: new Date(
            Date.now() + (WebhookDeliveryWorkerService.BACKOFF_MS[attempts - 1] ?? 6 * 60 * 60_000),
          ),
        },
      });
    }
  }

  private async loadPayload(eventId: string): Promise<unknown> {
    const r = await this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
      select: { payload: true },
    });
    return r?.payload ?? null;
  }
}
