import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
// v2.8.95 — every cron in this file mutates shared rows or creates
// new ones. Without per-replica coordination the followup-reminder
// loop in particular fires the duplicate-check + create pair on
// every replica, producing one notification per replica per lead.
import { withAdvisoryLock } from '../../../common/scheduling/advisory-lock';
import { MarketingLeadsService } from './marketing-leads.service';

/**
 * Background jobs that keep marketing data tidy:
 *
 *   - Cron #1 (offer-expire): every 30 minutes, flip SENT offers
 *     whose `validUntil` is past to EXPIRED. Without this the
 *     accept-button stays live on stale offers indefinitely.
 *
 *   - Cron #2 (notification-cleanup): once a day, drop
 *     MarketingNotification rows older than 30 days. The table has
 *     no TTL otherwise and grows without bound.
 *
 *   - Cron #3 (follow-up-reminder): once a day at 09:00 local,
 *     surface `nextFollowUp` dates in the next 24h as
 *     FOLLOW_UP_REMINDER notifications on the lead's owner. Quietly
 *     skipped for converted/lost leads.
 *
 * All jobs are safe to re-run — they use `updateMany` with status
 * filters that are idempotent after the first run.
 */
const NOTIFICATION_TTL_DAYS = 30;

@Injectable()
export class MarketingSchedulerService {
  private readonly logger = new Logger(MarketingSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: MarketingLeadsService,
  ) {}

  // Step D saga safety net: finalize conversions that provisioned a tenant
  // (via the core port) but failed to commit their marketing-side state and
  // were never retried. Advisory-locked so only one replica sweeps.
  @Cron(CronExpression.EVERY_HOUR, { name: 'marketing-orphan-reconcile' })
  async reconcileOrphanConversions(): Promise<{ reconciled: number }> {
    let outcome = { reconciled: 0 };
    await withAdvisoryLock(
      this.prisma,
      'marketing-orphan-reconcile',
      async () => {
        outcome = await this.leads.reconcileOrphanProvisionedConversions();
        if (outcome.reconciled > 0) {
          this.logger.warn(
            `orphan-reconcile: finalized ${outcome.reconciled} provisioned conversion(s)`,
          );
        }
      },
      this.logger,
    );
    return outcome;
  }

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'marketing-offer-expire' })
  async expireOffers(): Promise<{ expired: number }> {
    let outcome = { expired: 0 };
    await withAdvisoryLock(
      this.prisma,
      'marketing-offer-expire',
      async () => {
        const now = new Date();
        const result = await this.prisma.leadOffer.updateMany({
          where: { status: 'SENT', validUntil: { lt: now, not: null } },
          data: { status: 'EXPIRED' },
        });
        if (result.count > 0) {
          this.logger.log(`offer-expire: marked ${result.count} offer(s) EXPIRED`);
        }
        outcome = { expired: result.count };
      },
      this.logger,
    );
    return outcome;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'marketing-notification-cleanup' })
  async cleanupOldNotifications(): Promise<{ deleted: number }> {
    let outcome = { deleted: 0 };
    await withAdvisoryLock(
      this.prisma,
      'marketing-notification-cleanup',
      async () => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - NOTIFICATION_TTL_DAYS);
        const result = await this.prisma.marketingNotification.deleteMany({
          where: { createdAt: { lt: cutoff } },
        });
        if (result.count > 0) {
          this.logger.log(
            `notification-cleanup: deleted ${result.count} notification(s) older than ${NOTIFICATION_TTL_DAYS}d`,
          );
        }
        outcome = { deleted: result.count };
      },
      this.logger,
    );
    return outcome;
  }

  @Cron('0 9 * * *', { name: 'marketing-followup-reminder' })
  async fireFollowUpReminders(): Promise<{ reminded: number }> {
    let outcome = { reminded: 0 };
    await withAdvisoryLock(
      this.prisma,
      'marketing-followup-reminder',
      async () => {
        outcome = await this.fireFollowUpRemindersInner();
      },
      this.logger,
    );
    return outcome;
  }

  private async fireFollowUpRemindersInner(): Promise<{ reminded: number }> {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);

    const dueLeads = await this.prisma.lead.findMany({
      where: {
        nextFollowUp: { gte: now, lte: tomorrow },
        status: { notIn: ['WON', 'LOST'] },
        assignedToId: { not: null },
      },
      select: {
        id: true,
        businessName: true,
        contactPerson: true,
        assignedToId: true,
        nextFollowUp: true,
      },
    });

    let reminded = 0;
    for (const lead of dueLeads) {
      if (!lead.assignedToId) continue;
      // Idempotency: don't duplicate today's reminder for the same
      // lead. The check is cheap and the table has an index on
      // (userId, isRead).
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dup = await this.prisma.marketingNotification.findFirst({
        where: {
          userId: lead.assignedToId,
          type: 'FOLLOW_UP_REMINDER',
          createdAt: { gte: today },
          // metadata is JSON; Prisma supports `path` equality for the leadId field.
          metadata: { path: ['leadId'], equals: lead.id } as any,
        },
        select: { id: true },
      });
      if (dup) continue;

      await this.prisma.marketingNotification.create({
        data: {
          userId: lead.assignedToId,
          type: 'FOLLOW_UP_REMINDER',
          title: 'Follow-up due',
          message: `${lead.businessName} — ${lead.contactPerson}`,
          metadata: { leadId: lead.id, dueAt: lead.nextFollowUp?.toISOString() },
        },
      });
      reminded += 1;
    }

    if (reminded > 0) {
      this.logger.log(`followup-reminder: fired ${reminded} reminder(s)`);
    }
    return { reminded };
  }
}
