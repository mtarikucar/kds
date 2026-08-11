import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  Optional,
} from "@nestjs/common";
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

  /**
   * Sweep abandoned PayTR checkouts. Every hour:
   *  - Drop `PendingPlanChange` rows that are past TTL **and** past the
   *    PayTR late-callback grace window (24h after expiry).
   *  - Move `Subscription` rows still in `PENDING` after a grace window
   *    (24h) to `EXPIRED` so they don't pile up in the table forever.
   *
   * v3.0.1 round-5 audit fix — pre-fix `PendingPlanChange.deleteMany`
   * dropped any row past its 1h TTL immediately. PayTR can deliver a
   * successful callback hours-to-24h after the user closed the tab
   * (the recovery sweeper runs hourly + retries for ~24h before giving
   * up). A late upgrade callback that arrived after we had already
   * dropped the PendingPlanChange found nothing at
   * paytr-settlement.service.ts:155, so applySuccess silently treated
   * the charge as a same-plan renewal: the customer paid the upgrade
   * price and got no plan change. Now we wait `addDays(-1)` past the
   * row's expiresAt before deletion — same window the Subscription
   * PENDING→EXPIRED transition already honours.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: "paytr-orphan-cleanup" })
  async handlePaytrOrphanCleanup() {
    await this.withJobLock("paytr-orphan-cleanup", async () => {
      const now = new Date();
      const subscriptionGrace = addDays(now, -1);

      const expiredPending = await this.prisma.pendingPlanChange.deleteMany({
        // Keep the row alive for 24h past its TTL so a late PayTR
        // callback can still find it. The settlement path looks the
        // row up by (tenantId, expiresAt > now) — those filters are
        // already gone once the row is past TTL, but the row's
        // presence is the data the upgrade-vs-renewal branch needs.
        where: { expiresAt: { lte: subscriptionGrace } },
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
      let errored = 0;
      for (const row of stuck) {
        const oid = row.paytrMerchantOid!;
        // Per-row isolation (matches every other per-row sweeper in this file).
        // Without it a single settlePayment throw aborts the whole batch — and
        // because rows are ordered createdAt ASC and a poison row stays PENDING,
        // it would sit at the head every hour and permanently block recovery of
        // all newer stuck payments (tenants charged but never activated).
        try {
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
        } catch (err) {
          errored += 1;
          this.logger.error(
            `PayTR pending recovery failed for oid=${oid}: ${(err as Error).message}`,
          );
          continue;
        }
      }
      this.logger.log(
        `PayTR pending recovery: scanned=${stuck.length} recovered=${recovered} failed=${failed} stillPending=${stillPending} errored=${errored}`,
      );
    });
  }
}
