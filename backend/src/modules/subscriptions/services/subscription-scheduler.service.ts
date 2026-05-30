import { Injectable, Logger, Inject, forwardRef, Optional } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { addDays, addHours } from "date-fns";
import { PrismaService } from "../../../prisma/prisma.service";
import { SubscriptionService } from "./subscription.service";
import { NotificationService } from "./notification.service";
import { BillingService } from "./billing.service";
import { PaytrAdapter } from "../../payments/adapters/paytr.adapter";
import { PaytrSettlementService } from "../../payments/services/paytr-settlement.service";
import {
  PaymentStatus,
  SubscriptionStatus,
  SubscriptionPlanType,
} from "../../../common/constants/subscription.enum";
import { OutboxService } from "../../outbox/outbox.service";
import { EventTypes } from "../../outbox/event-types";

/**
 * All jobs acquire a Postgres advisory lock per job name before running,
 * so if the backend is horizontally scaled (two replicas running at the
 * same cron tick) only one replica actually works the batch — preventing
 * double charges / double renewals.
 */
@Injectable()
export class SubscriptionSchedulerService {
  private readonly logger = new Logger(SubscriptionSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly notifications: NotificationService,
    private readonly billing: BillingService,
    private readonly paytr: PaytrAdapter,
    // forwardRef because PaytrSettlementModule imports SubscriptionsModule
    // for Billing+Notification — without this, Nest sees the cycle at
    // bootstrap and throws.
    @Inject(forwardRef(() => PaytrSettlementService))
    private readonly settlement: PaytrSettlementService,
    // OutboxModule is @Global; Optional() so the legacy tests that build
    // the scheduler directly don't need to supply it.
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  /**
   * Take a 64-bit advisory lock keyed by job name. Returns true on
   * acquisition; false means another replica is already running. Lock
   * releases automatically at the end of the current DB session, so we
   * explicitly release it when the job body is done.
   */
  private async withJobLock(
    jobName: string,
    run: () => Promise<void>,
  ): Promise<void> {
    const lockId = this.jobLockId(jobName);
    const rows = await this.prisma.$queryRawUnsafe<{ locked: boolean }[]>(
      `SELECT pg_try_advisory_lock(${lockId}) AS locked`,
    );
    if (!rows[0]?.locked) {
      this.logger.warn(
        `Skipping ${jobName}: advisory lock held by another process`,
      );
      return;
    }
    try {
      await run();
    } finally {
      await this.prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${lockId})`);
    }
  }

  private jobLockId(jobName: string): number {
    // Deterministic bigint from the job name (DJB2 → int32-safe).
    let hash = 5381;
    for (let i = 0; i < jobName.length; i += 1) {
      hash = ((hash << 5) + hash + jobName.charCodeAt(i)) | 0;
    }
    // Postgres accepts any 64-bit signed integer; a 32-bit hash is plenty
    // for 6 job names.
    return hash;
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: "trial-expirations" })
  async handleTrialExpirations() {
    await this.withJobLock("trial-expirations", async () => {
      this.logger.log("Running trial expiration check...");
      try {
        const result = await this.subscriptionService.expireTrials();
        this.logger.log(
          `Trial expiry: processed ${result.processed}, failed ${result.failed}`,
        );
      } catch (error: any) {
        this.logger.error(
          `Error processing trial expirations: ${error?.message}`,
        );
      }
    });
  }

  /**
   * Subscription period-end watcher. Manual-renewal model: PayTR's
   * Kart Saklama / Recurring yetkisi is closed for this merchant, so
   * we don't auto-charge. Instead, when a subscription's period ends,
   * the subscription drops to PAST_DUE — features keep working for
   * the 7-day grace window (handled by `handlePastDueSubscriptions`
   * below), and the tenant is nudged via email + dashboard CTA to
   * manually re-purchase.
   *
   * Runs at 02:00 TR. The split with `past-due-subscriptions` at 03:00
   * is deliberate: ACTIVE → PAST_DUE here, then 7 days later the next
   * cron flips PAST_DUE → EXPIRED.
   */
  @Cron("0 2 * * *", { name: "subscription-period-end" })
  async handleSubscriptionPeriodEnd() {
    await this.withJobLock("subscription-period-end", async () => {
      const now = new Date();
      const expired = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: { lt: now },
          // Tenants who already opted to cancel-at-period-end are
          // handled by `pending-cancellations` (00:00 cron) — they
          // belong in CANCELLED, not PAST_DUE. Filtering them out
          // here also prevents the "renew now" past-due email from
          // contradicting the cancellation they just confirmed.
          cancelAtPeriodEnd: false,
        },
        include: { plan: true, tenant: { select: { id: true, name: true } } },
        orderBy: { currentPeriodEnd: "asc" },
        take: 200,
      });

      let transitioned = 0;
      for (const sub of expired) {
        try {
          // Compound WHERE on ACTIVE + cancelAtPeriodEnd=false: the
          // job lock prevents concurrent cron runs, but per-row writes
          // still interleave with USER actions. Between this loop's
          // findMany and the per-row update, an admin can manually
          // CANCEL the subscription (status → CANCELLED) or schedule
          // a cancel-at-period-end. A bare update would clobber those
          // states with PAST_DUE and trigger a confusing past-due
          // email AFTER the user already saw "cancelled". The claim
          // makes the loser a silent no-op.
          const claim = await this.prisma.subscription.updateMany({
            where: {
              id: sub.id,
              status: SubscriptionStatus.ACTIVE,
              cancelAtPeriodEnd: false,
            },
            data: { status: SubscriptionStatus.PAST_DUE },
          });
          if (claim.count === 0) continue;
          transitioned++;

          const admin = await this.prisma.user.findFirst({
            where: { tenantId: sub.tenant.id, role: "ADMIN" },
            select: { email: true },
          });
          if (admin?.email) {
            void this.notifications
              .sendSubscriptionPastDue(
                admin.email,
                sub.tenant.name,
                sub.plan.displayName,
                Number(sub.amount),
                sub.currency,
              )
              .catch((err: any) =>
                this.logger.error(
                  `past-due email failed for tenant=${sub.tenant.id}: ${err?.message}`,
                ),
              );
          }
        } catch (err: any) {
          this.logger.error(
            `Period-end transition failed for sub=${sub.id}: ${err?.message}`,
          );
        }
      }

      this.logger.log(
        `Period-end sweep: ACTIVE → PAST_DUE found=${expired.length} transitioned=${transitioned}`,
      );
    });
  }

  /**
   * Pre-expiry reminder cadence: 7 days, 3 days, and 1 day before
   * `currentPeriodEnd`. Each window is one calendar day wide so an
   * ACTIVE subscription that falls in the window gets exactly one
   * email per stage. Mirrors the trial-reminder pattern below.
   */
  @Cron("0 10 * * *", { name: "subscription-expiry-reminders" })
  async handleSubscriptionExpiryReminders() {
    await this.withJobLock("subscription-expiry-reminders", async () => {
      for (const daysOut of [7, 3, 1] as const) {
        await this.fireExpiryReminderWindow(daysOut);
      }
    });
  }

  private async fireExpiryReminderWindow(daysOut: 7 | 3 | 1): Promise<void> {
    const now = new Date();
    const windowStart = addDays(now, daysOut);
    const windowEnd = addDays(now, daysOut + 1);
    const due = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { gte: windowStart, lt: windowEnd },
      },
      include: { plan: true, tenant: { select: { id: true, name: true } } },
    });
    for (const sub of due) {
      try {
        const admin = await this.prisma.user.findFirst({
          where: { tenantId: sub.tenant.id, role: "ADMIN" },
          select: { email: true },
        });
        if (!admin?.email) continue;
        await this.notifications.sendSubscriptionExpiryReminder(
          admin.email,
          sub.tenant.name,
          sub.plan.displayName,
          sub.currentPeriodEnd,
          daysOut,
        );
      } catch (err: any) {
        this.logger.error(
          `expiry reminder ${daysOut}d failed for sub=${sub.id}: ${err?.message}`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: "pending-cancellations" })
  async handlePendingCancellations() {
    await this.withJobLock("pending-cancellations", async () => {
      this.logger.log("Running pending cancellation check...");
      const now = new Date();
      // Two-step (find → updateMany → emit) so the entitlement projector
      // gets one subscription.cancelled.v1 per row. A bare updateMany
      // would flip the status but leave grants in place until the next
      // ad-hoc projection — tenants who opted into cancel-at-period-end
      // would keep premium access for hours past their paid window.
      const expiring = await this.prisma.subscription.findMany({
        where: {
          cancelAtPeriodEnd: true,
          currentPeriodEnd: { lte: now },
          status: { not: SubscriptionStatus.CANCELLED },
        },
        select: { id: true, tenantId: true, plan: { select: { name: true } } },
      });
      if (expiring.length === 0) {
        this.logger.log("No pending cancellations to apply");
        return;
      }
      const ids = expiring.map((s) => s.id);
      // v2.8.89 — atomic Tenant.currentPlanId → FREE alongside the
      // status flip. Pre-v2.8.89 only Subscription.status was updated,
      // so the projector kept re-projecting the paid plan's grants on
      // every SubscriptionCancelled event (it reads tenant.currentPlan
      // directly). Wrap both writes in one txn so an interrupted cron
      // never leaves (status=CANCELLED, currentPlanId=PAID) on disk.
      const freePlan = await this.prisma.subscriptionPlan.findUnique({
        where: { name: SubscriptionPlanType.FREE },
        select: { id: true },
      });
      const result = await this.prisma.$transaction(async (tx) => {
        const r = await tx.subscription.updateMany({
          where: { id: { in: ids }, status: { not: SubscriptionStatus.CANCELLED } },
          data: {
            status: SubscriptionStatus.CANCELLED,
            endedAt: now,
          },
        });
        if (freePlan && r.count > 0) {
          await tx.tenant.updateMany({
            where: { id: { in: expiring.map((s) => s.tenantId) } },
            data: { currentPlanId: freePlan.id },
          });
        }
        return r;
      });
      for (const sub of expiring) {
        await this.outbox
          ?.append({
            type: EventTypes.SubscriptionCancelled,
            tenantId: sub.tenantId,
            payload: {
              subscriptionId: sub.id,
              tenantId: sub.tenantId,
              planCode: sub.plan?.name,
              reason: "period_end_cancel",
            },
          })
          .catch((e) =>
            this.logger.warn(`cancel emit failed for sub=${sub.id}: ${(e as Error).message}`),
          );
      }
      this.logger.log(`Cancelled ${result.count} subscriptions at period end (events emitted)`);
    });
  }

  @Cron("0 3 * * *", { name: "past-due-subscriptions" })
  async handlePastDueSubscriptions() {
    await this.withJobLock("past-due-subscriptions", async () => {
      this.logger.log("Running past-due subscription check...");
      const sevenDaysAgo = addDays(new Date(), -7);
      // Two-step transition so we can emit one outbox event per expired
      // subscription. Plain updateMany was atomic but silent — the
      // entitlement projector never got the signal to revoke grants on
      // grace expiry, so tenants whose payment lapsed kept premium
      // features indefinitely. Now: find expiring rows → flip each one
      // → emit subscription.cancelled.v1. The cancellation event is the
      // same one the projector already listens for; downgrade event
      // semantics ("you're losing access") match grace-expiry intent.
      const expiring = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: { lte: sevenDaysAgo },
        },
        select: { id: true, tenantId: true, planId: true, plan: { select: { name: true } } },
      });
      if (expiring.length === 0) {
        this.logger.log("No past-due subscriptions to expire");
        return;
      }
      const now = new Date();
      const ids = expiring.map((s) => s.id);
      // v2.8.89 — atomic Tenant.currentPlanId → FREE alongside the
      // status flip. Same fix pattern as handlePendingCancellations:
      // pre-v2.8.89 EXPIRED tenants kept their paid plan grants
      // because the projector re-projected currentPlan unchanged on
      // every event. With currentPlanId now flipped in the same txn,
      // the projector projects FREE grants on commit.
      const freePlan = await this.prisma.subscriptionPlan.findUnique({
        where: { name: SubscriptionPlanType.FREE },
        select: { id: true },
      });
      const updated = await this.prisma.$transaction(async (tx) => {
        const u = await tx.subscription.updateMany({
          where: { id: { in: ids }, status: SubscriptionStatus.PAST_DUE },
          data: { status: SubscriptionStatus.EXPIRED, endedAt: now },
        });
        if (freePlan && u.count > 0) {
          await tx.tenant.updateMany({
            where: { id: { in: expiring.map((s) => s.tenantId) } },
            data: { currentPlanId: freePlan.id },
          });
        }
        return u;
      });
      for (const sub of expiring) {
        await this.outbox
          ?.append({
            type: EventTypes.SubscriptionCancelled,
            tenantId: sub.tenantId,
            payload: {
              subscriptionId: sub.id,
              tenantId: sub.tenantId,
              planCode: sub.plan?.name,
              reason: "grace_expired",
            },
          })
          .catch((e) =>
            this.logger.warn(`expired emit failed for sub=${sub.id}: ${(e as Error).message}`),
          );
      }
      this.logger.log(`Expired ${updated.count} past-due subscriptions (events emitted)`);
    });
  }

  /**
   * Trial-ending reminder cadence: 7 days, 3 days, and 1 day before
   * `trialEnd`. Each window is one calendar day wide so trials that
   * land within that window get exactly one email per stage. Single
   * 10:00 daily cron drives all three.
   */
  @Cron("0 10 * * *", { name: "trial-reminders" })
  async sendTrialReminders() {
    await this.withJobLock("trial-reminders", async () => {
      this.logger.log("Running trial reminder check...");
      for (const daysOut of [7, 3, 1]) {
        await this.fireTrialReminderWindow(daysOut);
      }
    });
  }

  private async fireTrialReminderWindow(daysOut: number): Promise<void> {
    const windowStart = addDays(new Date(), daysOut);
    const windowEnd = addDays(windowStart, 1);

    const trials = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        isTrialPeriod: true,
        trialEnd: { gte: windowStart, lte: windowEnd },
      },
      include: { tenant: true, plan: true },
    });
    this.logger.log(`Found ${trials.length} trials ending in ~${daysOut} days`);

    for (const subscription of trials) {
      try {
        const admin = await this.prisma.user.findFirst({
          where: { tenantId: subscription.tenantId, role: "ADMIN" },
          select: { email: true },
        });
        if (admin?.email) {
          await this.notifications.sendTrialEndingReminder(
            admin.email,
            subscription.tenant.name,
            subscription.plan.displayName,
            daysOut,
            {
              planId: subscription.planId,
              billingCycle: subscription.billingCycle,
            },
          );
        }
      } catch (error: any) {
        this.logger.error(
          `Trial reminder (${daysOut}d) failed for ${subscription.id}: ${error?.message}`,
        );
      }
    }
  }

  @Cron("0 1 * * *", { name: "scheduled-downgrades" })
  async handleScheduledDowngrades() {
    await this.withJobLock("scheduled-downgrades", async () => {
      this.logger.log("Running scheduled downgrade check...");
      const now = new Date();
      const subscriptionsWithDowngrades =
        await this.prisma.subscription.findMany({
          where: {
            scheduledDowngradePlanId: { not: null },
            currentPeriodEnd: { lte: now },
            status: SubscriptionStatus.ACTIVE,
          },
          select: { id: true },
        });
      this.logger.log(
        `Found ${subscriptionsWithDowngrades.length} scheduled downgrades to apply`,
      );
      for (const { id } of subscriptionsWithDowngrades) {
        try {
          await this.subscriptionService.applyScheduledDowngrade(id);
        } catch (error: any) {
          this.logger.error(
            `Failed to apply downgrade for ${id}: ${error?.message}`,
          );
        }
      }
    });
  }

  /**
   * Sweep abandoned PayTR checkouts. Every hour:
   *  - Drop `PendingPlanChange` rows whose TTL has elapsed (default 1h).
   *  - Move `Subscription` rows still in `PENDING` after a grace window
   *    (24h) to `EXPIRED` so they don't pile up in the table forever.
   *
   * The grace is wider than the PendingPlanChange TTL because PayTR can
   * deliver a successful callback hours after the user closed the tab,
   * and we want to honour it.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: "paytr-orphan-cleanup" })
  async handlePaytrOrphanCleanup() {
    await this.withJobLock("paytr-orphan-cleanup", async () => {
      const now = new Date();
      const subscriptionGrace = addDays(now, -1);

      const expiredPending = await this.prisma.pendingPlanChange.deleteMany({
        where: { expiresAt: { lte: now } },
      });

      const expiredPendingSubs = await this.prisma.subscription.updateMany({
        where: {
          status: SubscriptionStatus.PENDING,
          createdAt: { lte: subscriptionGrace },
        },
        data: {
          status: SubscriptionStatus.EXPIRED,
          endedAt: now,
        },
      });

      this.logger.log(
        `Orphan cleanup: pending-plan-changes=${expiredPending.count}, pending-subs=${expiredPendingSubs.count}`,
      );
    });
  }

  /**
   * Customer self-pay (QR-menu PayTR) intent sweeper.
   *
   * Every 30 minutes, flip PENDING `PendingSelfPayment` rows whose
   * `expiresAt` has passed into `EXPIRED`. Two problems this solves:
   *
   *  1. Customers who abandon the PayTR iframe (close tab, time out
   *     on 3DS) leave PENDING intents that the frontend's
   *     /payment-result page would otherwise poll forever.
   *
   *  2. A late PayTR webhook arriving AFTER we've flipped to EXPIRED
   *     is correctly distinguished from a real-time PENDING — the
   *     self-pay webhook handler short-circuits on any non-PENDING
   *     status, but EXPIRED is the truth (customer abandoned),
   *     whereas an undeclared phantom-PENDING would silently drop
   *     a late success.
   *
   * Reservation impact: PENDING intents hold OrderItem units (see
   * customer-self-pay.service `subtractReservations`) so a second
   * customer can't pay the same units. Sweeping to EXPIRED releases
   * those units back to the payable pool.
   */
  @Cron("*/30 * * * *", { name: "self-pay-orphan-cleanup" })
  async handleSelfPayOrphanCleanup() {
    await this.withJobLock("self-pay-orphan-cleanup", async () => {
      const now = new Date();
      const expired = await this.prisma.pendingSelfPayment.updateMany({
        where: {
          status: "PENDING",
          expiresAt: { lte: now },
        },
        data: {
          status: "EXPIRED",
          failureReason: "expired",
        },
      });
      if (expired.count > 0) {
        this.logger.log(`Self-pay orphan cleanup: expired=${expired.count}`);
      }
    });
  }

  /**
   * Webhook recovery sweeper. PayTR's callback is normally the only
   * signal we get for whether a checkout succeeded — but callbacks
   * occasionally fail to land (network blip, our 5xx during deploy,
   * PayTR retry exhaustion). Without this sweeper, the payment row
   * hangs in PENDING forever and the tenant's subscription never
   * activates even though their card may already have been charged.
   *
   * Every hour, find SubscriptionPayment rows that have been PENDING
   * for ≥ 2 hours (still expecting a callback) and ask PayTR's
   * `durum-sorgu` endpoint what really happened. Replay the same
   * settlement logic the webhook would have run.
   *
   * Caveats:
   *   - We never receive `utoken` via inquiry, so recovered
   *     activations leave the tenant without a stored card — they'll
   *     need a fresh checkout when the next renewal cycle starts.
   *     This is acceptable for the rare loss case.
   *   - Hard cap at 50 rows per run to bound PayTR API spend.
   *   - SP-prefix self-pay PENDING rows live in PendingSelfPayment,
   *     not SubscriptionPayment — they're swept by a different cron.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: "paytr-pending-recovery" })
  async handlePaytrPendingRecovery() {
    await this.withJobLock("paytr-pending-recovery", async () => {
      const cutoff = addHours(new Date(), -2);
      const stuck = await this.prisma.subscriptionPayment.findMany({
        where: {
          status: PaymentStatus.PENDING,
          createdAt: { lt: cutoff },
          paytrMerchantOid: { not: null },
        },
        select: { id: true, paytrMerchantOid: true },
        orderBy: { createdAt: "asc" },
        take: 50,
      });
      if (stuck.length === 0) return;

      let recovered = 0;
      let failed = 0;
      let stillPending = 0;
      for (const row of stuck) {
        const oid = row.paytrMerchantOid!;
        const inquiry = await this.paytr.inquiryStatus(oid);
        if (inquiry.status === "success") {
          await this.settlement.settlePayment(oid, {
            kind: "success",
            paymentType: inquiry.paymentType,
            totalAmount: inquiry.paymentAmount,
            // utoken intentionally omitted — inquiry doesn't return it.
          });
          recovered += 1;
        } else if (inquiry.status === "failed") {
          await this.settlement.settlePayment(oid, {
            kind: "failure",
            failureCode: inquiry.failedReasonCode,
            failureMessage: inquiry.failedReasonMsg,
          });
          failed += 1;
        } else {
          stillPending += 1;
        }
      }
      this.logger.log(
        `PayTR pending recovery: scanned=${stuck.length} recovered=${recovered} failed=${failed} stillPending=${stillPending}`,
      );
    });
  }
}
