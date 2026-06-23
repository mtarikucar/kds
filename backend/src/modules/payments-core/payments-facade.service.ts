import { Injectable, Logger, Optional } from "@nestjs/common";
import { captureSwallowedEmit } from "../../common/observability/capture-swallowed-emit";
import { MetricsService } from "../../common/metrics/metrics.service";
import { OutboxService } from "../outbox/outbox.service";
import {
  PaymentIntent,
  PaymentIntentRequest,
  PaymentTransaction,
  ProviderWebhookEvent,
  RefundRequest,
  RefundTransaction,
} from "./payment-provider.interface";
import { PaymentProviderRegistry } from "./payment-provider.registry";

/**
 * Provider-neutral payments façade.
 *
 * Every domain caller (subscriptions, hardware-orders, POS) uses this façade
 * and chooses a providerId by tenant region / capability rather than by
 * vendor SDK. The actual PayTR/Stripe/Iyzico code remains in its existing
 * modules; this façade does not replace them — it adds a uniform surface
 * for the new providers and for tests.
 */
@Injectable()
export class PaymentsFacadeService {
  private readonly logger = new Logger(PaymentsFacadeService.name);

  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly outbox: OutboxService,
    // Optional so unit tests constructing the façade bare keep working and
    // so a context without MetricsModule never fails to resolve.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async createIntent(
    providerId: string,
    req: PaymentIntentRequest,
  ): Promise<PaymentIntent> {
    const provider = this.registry.get(providerId);
    const intent = await provider.createIntent(req);

    await this.outbox
      .append({
        type: "payment.intent_created.v1",
        tenantId: req.tenantId,
        payload: {
          providerId,
          intentId: intent.intentId,
          amountCents: intent.amountCents,
          currency: intent.currency,
          externalRef: req.externalRef,
        },
      })
      .catch(
        captureSwallowedEmit(this.logger, {
          module: "payments-core",
          op: "intent_created",
        }),
      );

    // Track 2 — record the intent outcome for Prometheus. After the
    // best-effort emit, optional + ?.-guarded so metrics can never break a
    // payment. `outcome` is derived from the developer-controlled
    // PaymentStatus enum (failed/cancelled → "failed", else "success"), so
    // label cardinality stays bounded.
    const outcome =
      intent.status === "failed" || intent.status === "cancelled"
        ? "failed"
        : "success";
    this.metrics?.incCounter(
      "payment_intents_outcome_total",
      "Payment intents by outcome (success|failed|refunded)",
      { outcome },
    );

    return intent;
  }

  async getStatus(
    providerId: string,
    intentId: string,
  ): Promise<PaymentTransaction> {
    return this.registry.get(providerId).status(intentId);
  }

  async refund(
    providerId: string,
    req: RefundRequest,
    tenantId: string,
  ): Promise<RefundTransaction> {
    const refund = await this.registry.get(providerId).refund(req);
    await this.outbox
      .append({
        type: "payment.refund_completed.v1",
        tenantId,
        payload: { providerId, ...refund },
      })
      .catch(
        captureSwallowedEmit(this.logger, {
          module: "payments-core",
          op: "refund",
        }),
      );
    // Track 2 — a completed refund is the "refunded" outcome of the intent
    // lifecycle. ?.-guarded after the emit so it can never break the refund.
    this.metrics?.incCounter(
      "payment_intents_outcome_total",
      "Payment intents by outcome (success|failed|refunded)",
      { outcome: "refunded" },
    );
    return refund;
  }

  /**
   * Webhook ingestion path. Caller is responsible for routing by HTTP path;
   * the façade verifies signature via the adapter and emits one normalised
   * event per provider event so downstream consumers don't care which
   * vendor produced the message.
   *
   * ⚠️ REPLAY PRECONDITION (do NOT wire an HTTP route to this without it):
   * this method has NO dedup gate. Signed iyzico/paytr webhooks carry no
   * nonce/timestamp in the signed payload, so a captured (body, signature)
   * pair is cryptographically replayable — a replay would re-emit
   * `payment.succeeded` and double-fire settlement consumers. The sibling
   * integration-gateway ingest (IntegrationService.ingestWebhook) already
   * guards this with a Serializable-txn dedup on (tenant, provider, signature)
   * within a 24h window; mirror that BEFORE exposing this façade over HTTP.
   * Today this path is internal-only (no controller reaches it).
   */
  async ingestWebhook(
    providerId: string,
    signature: string,
    raw: Buffer | string,
  ): Promise<void> {
    const events = await this.registry
      .get(providerId)
      .parseWebhook(signature, raw);
    for (const ev of events) {
      await this.outbox
        .append({
          type: `payment.webhook.${ev.type}.v1`,
          tenantId: null,
          payload: ev as any,
        })
        .catch(
          captureSwallowedEmit(this.logger, {
            module: "payments-core",
            op: "ingestWebhook",
          }),
        );
    }
  }

  listInstalledProviders() {
    return this.registry.list().map((p) => ({ id: p.id, modes: p.modes }));
  }
}
