import { Injectable, Logger, Optional } from "@nestjs/common";
import { captureSwallowedEmit } from "../../common/observability/capture-swallowed-emit";
import { MetricsService } from "../../common/metrics/metrics.service";
import { OutboxService } from "../outbox/outbox.service";
import {
  PaymentIntent,
  PaymentIntentRequest,
} from "./payment-provider.interface";
import { PaymentProviderRegistry } from "./payment-provider.registry";

/**
 * Provider-neutral payments façade.
 *
 * The only live caller is CheckoutIntentService, which calls
 * createIntent("paytr", …) for the mixed-cart checkout rail. The façade keeps
 * a uniform surface so a future provider can be added without touching the
 * caller. Status/refund/webhook-ingest helpers were removed (2026-06-24): they
 * had zero callers and the ingest path was explicitly never wired (it lacked a
 * replay-dedup gate). The real refund/webhook paths live in their own modules
 * (PayTR webhook controller, integration-gateway ingest).
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
}
