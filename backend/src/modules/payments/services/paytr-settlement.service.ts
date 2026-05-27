import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { addMonths, addYears } from "date-fns";
import { PrismaService } from "../../../prisma/prisma.service";
import { BillingService } from "../../subscriptions/services/billing.service";
import { NotificationService } from "../../subscriptions/services/notification.service";
import { captureException } from "../../../sentry.config";
import {
  BillingCycle,
  PaymentProvider,
  PaymentStatus,
  SubscriptionStatus,
} from "../../../common/constants/subscription.enum";

/**
 * Settlement outcome from PayTR — same shape produced by the webhook
 * callback and by the inquiry-status sweeper, so both code paths
 * converge here.
 */
export type SettlementOutcome =
  | {
      kind: "success";
      paymentType?: string;
      totalAmount?: string;
    }
  | {
      kind: "failure";
      failureCode?: string;
      failureMessage?: string;
    };

export type SettlementResult =
  | "OK"
  | "UNKNOWN_OID"
  | "ALREADY_TERMINAL"
  | "DUPLICATE_ACTIVE_REFUND_NEEDED";

/**
 * Thrown inside the settlement tx when the SubscriptionPayment row was
 * already transitioned out of PENDING by a concurrent settle (webhook
 * retry / recovery sweeper). Caught by `applySuccess`'s outer catch
 * and translated to a clean ALREADY_TERMINAL return.
 */
class SettlementAlreadyTerminalError extends Error {
  constructor() {
    super("Settlement already terminal");
    this.name = "SettlementAlreadyTerminalError";
  }
}

type PaymentWithSubscription = NonNullable<
  Awaited<ReturnType<PrismaService["subscriptionPayment"]["findUnique"]>>
> & { subscription: any };

/**
 * Shared settlement engine. Two callers:
 *
 *   1. `PaytrWebhookController` — fires on the real-time PayTR callback.
 *   2. `subscription-scheduler.service` — hourly sweeper that asks PayTR
 *      what the real status is for stuck PENDING payments.
 *
 * Both produce the same `SettlementOutcome`; this service handles the
 * lookup, idempotency, transaction, notifications, and commission
 * crediting.
 *
 * Returns a non-throwing enum so the webhook controller can keep
 * responding "OK" to PayTR (preventing infinite retries) regardless of
 * what happened internally. Errors that need ops attention go to Sentry.
 */
@Injectable()
export class PaytrSettlementService {
  private readonly logger = new Logger(PaytrSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly notifications: NotificationService,
  ) {}

