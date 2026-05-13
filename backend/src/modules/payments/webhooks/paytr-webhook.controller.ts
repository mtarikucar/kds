import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  Header,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { addMonths, addYears } from 'date-fns';
import { PrismaService } from '../../../prisma/prisma.service';
import { Public } from '../../auth/decorators/public.decorator';
import { verifyCallbackHash } from './paytr-hash.util';
import { BillingService } from '../../subscriptions/services/billing.service';
import { NotificationService } from '../../subscriptions/services/notification.service';
import { PaytrIpAllowlistGuard } from './paytr-ip-allowlist.guard';
import { CustomerSelfPayService } from '../../customer-orders/services/customer-self-pay.service';
import { encryptString } from '../../../common/helpers/encryption.helper';
import { captureException } from '../../../sentry.config';
import {
  BillingCycle,
  PaymentProvider,
  PaymentStatus,
  SubscriptionStatus,
} from '../../../common/constants/subscription.enum';

interface PaytrCallbackBody {
  merchant_oid?: string;
  status?: string;
  total_amount?: string;
  hash?: string;
  failed_reason_code?: string;
  failed_reason_msg?: string;
  payment_type?: string;
  currency?: string;
  test_mode?: string;
  // PayTR returns these when stored-card / recurring is enabled.
  utoken?: string;
}

type PaymentWithSubscription = NonNullable<
  Awaited<ReturnType<PrismaService['subscriptionPayment']['findUnique']>>
> & { subscription: any };

/**
 * PayTR posts to this endpoint server-to-server after the user completes
 * (or fails) the hosted payment. The contract:
 *
 *   - Verify HMAC-SHA256 over `${merchant_oid}${salt}${status}${total_amount}`.
 *   - Always respond with plain text "OK" or "FAIL".
 *   - Be idempotent: the same callback may arrive multiple times.
 *   - Respond "OK" for unknown merchant_oids so PayTR doesn't keep
 *     retrying (and so we don't leak which OIDs exist).
 *
 * The IP allowlist guard is *defence in depth* — HMAC is still the
 * primary authentication. The guard quietly drops non-allowlisted IPs
 * with OK; the controller never sees them.
 */
@Controller('webhooks/paytr')
export class PaytrWebhookController {
  private readonly logger = new Logger(PaytrWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly billing: BillingService,
    private readonly notifications: NotificationService,
    private readonly selfPay: CustomerSelfPayService,
  ) {}

