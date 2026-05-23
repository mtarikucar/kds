import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookOutboundService } from './webhook-outbound.service';

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

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
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
    const body = JSON.stringify({
      id: d.eventId,
      type: d.eventType,
      tenantId: d.subscription.tenantId,
      // The outbox payload itself is loaded lazily from outbox_events. We
      // could embed it on the delivery row but that explodes storage if a
      // tenant subscribes to many event types. Cheap join at delivery time.
      payload: await this.loadPayload(d.eventId),
    });
    const ts = Date.now();
    // We can't derive the raw secret from the stored hash — the signature
    // path requires the raw. The tenant-side receiver verifies with their
    // copy of the secret; here we sign with the hash + ts, which is enough
    // for HummyTummy → tenant authenticity once the tenant SDK stores the
    // raw secret. For receivers without an SDK, this is the spec the docs
    // expose to them.
    const signature = WebhookOutboundService.sign(d.subscription.secretHash, ts, body);

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
      await this.prisma.tenantWebhookSubscription.update({
        where: { id: d.subscriptionId },
        data: {
          lastDeliveryAt: new Date(),
          lastDeliveryCode: res.status,
          consecutiveFailures: success ? 0 : { increment: 1 } as any,
        },
      });

      // Auto-pause when this delivery's failure pushed the subscription
      // past the threshold.
      if (!success) {
        const fresh = await this.prisma.tenantWebhookSubscription.findUnique({
          where: { id: d.subscriptionId },
          select: { consecutiveFailures: true },
        });
        if (fresh && fresh.consecutiveFailures >= WebhookDeliveryWorkerService.AUTO_PAUSE_AFTER) {
          await this.prisma.tenantWebhookSubscription.update({
            where: { id: d.subscriptionId },
            data: { status: 'paused' },
          });
          this.logger.warn(`Auto-paused subscription ${d.subscriptionId} after ${fresh.consecutiveFailures} failures`);
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
