import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { SubscriptionService } from './subscription.service';
import { SubscriptionStatus } from '../../../common/constants/subscription.enum';

@Injectable()
export class SubscriptionSchedulerService {
  private readonly logger = new Logger(SubscriptionSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /**
   * Check for expired trials every day at midnight
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'trial-expirations' })
  async handleTrialExpirations() {
    this.logger.log('Running trial expiration check...');

    try {
      const expiredCount = await this.subscriptionService.expireTrials();
      this.logger.log(`Processed ${expiredCount} expired trials`);
    } catch (error) {
      this.logger.error(`Error processing trial expirations: ${error.message}`);
    }
  }

  /**
   * Check for subscription renewals every day at 2 AM
   */
  @Cron('0 2 * * *', { name: 'subscription-renewals' })
  async handleSubscriptionRenewals() {
    this.logger.log('Running subscription renewal check...');

    try {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Find subscriptions that need renewal
      const subscriptionsToRenew = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          autoRenew: true,
          currentPeriodEnd: {
            gte: now,
            lte: tomorrow,
          },
        },
        include: { plan: true, tenant: true },
      });

      this.logger.log(`Found ${subscriptionsToRenew.length} subscriptions to renew`);

      for (const subscription of subscriptionsToRenew) {
        try {
          await this.subscriptionService.renewSubscription(subscription.id);
          this.logger.log(`Renewed subscription: ${subscription.id}`);
        } catch (error) {
          this.logger.error(`Failed to renew subscription ${subscription.id}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error processing subscription renewals: ${error.message}`);
    }
  }

  /**
   * Check for subscriptions that should be cancelled (at period end)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'pending-cancellations' })
  async handlePendingCancellations() {
    this.logger.log('Running pending cancellation check...');

    try {
      const now = new Date();

      // Batch update - tek query ile tüm subscription'ları güncelle
      const result = await this.prisma.subscription.updateMany({
        where: {
          cancelAtPeriodEnd: true,
          currentPeriodEnd: {
            lte: now,
          },
          status: {
            not: SubscriptionStatus.CANCELLED,
          },
        },
        data: {
          status: SubscriptionStatus.CANCELLED,
          endedAt: now,
        },
      });

      this.logger.log(`Cancelled ${result.count} subscriptions`);
    } catch (error) {
      this.logger.error(`Error processing pending cancellations: ${error.message}`);
    }
  }

  /**
   * Mark past due subscriptions as expired
   */
  @Cron('0 3 * * *', { name: 'past-due-subscriptions' })
  async handlePastDueSubscriptions() {
    this.logger.log('Running past due subscription check...');

    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Batch update - tek query ile tüm subscription'ları güncelle
      const result = await this.prisma.subscription.updateMany({
        where: {
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: {
            lte: sevenDaysAgo,
          },
        },
        data: {
          status: SubscriptionStatus.EXPIRED,
          endedAt: new Date(),
        },
      });

      this.logger.log(`Expired ${result.count} past due subscriptions`);
    } catch (error) {
      this.logger.error(`Error processing past due subscriptions: ${error.message}`);
    }
  }

  /**
   * Send trial ending reminders (3 days before trial ends)
   */
  @Cron('0 10 * * *', { name: 'trial-reminders' }) // Run at 10 AM daily
  async sendTrialReminders() {
    this.logger.log('Running trial reminder check...');

    try {
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      const fourDaysFromNow = new Date(threeDaysFromNow);
      fourDaysFromNow.setDate(fourDaysFromNow.getDate() + 1);

      const trialsEndingSoon = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.TRIALING,
          isTrialPeriod: true,
          trialEnd: {
            gte: threeDaysFromNow,
            lte: fourDaysFromNow,
          },
        },
        include: {
          tenant: true,
          plan: true,
        },
      });

      this.logger.log(`Found ${trialsEndingSoon.length} trials ending in 3 days`);

      // Here you would integrate with your email/notification service
      // For now, just log the subscriptions that need reminders
      for (const subscription of trialsEndingSoon) {
        this.logger.log(
          `Trial ending soon for tenant ${subscription.tenant.name} (${subscription.tenant.id})`,
        );
        // TODO: Send email/notification
      }
    } catch (error) {
      this.logger.error(`Error sending trial reminders: ${error.message}`);
    }
  }

  /**
   * Apply scheduled downgrades at period end
   * Runs daily at 1 AM
   */
  @Cron('0 1 * * *', { name: 'scheduled-downgrades' })
  async handleScheduledDowngrades() {
    this.logger.log('Running scheduled downgrade check...');

    try {
      const now = new Date();

      // Find subscriptions with scheduled downgrades where period has ended
      const subscriptionsWithDowngrades = await this.prisma.subscription.findMany({
        where: {
          scheduledDowngradePlanId: { not: null },
          currentPeriodEnd: { lte: now },
          status: SubscriptionStatus.ACTIVE,
        },
        include: {
          scheduledDowngradePlan: true,
        },
      });

      this.logger.log(`Found ${subscriptionsWithDowngrades.length} scheduled downgrades to apply`);

      for (const subscription of subscriptionsWithDowngrades) {
        try {
          await this.subscriptionService.applyScheduledDowngrade(subscription.id);
          this.logger.log(`Applied scheduled downgrade for subscription: ${subscription.id}`);
        } catch (error) {
          this.logger.error(`Failed to apply downgrade for ${subscription.id}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error processing scheduled downgrades: ${error.message}`);
    }
  }
}
