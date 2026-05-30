import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { URLSearchParams } from 'url';
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
import { verifyCallbackHash } from '../../payments/webhooks/paytr-hash.util';

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
    private readonly config: ConfigService,
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
    // Currency safety gate (mirrors PaymentsService.createIntent +
    // CustomerSelfPayService.createPayIntent). PayTR collects in TRY
    // only; without this check a USD-priced cart would charge the same
    // numeric amount in TL. The adapter rejects non-TRY too, but
    // surfacing the error here gives the mixed-cart caller a clean
    // 400 before any reservation rows are written.
    if (req.currency !== 'TRY') {
      throw new BadRequestException(
        `PayTR yalnızca TRY ile tahsilat yapar. İstenen para birimi: ${req.currency}.`,
      );
    }
    // v2.8.85: prefer the caller-supplied multi-line basket. PayTR shows
    // each entry verbatim on the iframe, so a checkout that bundles a
    // subscription + an add-on + a yazarkasa needs to read as three lines
    // instead of one opaque "checkout". Fall back to the legacy single
    // line when the caller didn't bother (subscription billing, refunds-
    // forward etc.). When a basket IS supplied, sum-check it against
    // amountCents — PayTR rejects mismatched baskets and "amount silently
    // truncated" failures are murder to debug after the fact.
    let userBasket: Array<[string, string, number]>;
    if (req.basket && req.basket.length > 0) {
      const basketSumCents = req.basket.reduce(
        (acc, line) => acc + line.priceCents * line.qty,
        0,
      );
      if (basketSumCents !== req.amountCents) {
        throw new BadRequestException(
          `PayTR basket sum mismatch: lines total ${basketSumCents} kuruş but amountCents=${req.amountCents}. Repricing drift?`,
        );
      }
      userBasket = req.basket.map((line) => [
        // Sanitise line name: PayTR rejects baskets containing newlines, and
        // gateway logs are easier to read with a length cap.
        line.name.replace(/[\r\n\t]+/g, ' ').slice(0, 80),
        // PayTR expects line subtotal as a decimal string in major units.
        ((line.priceCents * line.qty) / 100).toFixed(2),
        line.qty,
      ]);
    } else {
      userBasket = [[req.purpose, (req.amountCents / 100).toFixed(2), 1]];
    }

    const result = await this.paytr.getIframeToken({
      amount: req.amountCents / 100,
      currency: req.currency,
      merchantOid: req.externalRef.slice(0, 64),
      email: buyer.email!,
      userName: buyer.name!,
      userAddress: typeof buyer.address === 'string' ? buyer.address : 'N/A',
      userPhone: buyer.phone!,
      userIp: req.buyerIp!,
      userBasket,
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

  /**
   * Verify a PayTR callback and normalise it into a ProviderWebhookEvent.
   *
   * Iter-90: prior to this method actually verifying, the façade's
   * `ingestWebhook` would silently emit unverified events to the outbox
   * the moment v2.8.85 wired it to an HTTP route — the same blocker that
   * iter-11 closed on the integration-gateway path. The legacy
   * `/webhooks/paytr` controller still owns the production subscription
   * settlement path; this method exists so the *next* wiring (mixed-cart
   * checkout) inherits hash verification for free.
   *
   * PayTR specifics:
   *   - Body is application/x-www-form-urlencoded, not JSON. The previous
   *     code did `JSON.parse` and fell back to `{ _raw: body }`, which
   *     meant the event payload never carried the real fields.
   *   - The hash lives inside the body (`hash` field), not in a header.
   *     The interface's `signature` arg is therefore unused for PayTR,
   *     same as the Stripe-style header-based providers will keep it.
   *   - Verification uses HMAC-SHA256(merchantKey,
   *     merchantOid+merchantSalt+status+totalAmount) — identical to
   *     `verifyCallbackHash` used by the legacy controller.
   */
  async parseWebhook(_signature: string, raw: Buffer | string): Promise<ProviderWebhookEvent[]> {
    const body = typeof raw === 'string' ? raw : raw.toString('utf8');
    const parsed = this.parsePaytrBody(body);

    const merchantOid = String(parsed.merchant_oid ?? '');
    const status = String(parsed.status ?? '');
    const totalAmount = String(parsed.total_amount ?? '');
    const providedHash = String(parsed.hash ?? '');

    const merchantKey = this.config.get<string>('PAYTR_MERCHANT_KEY');
    const merchantSalt = this.config.get<string>('PAYTR_MERCHANT_SALT');
    if (!merchantKey || !merchantSalt) {
      // Mirrors the legacy controller's posture: if we can't verify, we
      // refuse to emit downstream events. The legacy controller returns
      // "OK" to PayTR to stop retries; the façade path is internal so
      // throwing surfaces the misconfiguration in the caller's logs.
      this.logger.error('PayTR webhook verification skipped — credentials missing in env');
      throw new UnauthorizedException('PayTR webhook verification unavailable');
    }

    if (
      !merchantOid ||
      !status ||
      !totalAmount ||
      !providedHash ||
      !verifyCallbackHash({
        merchantOid,
        merchantSalt,
        status,
        totalAmount,
        merchantKey,
        providedHash,
      })
    ) {
      this.logger.warn(
        `Rejected PayTR façade callback with bad/missing hash for oid=${merchantOid || '<empty>'}`,
      );
      throw new UnauthorizedException('PayTR webhook signature mismatch');
    }

    return [
      {
        providerId: this.id,
        type: status === 'success' ? 'payment.succeeded' : 'payment.failed',
        payload: {
          merchantOid,
          status,
          totalAmount,
          paymentType: parsed.payment_type,
          // Keep the unmasked raw body off the event payload — downstream
          // outbox readers should not need the hash to act, and shipping it
          // around makes it harder to audit who can see it.
        },
      },
    ];
  }

  /**
   * PayTR sends form-urlencoded callbacks. If a caller hands us a JSON
   * body (CI tests do), prefer that. Otherwise fall back to URLSearchParams.
   */
  private parsePaytrBody(body: string): Record<string, string | undefined> {
    if (body.startsWith('{')) {
      try {
        return JSON.parse(body) as Record<string, string | undefined>;
      } catch {
        // fall through to form decode
      }
    }
    const params = new URLSearchParams(body);
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
  }

  async healthCheck() {
    return { ok: Boolean(process.env.PAYTR_MERCHANT_ID), details: { configured: Boolean(process.env.PAYTR_MERCHANT_ID) } };
  }
}
