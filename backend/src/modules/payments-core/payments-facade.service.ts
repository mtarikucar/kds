import { Injectable, Logger } from "@nestjs/common";
import { captureSwallowedEmit } from "../../common/observability/capture-swallowed-emit";
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
    return refund;
  }

  /**
   * Webhook ingestion path. Caller is responsible for routing by HTTP path;
   * the façade verifies signature via the adapter and emits one normalised
   * event per provider event so downstream consumers don't care which
   * vendor produced the message.
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
