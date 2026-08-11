import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { withAdvisoryLock } from "../../common/scheduling/advisory-lock";
import { OutboxService } from "../outbox/outbox.service";
import { EventTypes } from "../outbox/event-types";
import {
  REMINDER_DAYS,
  RENEWAL_LEAD_DAYS,
  RenewalCycleService,
} from "./renewal-cycle.service";
import { anchorDateFor, daysBetweenUtc, nextAnniversary } from "./anniversary";

/**
 * The annual renewal lifecycle.
 *
 * Three jobs, each advisory-locked so multiple replicas cannot double-fire:
 *
 *   06:00  materialize renewals ~30 days out
 *   09:00  send the 30 / 7 / 1-day reminders
 *   00:30  lapse anything still unpaid after the grace window
 *
 * Lapsing revokes ACCESS and nothing else. `TenantAddOn.status` flips and the
 * projector stops emitting those grants; no business table is written. The
 * tenant keeps their stock items, reservations, personnel records, generated
 * AI media, invoices and orders, and a payment re-lights everything. That is
 * the difference between "your subscription lapsed" and "we deleted your
 * restaurant".
 */
@Injectable()
export class RenewalSchedulerService {
  private readonly logger = new Logger(RenewalSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cycles: RenewalCycleService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Materialize the renewal for every tenant whose anniversary is inside the
   * lead window. Freezing it now is what gives the reminders something stable
   * to point at — and what guarantees the customer pays the price they were
   * quoted, not whatever the catalog says on the day they click.
   */
  @Cron("0 6 * * *", { name: "renewal-generate" })
  async generateRenewalCycles(): Promise<void> {
    await withAdvisoryLock(this.prisma, "renewal-generate", async () => {
      const now = new Date();
      const horizon = new Date(now.getTime() + RENEWAL_LEAD_DAYS * 86_400_000);

      const tenants = await this.prisma.tenant.findMany({
        where: { licenseAnchorAt: { not: null }, status: "ACTIVE" },
        select: { id: true, licenseAnchorAt: true, timezone: true },
      });

      let created = 0;
      for (const t of tenants) {
        const anniversary = nextAnniversary(
          t.licenseAnchorAt!,
          anchorDateFor(now, t.timezone || undefined),
        );
        if (anniversary > horizon) continue;
        try {
          const cycle = await this.cycles.generate(t.id, now);
          if (cycle) created++;
        } catch (err: any) {
          // One tenant's catalog problem must not stop everyone else's
          // renewal being generated.
          this.logger.error(
            `Renewal generation failed for tenant=${t.id}: ${err?.message}`,
          );
        }
      }
      this.logger.log(
        `Renewal generation: scanned=${tenants.length} created=${created}`,
      );
    });
  }

  /**
   * 30 / 7 / 1-day reminders.
   *
   * `markReminderSent` appends to the cycle's `remindersSent` array inside the
   * same UPDATE that checks the day is absent, so two replicas firing in the
   * same minute cannot both send. A duplicate reminder reads as a billing
   * system that has lost track of you.
   */
  @Cron("0 9 * * *", { name: "renewal-reminders" })
  async sendRenewalReminders(): Promise<void> {
    await withAdvisoryLock(this.prisma, "renewal-reminders", async () => {
      const now = new Date();
      const open = await this.prisma.renewalCycle.findMany({
        where: { status: "open" },
        select: {
          id: true,
          tenantId: true,
          anniversaryAt: true,
          totalCents: true,
          currency: true,
          remindersSent: true,
        },
      });

      let sent = 0;
      for (const cycle of open) {
        const daysLeft = daysBetweenUtc(now, cycle.anniversaryAt);
        // The largest threshold that has been reached and not yet sent —
        // so a tenant created inside the window still gets exactly one
        // reminder rather than three at once.
        const due = REMINDER_DAYS.find(
          (d) => daysLeft <= d && !cycle.remindersSent.includes(d),
        );
        if (due === undefined) continue;

        if (!(await this.cycles.markReminderSent(cycle.id, due))) continue;

        await this.outbox.append({
          type: EventTypes.RenewalReminder,
          tenantId: cycle.tenantId,
          payload: {
            tenantId: cycle.tenantId,
            renewalCycleId: cycle.id,
            anniversaryAt: cycle.anniversaryAt.toISOString(),
            daysLeft,
            totalCents: cycle.totalCents,
            currency: cycle.currency,
          } as any,
        });
        sent++;
      }
      this.logger.log(`Renewal reminders: open=${open.length} sent=${sent}`);
    });
  }

  /**
   * Close out renewals nobody paid.
   *
   * Runs at 00:30, comfortably before the add-on sweeper at 00:05 the next
   * day, and after the grace window has genuinely elapsed. Everything the
   * tenant did not renew expires; everything they DID renew was already
   * reactivated by settlement.
   */
  @Cron("30 0 * * *", { name: "renewal-lapse" })
  async lapseUnpaidCycles(): Promise<void> {
    await withAdvisoryLock(this.prisma, "renewal-lapse", async () => {
      const now = new Date();
      const lapsed = await this.prisma.renewalCycle.findMany({
        where: { status: "open", graceEndsAt: { lte: now } },
        select: { id: true, tenantId: true, anniversaryAt: true },
      });

      for (const cycle of lapsed) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.renewalCycle.updateMany({
              where: { id: cycle.id, status: "open" },
              data: { status: "lapsed", lapsedAt: now },
            });

            // Anything whose paid period ended before this anniversary and
            // was not re-paid. A row settlement renewed carries a
            // currentPeriodEnd a year out and is untouched here.
            const stale = await tx.tenantAddOn.findMany({
              where: {
                tenantId: cycle.tenantId,
                status: { in: ["active", "past_due"] },
                currentPeriodEnd: { lte: cycle.anniversaryAt },
              },
              include: { addOn: { select: { code: true } } },
            });

            for (const row of stale) {
              await tx.tenantAddOn.update({
                where: { id: row.id },
                data: { status: "expired", endedAt: now },
              });
              // Drives the projector to drop this source's grants. NOTHING
              // else is written: access goes, data stays.
              await this.outbox.append(
                {
                  type: EventTypes.AddOnCancelled,
                  tenantId: cycle.tenantId,
                  payload: {
                    tenantId: cycle.tenantId,
                    addOnId: row.id,
                    addOnCode: row.addOn.code,
                    branchId: row.branchId ?? null,
                    quantity: row.quantity,
                  },
                },
                tx,
              );
            }

            this.logger.warn(
              `Renewal lapsed for tenant=${cycle.tenantId}: ${stale.length} product(s) expired (data retained)`,
            );
          });
        } catch (err: any) {
          this.logger.error(
            `Lapse failed for cycle=${cycle.id}: ${err?.message}`,
          );
        }
      }
      if (lapsed.length > 0) {
        this.logger.log(`Renewal lapse: processed=${lapsed.length}`);
      }
    });
  }
}