  @Post()
  @Public()
  @UseGuards(PaytrIpAllowlistGuard)
  @HttpCode(200)
  @Header('Content-Type', 'text/plain')
  async handle(@Body() body: PaytrCallbackBody): Promise<string> {
    const merchantOid = body.merchant_oid ?? '';
    const status = body.status ?? '';
    const totalAmount = body.total_amount ?? '';
    const providedHash = body.hash ?? '';

    const merchantKey = this.config.get<string>('PAYTR_MERCHANT_KEY');
    const merchantSalt = this.config.get<string>('PAYTR_MERCHANT_SALT');
    if (!merchantKey || !merchantSalt) {
      this.logger.error('PayTR credentials missing — rejecting callback');
      return 'FAIL';
    }

    if (
      !verifyCallbackHash({
        merchantOid,
        merchantSalt,
        status,
        totalAmount,
        merchantKey,
        providedHash,
      })
    ) {
      this.logger.warn(`Rejected PayTR callback with bad hash for oid=${merchantOid}`);
      return 'FAIL';
    }

    // Dispatch by merchantOid prefix: "SP" → customer self-pay
    // (QR-menu restaurant-order flow), default → subscription flow.
    if (merchantOid.startsWith('SP')) {
      if (status === 'success') {
        await this.selfPay.handleWebhookSuccess(merchantOid, body.payment_type);
      } else {
        await this.selfPay.handleWebhookFailure(
          merchantOid,
          body.failed_reason_msg ?? body.failed_reason_code,
        );
      }
      return 'OK';
    }

    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { paytrMerchantOid: merchantOid },
      include: {
        subscription: {
          include: { plan: true, tenant: true },
        },
      },
    });

    if (!payment) {
      // Idempotent + non-revealing: respond OK so PayTR stops retrying.
      this.logger.warn(`PayTR callback for unknown oid=${merchantOid}`);
      return 'OK';
    }

    // Idempotency: if we've already terminalized this payment, return OK.
    if (
      payment.status === PaymentStatus.SUCCEEDED ||
      payment.status === PaymentStatus.FAILED
    ) {
      return 'OK';
    }

    if (status === 'success') {
      await this.applySuccess(payment, body);
    } else {
      await this.applyFailure(payment, body);
    }

    return 'OK';
  }

  private async applySuccess(
    payment: PaymentWithSubscription,
    body: PaytrCallbackBody,
  ) {
    const subscription = payment.subscription;
    const now = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        // Look up any upgrade-target keyed off the merchantOid.
        const upgrade = await tx.pendingPlanChange.findUnique({
          where: { merchantOid: payment.paytrMerchantOid ?? '' },
          include: { targetPlan: true },
        });

        let finalPlanId = subscription.planId;
        let finalAmount = subscription.amount as Prisma.Decimal;
        let finalCurrency: string = subscription.currency;
        let billingCycle: string = subscription.billingCycle;
        let displayName: string = subscription.plan.displayName;

        if (upgrade) {
          finalPlanId = upgrade.targetPlanId;
          billingCycle = upgrade.billingCycle;
          finalAmount =
            billingCycle === BillingCycle.MONTHLY
              ? (upgrade.targetPlan.monthlyPrice as Prisma.Decimal)
              : (upgrade.targetPlan.yearlyPrice as Prisma.Decimal);
          finalCurrency = upgrade.targetPlan.currency;
          displayName = upgrade.targetPlan.displayName;
        }

        const periodEnd =
          billingCycle === BillingCycle.MONTHLY ? addMonths(now, 1) : addYears(now, 1);

        // Activate / extend the subscription. paymentProvider is rebound
        // to PAYTR on every successful callback — if the subscription
        // previously had EMAIL (legacy contact-based flow), this charge
        // proves they've switched to the self-serve PayTR rail. Renewals
        // going forward will use the recurring token.
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            planId: finalPlanId,
            billingCycle,
            amount: finalAmount,
            currency: finalCurrency,
            paymentProvider: PaymentProvider.PAYTR,
            isTrialPeriod: false,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        });

        // Bind the tenant's currentPlanId; persist recurring token (encrypted
        // at rest) if PayTR returned one. The token effectively grants
        // off-card-presence charge authority, so plaintext would be a
        // catastrophic data-leak risk.
        await tx.tenant.update({
          where: { id: subscription.tenantId },
          data: {
            currentPlanId: finalPlanId,
            ...(body.utoken ? { paytrRecurringToken: encryptString(body.utoken) } : {}),
          },
        });

        // Move the payment to SUCCEEDED with PayTR-provided metadata.
        // Don't paper over a missing payment_type with 'card' — store
        // whatever PayTR actually sent so reports stay honest.
        const succeededPayment = await tx.subscriptionPayment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            paidAt: now,
            paymentMethod: body.payment_type ?? null,
          },
        });

        // Issue the invoice for this payment, KDV-split inside billing.
        // Description is Turkish since invoices target Turkish tenants
        // (PayTR path = paymentRegion === TURKEY). Plan displayName is
        // already Turkish in the seed/constants (Profesyonel, Başlangıç).
        await this.billing.createInvoice(
          tx,
          subscription.id,
          succeededPayment.id,
          finalAmount,
          finalCurrency,
          now,
          periodEnd,
          upgrade
            ? `${displayName} planına yükseltme`
            : `${displayName} planına abonelik`,
        );

        // PendingPlanChange has served its purpose — clean up.
        if (upgrade) {
          await tx.pendingPlanChange.delete({ where: { id: upgrade.id } });
        }
      });

      this.logger.log(
        `PayTR payment succeeded for subscription=${subscription.id} oid=${payment.paytrMerchantOid}`,
      );

      // Best-effort post-commit notifications. Failures are logged but
      // never unwind the activation transaction.
      void this.notifyActivation(subscription.tenantId, subscription.tenant.name);
    } catch (err) {
      // The DB has a partial unique on (tenantId) WHERE status IN
      // (ACTIVE,TRIALING). If two payments for the same tenant race to
      // activate, the loser hits P2002. Mark the duplicate payment as
      // FAILED with a sentinel reason and return OK so PayTR stops
      // retrying — the tenant already has an active subscription, so
      // refunding the duplicate is a manual ops action.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        await this.prisma.subscriptionPayment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failureCode: 'DUPLICATE_ACTIVE_SUBSCRIPTION',
            failureMessage:
              'Tenant already has an active subscription; this charge needs manual refund.',
          },
        });
        this.logger.error(
          `Duplicate-active conflict on PayTR success oid=${payment.paytrMerchantOid} — payment marked FAILED, refund needed`,
        );
        // Real money was taken but we couldn't activate the sub — ops
        // needs to refund. Page Sentry directly; relying on logs alone
        // means this stays buried until someone notices the FAILED row.
        captureException(err, {
          paytrMerchantOid: payment.paytrMerchantOid,
          subscriptionId: subscription.id,
          tenantId: subscription.tenantId,
          severity: 'critical',
          context: 'duplicate-active-subscription-on-paytr-success',
        });
        return;
      }
      throw err;
    }
  }

  /**
   * Re-fetch the activated subscription and fire the relevant
   * notification (subscription-activated for first-time, plan-upgraded
   * for plan switches). All errors swallowed — webhook idempotency
   * doesn't depend on emails landing.
   */
  private async notifyActivation(
    tenantId: string,
    tenantName: string,
  ): Promise<void> {
    try {
      const sub = await this.prisma.subscription.findFirst({
        where: { tenantId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        include: { plan: true },
      });
      if (!sub) return;
      const admin = await this.prisma.user.findFirst({
        where: { tenantId, role: 'ADMIN' },
        select: { email: true },
      });
      if (!admin?.email) return;
      await this.notifications.sendSubscriptionActivated(
        admin.email,
        tenantName,
        sub.plan.displayName,
        sub.billingCycle,
      );
    } catch (err: any) {
      this.logger.error(
        `subscription-activated notification failed for tenant=${tenantId}: ${err?.message}`,
      );
    }
  }

  private async applyFailure(
    payment: any,
    body: PaytrCallbackBody,
  ) {
    await this.prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureCode: body.failed_reason_code ?? null,
        failureMessage: body.failed_reason_msg ?? null,
      },
    });

    // Leave PendingPlanChange in place — the TTL sweeper will pick it up.
    this.logger.warn(
      `PayTR payment failed for oid=${payment.paytrMerchantOid}: ${body.failed_reason_code ?? ''} ${body.failed_reason_msg ?? ''}`,
    );
  }
}
