import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { addMonths, addYears } from "date-fns";
import { PrismaService } from "../../../prisma/prisma.service";
import { BillingService } from "../../subscriptions/services/billing.service";
import { NotificationService } from "../../subscriptions/services/notification.service";
import { captureException } from "../../../sentry.config";
import { OutboxService } from "../../outbox/outbox.service";
import { EventTypes } from "../../outbox/event-types";
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
    // v2.8.89: emit SubscriptionActivated / SubscriptionUpgraded after
    // applySuccess so the entitlement projector reprojects. Pre-v2.8.89
    // applySuccess wrote currentPlanId in a Prisma txn but skipped the
    // outbox event, so the projector — which subscribes to
    // SubscriptionActivated/Upgraded — never ran. Paid upgrades stayed
    // stuck on the old plan's grants for up to 24h (until
    // reconcileNightly).
    private readonly outbox: OutboxService,
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
      // v3.0.1 round-3 audit note — the return value collapses three
      // semantically distinct cases into one bucket:
      //   1. Duplicate of the original SUCCESS webhook (PayTR retried)
      //   2. Late webhook for a payment that was refunded post-success
      //   3. Late webhook for a payment that was admin-marked FAILED
      // All three are SAFE to return ALREADY_TERMINAL because: the
      // SUCCESS path's atomic claim (line 254-273) only fires when
      // status=PENDING, so no double credit. Subscription state
      // mutations downstream are gated on the same claim. The merchant
      // OID is the durable idempotency anchor; PayTR retries up to
      // ~12 hours and the response is identical across retries.
      // We log nothing extra here; the operational signal is
      // SubscriptionPayment.status itself + the original settlement's
      // outbox event (refund webhooks are a separate flow that updates
      // status from SUCCEEDED → REFUNDED with its own audit trail).
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

    // Step C marketing decoupling — commission crediting no longer happens
    // here. PayTR settlement (core) determines WHICH commission kind applies
    // and emits a single durable `payment.succeeded.v1` inside the settlement
    // transaction; the marketing-owned SettlementCommissionConsumer reacts to
    // it and owns the lead lookup + commission write. Payments no longer reads
    // `lead` or writes `commission`/`marketingNotification`.

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

        // Commission event capture (Step C). Determines the kind + amount +
        // rate that ride payment.succeeded.v1. Precedence mirrors the old
        // post-tx dispatch order — upgrade → upsell; else prior-succeeded →
        // renewal (set in the block below); else referral → signup.
        let commissionKind: "signup" | "renewal" | "upsell" | null = null;
        let commissionAmount: Prisma.Decimal = new Prisma.Decimal(0);
        let commissionRate: Prisma.Decimal = new Prisma.Decimal(0.1);
        let commissionPlanCode: string = subscription.plan.name;

        if (upgrade) {
          finalPlanId = upgrade.targetPlanId;
          billingCycle = upgrade.billingCycle;
          finalAmount =
            billingCycle === BillingCycle.MONTHLY
              ? (upgrade.targetPlan.monthlyPrice as Prisma.Decimal)
              : (upgrade.targetPlan.yearlyPrice as Prisma.Decimal);
          finalCurrency = upgrade.targetPlan.currency;
          displayName = upgrade.targetPlan.displayName;
          commissionKind = "upsell";
          commissionAmount = finalAmount;
          commissionRate =
            (upgrade.targetPlan.commissionRate as Prisma.Decimal) ??
            new Prisma.Decimal(0.1);
          commissionPlanCode = upgrade.targetPlan.name;
        } else if (payment.referredByMarketingUserId) {
          // Fresh activation with a referral code on the payment.
          // Use payment.amount, not subscription.amount — a tenant
          // arriving here from a BUSINESS trial has subscription.amount=0
          // (trial period) until this transaction updates it. The
          // payment row carries the canonical price the customer is
          // being charged. commissionRate falls back to 0.10 for plans
          // that predate the per-plan rate column.
          commissionKind = "signup";
          commissionAmount = payment.amount as Prisma.Decimal;
          commissionRate =
            (subscription.plan.commissionRate as Prisma.Decimal) ??
            new Prisma.Decimal(0.1);
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
            // Renewal precedence over signup: overwrite even if a referral
            // signup was tentatively captured above (mirrors the original
            // dispatch order upgrade > renewal > signup).
            commissionKind = "renewal";
            commissionAmount = finalAmount;
            commissionRate =
              (subscription.plan.commissionRate as Prisma.Decimal) ??
              new Prisma.Decimal(0.1);
            commissionPlanCode = subscription.plan.name;
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
        //
        // v3.0.0 — pinned by the finalization audit. This is the canonical
        // idempotency contract for the PayTR flow: webhook handlers can
        // safely retry, and the periodic recovery sweeper can race the
        // real-time callback without producing double-credits or
        // duplicate `SubscriptionPayment` history rows.
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
        const succeededPayment = await tx.subscriptionPayment.findUniqueOrThrow(
          {
            where: { id: payment.id },
          },
        );

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

        // v2.8.89: emit subscription lifecycle event inside the same txn
        // so the entitlement projector reprojects on commit. Pre-v2.8.89
        // applySuccess updated currentPlanId but never told the projector,
        // so paid upgrades stayed stuck on the old plan's grants for up
        // to 24h (until reconcileNightly). The event type discriminates
        // between fresh activation, plan upgrade, and renewal so
        // downstream consumers (marketing commission, audit log) can
        // route correctly.
        const lifecycleType = upgrade
          ? EventTypes.SubscriptionUpgraded
          : EventTypes.SubscriptionActivated;
        await this.outbox.append(
          {
            type: lifecycleType,
            tenantId: subscription.tenantId,
            payload: {
              tenantId: subscription.tenantId,
              subscriptionId: subscription.id,
              planCode: upgrade
                ? upgrade.targetPlan.name
                : subscription.plan.name,
              currentPeriodStart: now.toISOString(),
              currentPeriodEnd: periodEnd.toISOString(),
            },
          },
          tx as any,
        );

        // Step C: emit the commission-relevant payment fact inside the same
        // settlement tx (durable via the outbox). The marketing
        // SettlementCommissionConsumer reacts to it and owns the lead lookup +
        // commission write — payments no longer reads `lead` or writes
        // `commission`/`marketingNotification`. Only emitted when a commission
        // kind applies; a plain first paid activation with no referral has no
        // commission, so (matching pre-decoupling behaviour) no event fires.
        // Idempotency key `payment-succeeded:{paymentId}` — webhook retry +
        // recovery sweeper settle the same payment row and re-emit the same
        // key, which the consumer dedupes against its per-type guards.
        if (commissionKind) {
          await this.outbox.append(
            {
              type: EventTypes.PaymentSucceeded,
              tenantId: subscription.tenantId,
              idempotencyKey: `payment-succeeded:${payment.id}`,
              payload: {
                tenantId: subscription.tenantId,
                tenantName: subscription.tenant?.name ?? subscription.tenantId,
                subscriptionId: subscription.id,
                paymentId: payment.id,
                kind: commissionKind,
                amount: commissionAmount.toNumber(),
                currency: finalCurrency,
                planId: finalPlanId,
                planCode: commissionPlanCode,
                commissionRate: commissionRate.toNumber(),
                referralCode: payment.referralCode ?? null,
                referredByMarketingUserId:
                  payment.referredByMarketingUserId ?? null,
                occurredAt: now.toISOString(),
              },
            },
            tx as any,
          );
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

      // Commission crediting moved to the marketing SettlementCommissionConsumer
      // (Step C) — it reacts to the payment.succeeded.v1 emitted in the tx above.
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
        // v2.8.94 — inspect err.meta.target to confirm the conflict is
        // the documented "one active subscription per tenant" guard
        // before refunding. Pre-fix the catch labelled EVERY P2002 as
        // DUPLICATE_ACTIVE_SUBSCRIPTION, so a future unique index
        // anywhere else (e.g. ['tenantId','planId'] for upsell
        // promotion bookkeeping, or ['merchantOid'] dupes from an
        // accidental schema drift) would silently FAIL the payment
        // and queue a phantom refund. Re-throw unknown P2002 so the
        // settlement layer's outer error path surfaces them as
        // criticals instead of swallowing.
        const target = (err.meta as any)?.target;
        const targetArray = Array.isArray(target)
          ? target
          : typeof target === "string"
            ? [target]
            : [];
        const isActiveSubscriptionDupe =
          targetArray.includes("tenantId") &&
          targetArray.some(
            (t: string) => t === "status" || t === "subscriptionId",
          );
        if (!isActiveSubscriptionDupe) {
          this.logger.error(
            `Unexpected P2002 during PayTR settlement success oid=${payment.paytrMerchantOid} target=${JSON.stringify(target)}`,
          );
          captureException(err, {
            paytrMerchantOid: payment.paytrMerchantOid,
            subscriptionId: subscription.id,
            tenantId: subscription.tenantId,
            severity: "critical",
            context: "unexpected-p2002-on-paytr-success",
            target,
          });
          throw err;
        }
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
}
