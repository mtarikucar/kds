import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  PaymentIntent,
  PaymentIntentRequest,
  PaymentMode,
  PaymentProvider,
  PaymentTransaction,
  ProviderWebhookEvent,
  RefundRequest,
  RefundTransaction,
} from '../payment-provider.interface';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { PaytrAdapter } from '../../payments/adapters/paytr.adapter';

/**
 * Thin shim that exposes the existing PaytrAdapter behind the
 * provider-neutral PaymentProvider interface.
 *
 * Why a shim rather than a refactor of PaytrAdapter itself: the live PayTR
 * code paths in PaymentsService and SubscriptionService still operate on
 * adapter-shaped inputs. Bridging without touching those paths means the
 * new mixed-cart checkout and the existing subscription billing can both
 * route through the same façade — yet a regression in either is bounded to
 * its own surface.
 *
 * Mode coverage today: 'online' only (PayTR iframe). Card-present is a
 * separate provider once an acquirer integration is signed.
 */
@Injectable()
export class PaytrPaymentProvider implements PaymentProvider, OnModuleInit {
  readonly id = 'paytr';
  readonly modes: PaymentMode[] = ['online'];
  private readonly logger = new Logger(PaytrPaymentProvider.name);

  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly paytr: PaytrAdapter,
  ) {}

  onModuleInit(): void {
    // Only register if PayTR credentials are present in the environment.
    // The check is duplicated from PaytrAdapter so we don't blow up at boot
    // in dev environments that haven't configured the merchant keys.
    if (process.env.PAYTR_MERCHANT_ID && process.env.PAYTR_MERCHANT_KEY) {
      this.registry.register(this);
    } else {
      this.logger.warn('PayTR credentials missing — provider not registered');
    }
  }

  async createIntent(req: PaymentIntentRequest): Promise<PaymentIntent> {
    // Hardware checkout calls in here too — PayTR's iframe flow expects
    // (amount, oid, email, basket). The basket is a single line for
    // hardware orders; subscriptions already provide a multi-line basket
    // upstream via BillingService and don't usually call this façade.
    //
    // PayTR uses email + IP for fraud scoring. Sending placeholder values
    // ("unknown@example.com" / "0.0.0.0") pollutes the acquirer's risk model
    // and can get the merchant flagged. Require the real values explicitly
    // and reject the intent if they're missing — failing here is better
    // than silently submitting bad telemetry.
    const buyer = req.buyer ?? {};
    const missing: string[] = [];
    if (!buyer.email) missing.push('buyer.email');
    if (!buyer.name) missing.push('buyer.name');
    if (!buyer.phone) missing.push('buyer.phone');
    if (!req.buyerIp) missing.push('buyerIp');
    if (missing.length > 0) {
      throw new BadRequestException(
        `PayTR intent requires: ${missing.join(', ')}. Provide them at checkout — fraud-scoring needs real values.`,
      );
    }
    const result = await this.paytr.getIframeToken({
      amount: req.amountCents / 100,
      merchantOid: req.externalRef.slice(0, 64),
      email: buyer.email!,
      userName: buyer.name!,
      userAddress: typeof buyer.address === 'string' ? buyer.address : 'N/A',
      userPhone: buyer.phone!,
      userIp: req.buyerIp!,
      userBasket: [[req.purpose, String(req.amountCents / 100), 1]],
      okUrl: req.returnUrl ?? 'https://hummytummy.com/checkout/success',
      failUrl: req.returnUrl ?? 'https://hummytummy.com/checkout/failure',
    });
    return {
      providerId: this.id,
      intentId: result.merchantOid,
      status: 'pending',
      amountCents: req.amountCents,
      currency: req.currency,
      clientAction: { iframeToken: result.token, paymentLink: result.paymentLink },
    };
  }

  async status(intentId: string): Promise<PaymentTransaction> {
    // PayTR settlement is webhook-driven, but the façade exposes a polling
    // shape too. Use the inquiry endpoint as the source of truth.
    const inq = (await this.paytr.inquiryStatus(intentId)) as any;
    const rawStatus = String(inq?.status ?? '').toLowerCase();
    return {
      providerId: this.id,
      intentId,
      status:
        rawStatus === 'success' || rawStatus === 'succeeded'
          ? 'succeeded'
          : rawStatus === 'failed'
            ? 'failed'
            : 'pending',
      amountCents: Math.round(parseFloat(inq?.totalAmount ?? '0') * 100),
      currency: 'TRY',
      acquirerRef: inq?.reference,
      raw: inq,
    };
  }

  async refund(req: RefundRequest): Promise<RefundTransaction> {
    const out = await this.paytr.refund({
      merchantOid: req.intentId,
      amount: req.amountCents ? req.amountCents / 100 : undefined,
    } as any);
    return {
      providerId: this.id,
      intentId: req.intentId,
      refundId: (out as any).refundId ?? (out as any).reference ?? req.idempotencyKey,
      status: (out as any).status === 'SUCCEEDED' ? 'refunded' : 'failed',
      amountCents: req.amountCents ?? 0,
    };
  }

  async parseWebhook(_signature: string, raw: Buffer | string): Promise<ProviderWebhookEvent[]> {
    // PayTR's webhook verification lives in the legacy webhook controller;
    // here we just normalise the post-verification body.
    const body = typeof raw === 'string' ? raw : raw.toString('utf8');
    let parsed: any = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      // PayTR sends application/x-www-form-urlencoded; the legacy controller
      // hands us the parsed object via the raw arg in test mode.
      parsed = { _raw: body };
    }
    return [{ providerId: this.id, type: parsed.event ?? 'payment.notification', payload: parsed }];
  }

  async healthCheck() {
    return { ok: Boolean(process.env.PAYTR_MERCHANT_ID), details: { configured: Boolean(process.env.PAYTR_MERCHANT_ID) } };
  }
}