  async settlePayment(
    merchantOid: string,
    outcome: SettlementOutcome,
  ): Promise<SettlementResult> {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { paytrMerchantOid: merchantOid },
      include: {
        subscription: {
          include: { plan: true, tenant: true },
        },
      },
    });

    if (!payment) {
      this.logger.warn(`Settlement for unknown merchantOid=${merchantOid}`);
      return "UNKNOWN_OID";
    }

    if (
      payment.status === PaymentStatus.SUCCEEDED ||
      payment.status === PaymentStatus.FAILED ||
      payment.status === PaymentStatus.REFUNDED
    ) {
      return "ALREADY_TERMINAL";
    }

    if (outcome.kind === "success") {
      return this.applySuccess(payment as PaymentWithSubscription, outcome);
    } else {
      await this.applyFailure(payment, outcome);
      return "OK";
    }
  }

  private async applySuccess(
    payment: PaymentWithSubscription,
    outcome: Extract<SettlementOutcome, { kind: "success" }>,
  ): Promise<SettlementResult> {
    const subscription = payment.subscription;
    const now = new Date();

    // Captured inside the transaction, used after commit to fire the
    // UPSELL commission. `null` when this charge was a fresh activation
    // rather than an upgrade.
    let upgradeContext: {
      planId: string;
      amount: Prisma.Decimal;
      commissionRate: Prisma.Decimal;
    } | null = null;
    // Signup commission for self-serve referral checkouts — populated
    // only when this charge isn't an upgrade *and* the payment carries
    // a resolved referrer. Mutually exclusive with `upgradeContext`.
    let signupContext: {
      marketerId: string;
      referralCode: string | null;
      amount: Prisma.Decimal;
      commissionRate: Prisma.Decimal;
    } | null = null;
    // Renewal commission for the marketing rep who originally converted
    // this tenant. Fires when the subscription already has at least one
    // prior SUCCEEDED payment (manual re-purchase model: each new cycle
    // is a fresh checkout, not an auto-charge).
    let renewalContext: {
      planId: string;
      amount: Prisma.Decimal;
      commissionRate: Prisma.Decimal;
    } | null = null;

    try {
      await this.prisma.$transaction(async (tx) => {
        const upgrade = await tx.pendingPlanChange.findUnique({
          where: { merchantOid: payment.paytrMerchantOid ?? "" },
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
          upgradeContext = {
            planId: upgrade.targetPlanId,
            amount: finalAmount,
            commissionRate:
              (upgrade.targetPlan.commissionRate as Prisma.Decimal) ??
              new Prisma.Decimal(0.1),
          };
        } else if (payment.referredByMarketingUserId) {
          // Fresh activation with a referral code on the payment.
          // Use payment.amount, not subscription.amount — a tenant
          // arriving here from a BUSINESS trial has subscription.amount=0
          // (trial period) until this transaction updates it. The
          // payment row carries the canonical price the customer is
          // being charged. commissionRate falls back to 0.10 for plans
          // that predate the per-plan rate column.
          signupContext = {
            marketerId: payment.referredByMarketingUserId,
            referralCode: payment.referralCode ?? null,
            amount: payment.amount as Prisma.Decimal,
            commissionRate:
              (subscription.plan.commissionRate as Prisma.Decimal) ??
              new Prisma.Decimal(0.1),
          };
        }

        const periodEnd =
          billingCycle === BillingCycle.MONTHLY
            ? addMonths(now, 1)
            : addYears(now, 1);

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

        await tx.tenant.update({
          where: { id: subscription.tenantId },
          data: { currentPlanId: finalPlanId },
        });

        // Renewal detection: any prior SUCCEEDED payment on this same
        // subscription means this charge is a re-purchase, not the
        // initial activation. Marketing rep gets a RENEWAL commission
        // (separate from SIGNUP which fires at first activation, and
        // UPSELL which fires on plan-tier changes).
        if (!upgrade) {
          const priorSucceeded = await tx.subscriptionPayment.count({
            where: {
              subscriptionId: subscription.id,
              status: PaymentStatus.SUCCEEDED,
              id: { not: payment.id },
            },
          });
          if (priorSucceeded > 0) {
            renewalContext = {
              planId: finalPlanId,
              amount: finalAmount,
              commissionRate:
                (subscription.plan.commissionRate as Prisma.Decimal) ??
                new Prisma.Decimal(0.1),
            };
          }
        }

        // Atomic claim: only the first settlement transition transitions
        // PENDING → SUCCEEDED. The outer line 85-91 status check is a
        // fast-path filter, but webhook-retry + recovery-sweeper firing
        // for the same merchantOid within the READ COMMITTED window
        // would BOTH pass that check, BOTH enter applySuccess, BOTH run
        // billing.createInvoice — producing duplicate invoices for the
        // same charge. updateMany with status=PENDING in the WHERE
        // serialises them; the loser throws ALREADY_TERMINAL upstream
        // by aborting the transaction.
        const claimResult = await tx.subscriptionPayment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PENDING },
          data: {
            status: PaymentStatus.SUCCEEDED,
            paidAt: now,
            paymentMethod: outcome.paymentType ?? null,
          },
        });
        if (claimResult.count === 0) {
          throw new SettlementAlreadyTerminalError();
        }
        const succeededPayment = await tx.subscriptionPayment.findUniqueOrThrow({
          where: { id: payment.id },
        });

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

        if (upgrade) {
          await tx.pendingPlanChange.delete({ where: { id: upgrade.id } });
        }
      });

      this.logger.log(
        `Settlement succeeded for subscription=${subscription.id} oid=${payment.paytrMerchantOid}`,
      );

      // Fire-and-forget after the settlement transaction commits. Each
      // callee wraps its own body in try/catch, but `void` alone does
      // NOT catch promise rejections — if a sync throw ever escaped
      // those inner blocks (Node ≥15 default), the whole API process
      // would die mid-request. The outer `.catch` is a process-level
      // safety net; it never masks real bugs because the inner catch
      // already logs.
      this.notifyActivation(
        subscription.tenantId,
        subscription.tenant.name,
      ).catch((err) =>
        this.logger.error(
          `unhandled notifyActivation rejection for tenant=${subscription.tenantId}: ${err?.message ?? err}`,
        ),
      );

      if (upgradeContext) {
        this.creditUpsellCommission(
          subscription.tenantId,
          upgradeContext as {
            planId: string;
            amount: Prisma.Decimal;
            commissionRate: Prisma.Decimal;
          },
        ).catch((err) =>
          this.logger.error(
            `unhandled creditUpsellCommission rejection for tenant=${subscription.tenantId}: ${err?.message ?? err}`,
          ),
        );
      } else if (renewalContext) {
        this.creditRenewalCommission(
          subscription.tenantId,
          renewalContext as {
            planId: string;
            amount: Prisma.Decimal;
            commissionRate: Prisma.Decimal;
          },
        ).catch((err) =>
          this.logger.error(
            `unhandled creditRenewalCommission rejection for tenant=${subscription.tenantId}: ${err?.message ?? err}`,
          ),
        );
      } else if (signupContext) {
        this.creditSignupCommissionForReferral(
          subscription.tenantId,
          subscription.tenant?.name ?? subscription.tenantId,
          signupContext as {
            marketerId: string;
            referralCode: string | null;
            amount: Prisma.Decimal;
            commissionRate: Prisma.Decimal;
          },
        ).catch((err) =>
          this.logger.error(
            `unhandled creditSignupCommissionForReferral rejection for tenant=${subscription.tenantId}: ${err?.message ?? err}`,
          ),
        );
      }
      return "OK";
    } catch (err) {
      // Concurrent settle (webhook retry / recovery sweeper) already
      // transitioned this payment. Surface ALREADY_TERMINAL cleanly so
      // the caller stays idempotent — the winning transaction will
      // have created the invoice + notifications.
      if (err instanceof SettlementAlreadyTerminalError) {
        return "ALREADY_TERMINAL";
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        await this.prisma.subscriptionPayment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failureCode: "DUPLICATE_ACTIVE_SUBSCRIPTION",
            failureMessage:
              "Tenant already has an active subscription; this charge needs manual refund.",
          },
        });
        this.logger.error(
          `Duplicate-active conflict on settlement success oid=${payment.paytrMerchantOid} — payment marked FAILED, refund needed`,
        );
        captureException(err, {
          paytrMerchantOid: payment.paytrMerchantOid,
          subscriptionId: subscription.id,
          tenantId: subscription.tenantId,
          severity: "critical",
          context: "duplicate-active-subscription-on-paytr-success",
        });
        return "DUPLICATE_ACTIVE_REFUND_NEEDED";
      }
      throw err;
    }
  }

  private async applyFailure(
    payment: any,
    outcome: Extract<SettlementOutcome, { kind: "failure" }>,
  ): Promise<void> {
    await this.prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureCode: outcome.failureCode ?? null,
        failureMessage: outcome.failureMessage ?? null,
      },
    });
    this.logger.warn(
      `Settlement failed for oid=${payment.paytrMerchantOid}: ${outcome.failureCode ?? ""} ${outcome.failureMessage ?? ""}`,
    );
  }

  /**
   * Re-fetch the activated subscription and fire the relevant
   * notification (subscription-activated for first-time, plan-upgraded
   * for plan switches). All errors swallowed — settlement idempotency
   * doesn't depend on emails landing.
   */
  private async notifyActivation(
    tenantId: string,
    tenantName: string,
  ): Promise<void> {
    try {
      const sub = await this.prisma.subscription.findFirst({
        where: { tenantId, status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        include: { plan: true },
      });
      if (!sub) return;
      const admin = await this.prisma.user.findFirst({
        where: { tenantId, role: "ADMIN" },
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

  /**
   * Stamp a PENDING UPSELL commission for the marketing rep who
   * originally converted this tenant, when a plan upgrade has just
   * been activated.
   */
  private async creditUpsellCommission(
    tenantId: string,
    upgrade: {
      planId: string;
      amount: Prisma.Decimal;
      commissionRate: Prisma.Decimal;
    },
  ): Promise<void> {
    try {
      const lead = await this.prisma.lead.findFirst({
        where: { convertedTenantId: tenantId },
        select: { id: true, assignedToId: true },
      });
      if (!lead?.assignedToId) return;

      const commissionAmount = new Prisma.Decimal(upgrade.amount)
        .mul(upgrade.commissionRate)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (commissionAmount.lte(0)) return;

      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      await this.prisma.commission.create({
        data: {
          amount: commissionAmount,
          type: "UPSELL",
          status: "PENDING",
          period,
          tenantId,
          leadId: lead.id,
          marketingUserId: lead.assignedToId,
        },
      });
      this.logger.log(
        `Upsell commission created for tenant=${tenantId} rep=${lead.assignedToId} amount=${commissionAmount}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Upsell commission credit failed for tenant=${tenantId}: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Stamp a PENDING RENEWAL commission for the marketing rep who
   * originally converted this tenant, when an existing subscription
   * gets a re-purchase payment. In the manual-renewal model, every
   * cycle after the first triggers this (the user paid through the
   * normal checkout flow; settlement detects the prior SUCCEEDED row
   * and routes the credit here).
   *
   * Replaces the old cron-driven renewal commission credit — manual
   * re-purchase has no cron, so the credit lives with the settlement
   * that actually moved the money.
   */
  private async creditRenewalCommission(
    tenantId: string,
    renewal: {
      planId: string;
      amount: Prisma.Decimal;
      commissionRate: Prisma.Decimal;
    },
  ): Promise<void> {
    try {
      const lead = await this.prisma.lead.findFirst({
        where: { convertedTenantId: tenantId },
        select: { id: true, assignedToId: true },
      });
      if (!lead?.assignedToId) return;

      const commissionAmount = new Prisma.Decimal(renewal.amount)
        .mul(renewal.commissionRate)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (commissionAmount.lte(0)) return;

      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      await this.prisma.commission.create({
        data: {
          amount: commissionAmount,
          type: "RENEWAL",
          status: "PENDING",
          period,
          tenantId,
          leadId: lead.id,
          marketingUserId: lead.assignedToId,
        },
      });
      this.logger.log(
        `Renewal commission created for tenant=${tenantId} rep=${lead.assignedToId} amount=${commissionAmount}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Renewal commission credit failed for tenant=${tenantId}: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Self-serve SIGNUP commission. Fires when a fresh activation
   * (no PendingPlanChange) carries a resolved marketer referral on
   * the payment row. Idempotent on `(tenantId, type='SIGNUP')`: a
   * webhook retry, or an admin Lead.convert() race, won't double-credit.
   *
   * When no Lead exists for this tenant yet we plant one with
   * source=REFERRAL + status=WON + convertedTenantId — that's the
   * link the RENEWAL/UPSELL hooks (subscription-scheduler,
   * creditUpsellCommission above) read from, so lifetime commissions
   * accrue without any extra wiring. When a Lead already exists
   * (admin manually convert()ed first), the admin's attribution wins
   * and we leave both the Lead and the absence of a self-serve SIGNUP
   * row untouched.
   *
   * Best-effort: a failure here is logged but never unwinds the
   * payment-success transaction — getting paid takes priority over
   * stamping a commission row.
   */
  private async creditSignupCommissionForReferral(
    tenantId: string,
    tenantName: string,
    ctx: {
      marketerId: string;
      referralCode: string | null;
      amount: Prisma.Decimal;
      commissionRate: Prisma.Decimal;
    },
  ): Promise<void> {
    try {
      const existingSignup = await this.prisma.commission.findFirst({
        where: { tenantId, type: "SIGNUP" },
        select: { id: true },
      });
      if (existingSignup) {
        this.logger.log(
          `SIGNUP commission already exists for tenant=${tenantId}; skipping referral credit`,
        );
        return;
      }

      const existingLead = await this.prisma.lead.findUnique({
        where: { convertedTenantId: tenantId },
        select: { id: true, assignedToId: true },
      });

      let leadId: string;
      let marketerId: string;
      if (existingLead) {
        // Admin already attributed this tenant. Use the admin's rep,
        // not the self-serve code's marketer — manual attribution wins.
        leadId = existingLead.id;
        marketerId = existingLead.assignedToId ?? ctx.marketerId;
      } else {
        const lead = await this.prisma.lead.create({
          data: {
            businessName: tenantName,
            contactPerson: tenantName,
            businessType: "OTHER",
            source: "REFERRAL",
            status: "WON",
            assignedToId: ctx.marketerId,
            convertedTenantId: tenantId,
            convertedAt: new Date(),
            notes: ctx.referralCode
              ? `Auto-created from self-serve checkout (ref code: ${ctx.referralCode})`
              : "Auto-created from self-serve checkout referral",
          },
          select: { id: true },
        });
        leadId = lead.id;
        marketerId = ctx.marketerId;
      }

      const commissionAmount = new Prisma.Decimal(ctx.amount)
        .mul(ctx.commissionRate)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (commissionAmount.lte(0)) {
        this.logger.warn(
          `Skipping SIGNUP commission for tenant=${tenantId}: computed amount is zero`,
        );
        return;
      }

      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      await this.prisma.commission.create({
        data: {
          amount: commissionAmount,
          type: "SIGNUP",
          status: "PENDING",
          period,
          tenantId,
          leadId,
          marketingUserId: marketerId,
          notes: ctx.referralCode
            ? `Self-serve checkout via referral code ${ctx.referralCode}`
            : "Self-serve checkout referral",
        },
      });

      // Notify the marketer via the in-app notification stream. Best
      // effort — the commission row itself is the source of truth.
      try {
        await this.prisma.marketingNotification.create({
          data: {
            userId: marketerId,
            type: "FOLLOW_UP_REMINDER",
            title: "Yeni referans kaydı",
            message: `${tenantName} kodunuzla abone oldu — komisyon: ${commissionAmount.toString()} TL (onay bekliyor)`,
            metadata: {
              tenantId,
              leadId,
              commissionAmount: commissionAmount.toString(),
              referralCode: ctx.referralCode ?? null,
            },
          },
        });
      } catch (notifyErr: any) {
        this.logger.warn(
          `Failed to enqueue marketer notification for tenant=${tenantId}: ${notifyErr?.message ?? notifyErr}`,
        );
      }

      this.logger.log(
        `SIGNUP commission credited for tenant=${tenantId} marketer=${marketerId} amount=${commissionAmount}`,
      );
    } catch (err: any) {
      this.logger.error(
        `SIGNUP commission credit failed for tenant=${tenantId}: ${err?.message ?? err}`,
      );
      captureException(err, {
        tenantId,
        context: "signup-commission-credit-failed",
      });
    }
  }
}
