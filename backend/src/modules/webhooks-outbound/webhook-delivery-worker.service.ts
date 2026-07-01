import { Injectable, Logger, Optional } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { MetricsService } from "../../common/metrics/metrics.service";
import { withAdvisoryLock } from "../../common/scheduling/advisory-lock";
import { WebhookOutboundService } from "./webhook-outbound.service";
import { stripCorrelationMeta } from "../outbox/outbox.service";
import {
  assertPublicHttpUrl,
  UnsafeUrlError,
} from "../../common/net/url-safety";

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
  private static readonly BACKOFF_MS = [
    30_000,
    2 * 60_000,
    10 * 60_000,
    60 * 60_000,
    6 * 60 * 60_000,
  ];
  private static readonly AUTO_PAUSE_AFTER = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbound: WebhookOutboundService,
    // Optional so unit tests constructing the worker bare keep working.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Track 2 — record one finished webhook delivery attempt for Prometheus.
   * ?.-guarded so metrics can never break or stall delivery. `result` is the
   * developer-controlled success|failure enum, so label cardinality is fixed.
   */
  private recordDelivery(result: "success" | "failure"): void {
    this.metrics?.incCounter(
      "webhook_delivery_total",
      "Outbound webhook delivery attempts by result (success|failure)",
      { result },
    );
  }

  /**
   * Record a failed delivery against the SUBSCRIPTION: bump consecutiveFailures
   * atomically and auto-pause once AUTO_PAUSE_AFTER is crossed. Shared by EVERY
   * endpoint-health failure branch (HTTP non-2xx, thrown network error, and the
   * SSRF re-check rejection). Previously only the HTTP non-2xx branch did this,
   * so a persistently UNREACHABLE endpoint — connection refused / timeout / DNS
   * failure, which throw a network error rather than returning an HTTP response,
   * the MOST common dead-endpoint case — never advanced consecutiveFailures and
   * was NEVER auto-paused. The SSRF branch's own comment already claimed the
   * threshold would "catch a misconfigured-or-malicious endpoint quickly", but
   * it didn't feed the counter either.
   *
   * NOT called for payload-purged (a retention issue, not endpoint health) or
   * unseal-secret (a legacy-migration config error) terminal failures.
   */
  private async recordSubscriptionFailure(
    subscriptionId: string,
    lastDeliveryCode: number,
  ): Promise<void> {
    const updated = await this.prisma.tenantWebhookSubscription.update({
      where: { id: subscriptionId },
      data: {
        lastDeliveryAt: new Date(),
        lastDeliveryCode,
        consecutiveFailures: { increment: 1 },
      },
      select: { id: true, consecutiveFailures: true },
    });
    if (
      updated.consecutiveFailures >=
      WebhookDeliveryWorkerService.AUTO_PAUSE_AFTER
    ) {
      // Status-guarded so a concurrent worker that already paused us doesn't
      // trip a no-op log line.
      const r = await this.prisma.tenantWebhookSubscription.updateMany({
        where: { id: subscriptionId, status: "active" },
        data: { status: "paused" },
      });
      if (r.count > 0) {
        this.logger.warn(
          `Auto-paused subscription ${subscriptionId} after ${updated.consecutiveFailures} failures`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    // Without the lock, two replicas would each `findMany` the same 50 due
    // rows and double-POST to every tenant URL. The webhook spec says
    // at-least-once delivery — but doubling the QPS for free is silly, and
    // we'd also race the auto-pause threshold from both sides.
    await withAdvisoryLock(
      this.prisma,
      "webhooks.delivery.tick",
      () => this.tickOnce(),
      this.logger,
    );
  }

  /** Inner body — extracted so tests can call it without the lock wrapper. */
  async tickOnce(): Promise<void> {
    try {
      const due = await this.prisma.webhookDelivery.findMany({
        where: {
          status: "pending",
          OR: [{ nextAttemptAt: { lte: new Date() } }, { nextAttemptAt: null }],
        },
        take: 50,
        orderBy: { nextAttemptAt: "asc" },
        include: { subscription: true },
      });

      for (const d of due) {
        if (d.subscription.status !== "active") continue;
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
    // Strip the internal _meta correlation envelope so it never reaches the
    // external receiver / the HMAC-signed body.
    const payload = stripCorrelationMeta(
      (await this.loadPayload(d.eventId)) as Record<string, unknown> | null,
    );
    if (payload == null) {
      this.logger.warn(
        `webhook ${d.id}: source outbox event ${d.eventId} no longer exists; marking failed`,
      );
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: "failed",
          lastStatusCode: 0,
          lastResponseSnippet:
            "source event purged before delivery — payload unavailable",
        },
      });
      this.recordDelivery("failure");
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
      this.logger.warn(
        `webhook ${d.id}: cannot unseal secret: ${(e as Error).message}`,
      );
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: "failed",
          lastStatusCode: 0,
          lastResponseSnippet:
            "subscription predates KMS encryption — tenant must re-subscribe",
        },
      });
      this.recordDelivery("failure");
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
      const msg =
        e instanceof UnsafeUrlError ? e.message : "invalid webhook URL";
      this.logger.warn(`webhook ${d.id}: URL safety check failed: ${msg}`);
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: "failed",
          attempts: d.attempts + 1,
          lastStatusCode: 0,
          lastResponseSnippet: `URL rejected by SSRF guard: ${msg}`,
        },
      });
      // Feed the auto-pause threshold (this branch's whole purpose per the
      // comment above) — a URL that keeps failing the SSRF re-check is an
      // endpoint-health failure.
      await this.recordSubscriptionFailure(d.subscriptionId, 0);
      this.recordDelivery("failure");
      return;
    }

    try {
      const res = await fetch(d.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "HummyTummy-Webhook/1",
          "X-HummyTummy-Event-Id": d.eventId,
          "X-HummyTummy-Event-Type": d.eventType,
          "X-HummyTummy-Signature": signature,
        },
        body,
        // Cap one delivery at 15s. Without this a slow-loris sink would
        // hold the worker tick (30s cron) hostage and starve every other
        // delivery in this and the next tick.
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text().catch(() => "");
      const success = res.status >= 200 && res.status < 300;
      const attempts = d.attempts + 1;
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: success
            ? "delivered"
            : attempts >= WebhookDeliveryWorkerService.BACKOFF_MS.length
              ? "failed"
              : "pending",
          attempts,
          lastStatusCode: res.status,
          lastResponseSnippet: text.slice(0, 500),
          deliveredAt: success ? new Date() : null,
          nextAttemptAt: success
            ? null
            : new Date(
                Date.now() +
                  (WebhookDeliveryWorkerService.BACKOFF_MS[attempts - 1] ??
                    6 * 60 * 60_000),
              ),
        },
      });
      this.recordDelivery(success ? "success" : "failure");

      // Atomic increment + threshold check in one statement so two parallel
      // failing deliveries can't miss the auto-pause threshold by racing the
      // read-then-write pattern. updateMany with a conditional WHERE on the
      // post-increment value flips status only when this delivery's failure
      // is the one that crosses the line.
      if (success) {
        await this.prisma.tenantWebhookSubscription.update({
          where: { id: d.subscriptionId },
          data: {
            lastDeliveryAt: new Date(),
            lastDeliveryCode: res.status,
            consecutiveFailures: 0,
          },
        });
      } else {
        await this.recordSubscriptionFailure(d.subscriptionId, res.status);
      }
    } catch (e) {
      // Network error — no status code, treat like 599.
      const attempts = d.attempts + 1;
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status:
            attempts >= WebhookDeliveryWorkerService.BACKOFF_MS.length
              ? "failed"
              : "pending",
          attempts,
          lastStatusCode: 0,
          lastResponseSnippet: (e as Error).message.slice(0, 500),
          nextAttemptAt: new Date(
            Date.now() +
              (WebhookDeliveryWorkerService.BACKOFF_MS[attempts - 1] ??
                6 * 60 * 60_000),
          ),
        },
      });
      // A thrown network error (connection refused / timeout / DNS failure) is
      // an endpoint-health failure too — count it toward auto-pause, otherwise
      // an endpoint that's simply DOWN never trips the threshold.
      await this.recordSubscriptionFailure(d.subscriptionId, 0);
      this.recordDelivery("failure");
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
