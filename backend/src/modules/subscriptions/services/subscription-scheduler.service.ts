import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { addDays } from 'date-fns';
import { PrismaService } from '../../../prisma/prisma.service';
import { SubscriptionService } from './subscription.service';
import { SubscriptionStatus } from '../../../common/constants/subscription.enum';

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
        select: { id: true },
      });
      this.logger.log(
        `Found ${subscriptionsToRenew.length} subscriptions due for renewal`,
      );

      for (const { id } of subscriptionsToRenew) {
        try {
          await this.subscriptionService.renewSubscription(id);
        } catch (error: any) {
          this.logger.error(`Failed to renew ${id}: ${error?.message}`);
        }
      }
    });
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

  @Cron('0 10 * * *', { name: 'trial-reminders' })
  async sendTrialReminders() {
    await this.withJobLock('trial-reminders', async () => {
      this.logger.log('Running trial reminder check...');
      const threeDaysFromNow = addDays(new Date(), 3);
      const fourDaysFromNow = addDays(threeDaysFromNow, 1);

      const trialsEndingSoon = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.TRIALING,
          isTrialPeriod: true,
          trialEnd: { gte: threeDaysFromNow, lte: fourDaysFromNow },
        },
        include: { tenant: true, plan: true },
      });
      this.logger.log(`Found ${trialsEndingSoon.length} trials ending in ~3 days`);
      for (const subscription of trialsEndingSoon) {
        try {
          // Placeholder — the notification service does not yet have a
          // dedicated trial-ending-soon email template. Ops can wire
          // this up later; the isolation per row is what matters here.
          this.logger.log(
            `Trial ending soon for tenant ${subscription.tenant.name} (${subscription.tenant.id})`,
          );
        } catch (error: any) {
          this.logger.error(
            `Trial reminder failed for ${subscription.id}: ${error?.message}`,
          );
        }
      }
    });
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
}
