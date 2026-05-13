import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { addDays, addMonths, addYears } from 'date-fns';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { SubscriptionService } from './subscription.service';
import { NotificationService } from './notification.service';
import { BillingService } from './billing.service';
import { PaytrAdapter } from '../../payments/adapters/paytr.adapter';
import {
  BillingCycle,
  PaymentProvider,
  PaymentRegion,
  PaymentStatus,
  SubscriptionStatus,
} from '../../../common/constants/subscription.enum';

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
  ) {}

  /**
   * Take a 64-bit advisory lock keyed by job name. Returns true on
   * acquisition; false means another replica is already running. Lock
   * releases automatically at the end of the current DB session, so we
   * explicitly release it when the job body is done.
   */
  private async withJobLock(jobName: string, run: () => Promise<void>): Promise<void> {
    const lockId = this.jobLockId(jobName);
    const rows = await this.prisma.$queryRawUnsafe<{ locked: boolean }[]>(
      `SELECT pg_try_advisory_lock(${lockId}) AS locked`,
    );
    if (!rows[0]?.locked) {
      this.logger.warn(`Skipping ${jobName}: advisory lock held by another process`);
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

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'trial-expirations' })
  async handleTrialExpirations() {
    await this.withJobLock('trial-expirations', async () => {
      this.logger.log('Running trial expiration check...');
      try {
        const result = await this.subscriptionService.expireTrials();
        this.logger.log(
          `Trial expiry: processed ${result.processed}, failed ${result.failed}`,
        );
      } catch (error: any) {
        this.logger.error(`Error processing trial expirations: ${error?.message}`);
      }
    });
  }

  /**
   * Daily renewal job. For each subscription whose period ends in the
   * next 24h:
   *   - TURKEY tenant with a stored PayTR recurring token →
   *     `chargeRecurring`. On success, bump period + create payment +
   *     invoice. On failure, fall back to `renewSubscription()` (which
   *     moves the sub to PAST_DUE so the grace-period banner is shown).
   *   - INTERNATIONAL tenant or no recurring token → same legacy
   *     behaviour (PAST_DUE; contact-based renewal).
   */
  @Cron('0 2 * * *', { name: 'subscription-renewals' })
  async handleSubscriptionRenewals() {
    await this.withJobLock('subscription-renewals', async () => {
      this.logger.log('Running subscription renewal check...');
      const now = new Date();
      const tomorrow = addDays(now, 1);

      const subscriptionsToRenew = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          autoRenew: true,
          currentPeriodEnd: { gte: now, lte: tomorrow },
        },
        include: {
          plan: true,
          tenant: { select: { id: true, name: true, paymentRegion: true, paytrRecurringToken: true } },
        },
      });
      this.logger.log(`Found ${subscriptionsToRenew.length} subscriptions due for renewal`);

      for (const sub of subscriptionsToRenew) {
        try {
          await this.renewOneSubscription(sub);
        } catch (error: any) {
          this.logger.error(`Failed to renew ${sub.id}: ${error?.message}`);
        }
      }
    });
  }

  /**
   * Renew a single subscription. PayTR-token holders get auto-charged
   * via PayTR's recurring-payment API; everyone else falls back to
   * the contact-based PAST_DUE flow. Failures here log but don't throw —
   * the cron must remain idempotent so a single bad row doesn't stop
   * the rest.
   */
  private async renewOneSubscription(sub: any): Promise<void> {
    const tenant = sub.tenant;
    const canAutoCharge =
      tenant?.paymentRegion === PaymentRegion.TURKEY &&
      !!tenant.paytrRecurringToken &&
      sub.paymentProvider === PaymentProvider.PAYTR;

    if (!canAutoCharge) {
      await this.subscriptionService.renewSubscription(sub.id);
      return;
    }

    const merchantOid = `RNW${tenant.id.replace(/-/g, '').slice(0, 12)}${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const amount = sub.amount as Prisma.Decimal;

    const result = await this.paytr.chargeRecurring({
      merchantOid,
      amount,
      utoken: tenant.paytrRecurringToken,
      productName: `${sub.plan.displayName} yenileme`,
    });

    if (result.status !== 'success') {
      // Auto-charge failed → contact-based path picks up. PayTR error
      // is recorded on a FAILED payment row for audit.
      await this.prisma.subscriptionPayment.create({
        data: {
          subscriptionId: sub.id,
          amount,
          currency: sub.currency,
          status: PaymentStatus.FAILED,
          paymentProvider: PaymentProvider.PAYTR,
          paytrMerchantOid: merchantOid,
          failureCode: 'RECURRING_FAILED',
          failureMessage: typeof result.reason === 'string' ? result.reason : 'unknown',
        },
      });
      await this.subscriptionService.renewSubscription(sub.id);
      this.logger.warn(
        `Recurring charge failed for sub=${sub.id}, fell back to PAST_DUE: ${result.reason ?? 'unknown'}`,
      );
      return;
    }

    // Success path — write payment, bump period, issue invoice, all atomic.
    // Period continuity: the cron fires ~24h before currentPeriodEnd so
    // we anchor the *new* period on the old end (not on `now`). Otherwise
    // a tenant whose period ends at 23:59 would lose those 24 hours on
    // every renewal. If the period has already passed (cron caught a
    // PAST_DUE-then-recovered edge case), fall back to `now`.
    const now = new Date();
    const newPeriodStart =
      sub.currentPeriodEnd > now ? new Date(sub.currentPeriodEnd) : now;
    const newPeriodEnd =
      sub.billingCycle === BillingCycle.MONTHLY
        ? addMonths(newPeriodStart, 1)
        : addYears(newPeriodStart, 1);

    let invoiceNumber: string | undefined;
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.create({
        data: {
          subscriptionId: sub.id,
          amount,
          currency: sub.currency,
          status: PaymentStatus.SUCCEEDED,
          paymentProvider: PaymentProvider.PAYTR,
          paytrMerchantOid: merchantOid,
          paidAt: now,
        },
      });
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          currentPeriodStart: newPeriodStart,
          currentPeriodEnd: newPeriodEnd,
        },
      });
      const invoice = await this.billing.createInvoice(
        tx,
        sub.id,
        payment.id,
        amount,
        sub.currency,
        newPeriodStart,
        newPeriodEnd,
        `${sub.plan.displayName} planı otomatik yenileme`,
      );
      invoiceNumber = invoice.invoiceNumber;
    });

    // Best-effort payment-success email (post-commit).
    void this.sendRenewalSuccessEmail(
      tenant.id,
      tenant.name,
      Number(amount),
      sub.currency,
      invoiceNumber ?? '',
    );

    this.logger.log(
      `Recurring charge succeeded for sub=${sub.id} tenant=${tenant.id} oid=${merchantOid}`,
    );
  }

  private async sendRenewalSuccessEmail(
    tenantId: string,
    tenantName: string,
    amount: number,
    currency: string,
    invoiceNumber: string,
  ): Promise<void> {
    try {
      const admin = await this.prisma.user.findFirst({
        where: { tenantId, role: 'ADMIN' },
        select: { email: true },
      });
      if (admin?.email) {
        await this.notifications.sendPaymentSuccessful(
          admin.email,
          tenantName,
          amount,
          currency,
          invoiceNumber,
        );
      }
    } catch (err: any) {
      this.logger.error(`payment-success notification failed: ${err?.message}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'pending-cancellations' })
  async handlePendingCancellations() {
    await this.withJobLock('pending-cancellations', async () => {
      this.logger.log('Running pending cancellation check...');
      const now = new Date();
      const result = await this.prisma.subscription.updateMany({
        where: {
          cancelAtPeriodEnd: true,
          currentPeriodEnd: { lte: now },
          status: { not: SubscriptionStatus.CANCELLED },
        },
        data: {
          status: SubscriptionStatus.CANCELLED,
          endedAt: now,
        },
      });
      this.logger.log(`Cancelled ${result.count} subscriptions at period end`);
    });
  }

  @Cron('0 3 * * *', { name: 'past-due-subscriptions' })
  async handlePastDueSubscriptions() {
    await this.withJobLock('past-due-subscriptions', async () => {
      this.logger.log('Running past-due subscription check...');
      const sevenDaysAgo = addDays(new Date(), -7);
      const result = await this.prisma.subscription.updateMany({
        where: {
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: { lte: sevenDaysAgo },
        },
        data: {
          status: SubscriptionStatus.EXPIRED,
          endedAt: new Date(),
        },
      });
      this.logger.log(`Expired ${result.count} past-due subscriptions`);
    });
  }

  /**
   * Trial-ending reminder cadence: 7 days, 3 days, and 1 day before
   * `trialEnd`. Each window is one calendar day wide so trials that
   * land within that window get exactly one email per stage. Single
   * 10:00 daily cron drives all three.
   */
  @Cron('0 10 * * *', { name: 'trial-reminders' })
  async sendTrialReminders() {
    await this.withJobLock('trial-reminders', async () => {
      this.logger.log('Running trial reminder check...');
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
          where: { tenantId: subscription.tenantId, role: 'ADMIN' },
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

  @Cron('0 1 * * *', { name: 'scheduled-downgrades' })
  async handleScheduledDowngrades() {
    await this.withJobLock('scheduled-downgrades', async () => {
      this.logger.log('Running scheduled downgrade check...');
      const now = new Date();
      const subscriptionsWithDowngrades = await this.prisma.subscription.findMany({
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
  @Cron(CronExpression.EVERY_HOUR, { name: 'paytr-orphan-cleanup' })
  async handlePaytrOrphanCleanup() {
    await this.withJobLock('paytr-orphan-cleanup', async () => {
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
  @Cron('*/30 * * * *', { name: 'self-pay-orphan-cleanup' })
  async handleSelfPayOrphanCleanup() {
    await this.withJobLock('self-pay-orphan-cleanup', async () => {
      const now = new Date();
      const expired = await this.prisma.pendingSelfPayment.updateMany({
        where: {
          status: 'PENDING',
          expiresAt: { lte: now },
        },
        data: {
          status: 'EXPIRED',
          failureReason: 'expired',
        },
      });
      if (expired.count > 0) {
        this.logger.log(`Self-pay orphan cleanup: expired=${expired.count}`);
      }
    });
  }
}
