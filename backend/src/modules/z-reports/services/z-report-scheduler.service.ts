import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { ZReportsService } from "../z-reports.service";
import { getTenantMidnight } from "../../../common/helpers/timezone.helper";

@Injectable()
export class ZReportSchedulerService {
  private readonly logger = new Logger(ZReportSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly zReportsService: ZReportsService,
  ) {}

  /**
   * Check every 15 minutes for tenants at their closing time and
   * generate/send Z-Reports automatically. Protected by a postgres
   * advisory lock so horizontally-scaled replicas don't race each
   * other on the same tenants and emit duplicate fiscal reports /
   * duplicate emails. Matches the stock-alerts / delivery-polling
   * / subscription-scheduler pattern already in use.
   */
  @Cron("*/15 * * * *", { name: "z-report-email-check" })
  async handleZReportEmails() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const [{ locked }] = await this.prisma.$queryRawUnsafe<
        { locked: boolean }[]
      >(
        `SELECT pg_try_advisory_lock(${this.lockId("z-report-scheduler")}) AS locked`,
      );
      if (!locked) {
        this.logger.debug("Another replica holds the z-report scheduler lock");
        return;
      }

      try {
        // We no longer pre-filter tenants by the tenant-tz closing window
        // here. The closing-time match is now evaluated PER BRANCH in the
        // branch's own timezone (see processEndOfDayReport) so a London
        // branch under an Istanbul tenant fires at London's closing instant
        // rather than Istanbul's. We still only load tenants that have the
        // report email enabled with recipients — the cheap coarse filter.
        const tenants = await this.getEmailEnabledTenants();
        if (tenants.length === 0) return;

        for (const tenant of tenants) {
          await this.processEndOfDayReport(tenant);
        }
      } finally {
        await this.prisma.$queryRawUnsafe(
          `SELECT pg_advisory_unlock(${this.lockId("z-report-scheduler")})`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to process Z-Report emails: ${error.message}`,
        error.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private lockId(name: string): number {
    let hash = 5381;
    for (let i = 0; i < name.length; i += 1) {
      hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
    }
    return hash;
  }

  /**
   * Get tenants with report email enabled + recipients. No closing-window
   * filtering here — the window match is evaluated PER BRANCH in the
   * branch's own timezone (isAtClosingWindow), so we hand every eligible
   * tenant to processEndOfDayReport and let it decide per branch.
   */
  private async getEmailEnabledTenants() {
    return this.prisma.tenant.findMany({
      where: {
        reportEmailEnabled: true,
        reportEmails: {
          isEmpty: false,
        },
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        closingTime: true,
        timezone: true,
        reportEmails: true,
      },
    });
  }

  /**
   * True when `now` falls in the 0-14min window after the tenant's
   * `closingTime` (HH:mm), evaluated in `timezone`.
   *
   * `closingTime` currently lives only on the Tenant (there is no per-branch
   * closingTime column), so all of a tenant's branches share the same wall-
   * clock closing time — but each branch evaluates that time in its OWN
   * timezone. A London branch (Europe/London) under an Istanbul tenant whose
   * closingTime is "23:00" thus fires when it is 23:00 in London, not when it
   * is 23:00 in Istanbul. Fully independent per-branch closing times would
   * need a Branch.closingTime column (noted as remaining work).
   */
  private isAtClosingWindow(
    now: Date,
    closingTime: string | null | undefined,
    timezone: string,
  ): boolean {
    if (!closingTime) return false;
    const [closingHour, closingMinute] = closingTime.split(":").map(Number);
    if (!Number.isFinite(closingHour) || !Number.isFinite(closingMinute)) {
      return false;
    }
    const localNow = this.getTimeInTimezone(now, timezone || "UTC");
    const currentHour = localNow.getHours();
    const currentMinute = localNow.getMinutes();
    const closingTimeInMinutes = closingHour * 60 + closingMinute;
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const minutesSinceClosing = currentTimeInMinutes - closingTimeInMinutes;
    return minutesSinceClosing >= 0 && minutesSinceClosing < 15;
  }

  private getTimeInTimezone(date: Date, timezone: string): Date {
    try {
      const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      };

      const formatter = new Intl.DateTimeFormat("en-US", options);
      const parts = formatter.formatToParts(date);

      const values: Record<string, number> = {};
      parts.forEach((part) => {
        if (part.type !== "literal") {
          values[part.type] = parseInt(part.value, 10);
        }
      });

      return new Date(
        values.year,
        values.month - 1,
        values.day,
        values.hour,
        values.minute,
        values.second,
      );
    } catch (error) {
      this.logger.warn(`Invalid timezone ${timezone}, falling back to UTC`);
      return date;
    }
  }

  /**
   * Process end-of-day report for a tenant.
   *
   * v3.0.0: Z-Reports are branch-scoped. The scheduler iterates every
   * active branch under the tenant and generates one report per branch —
   * each branch closes independently for fiscal purposes. The admin user's
   * primary branch is used only as a fallback when a tenant has a single
   * active branch.
   *
   * `force` (manual trigger) bypasses the per-branch closing-window match so
   * an operator/test can generate immediately regardless of wall-clock time.
   * The scheduled path passes force=false so each branch only closes inside
   * its own-timezone closing window.
   */
  private async processEndOfDayReport(
    tenant: {
      id: string;
      name: string;
      timezone?: string | null;
      closingTime?: string | null;
    },
    force = false,
  ) {
    try {
      // Get or create admin user for this tenant
      const adminUser = await this.prisma.user.findFirst({
        where: {
          tenantId: tenant.id,
          role: "ADMIN",
        },
        select: { id: true, primaryBranchId: true },
      });

      if (!adminUser) {
        this.logger.warn(
          `No admin user found for tenant ${tenant.name}, skipping`,
        );
        return;
      }

      // Resolve the branches to close. Prefer all active branches; fall
      // back to the admin's primary branch when listing branches yields
      // nothing (e.g. legacy single-branch tenants whose only branch is
      // referenced solely via User.primaryBranchId).
      //
      // We load each branch's `timezone` so the closing-time window match
      // and the dedup midnight are evaluated in the BRANCH's timezone
      // (falling back to the tenant tz when a branch has none) — this is
      // the per-branch-timezone fix: a multi-tz chain's off-tz branch no
      // longer fires/buckets on the single tenant timezone.
      let branches = await this.prisma.branch.findMany({
        where: { tenantId: tenant.id, status: "active" },
        select: { id: true, timezone: true },
      });
      if (branches.length === 0 && adminUser.primaryBranchId) {
        const fallback = await this.prisma.branch.findFirst({
          where: { id: adminUser.primaryBranchId },
          select: { id: true, timezone: true },
        });
        if (fallback) branches = [fallback];
      }

      if (branches.length === 0) {
        this.logger.warn(
          `No branches resolved for tenant ${tenant.name}, skipping`,
        );
        return;
      }

      const now = new Date();
      // Generate and send report for each branch that is at its closing
      // window in ITS OWN timezone (or every branch when force=true).
      for (const branch of branches) {
        const branchTz = branch.timezone || tenant.timezone || "UTC";
        if (
          !force &&
          !this.isAtClosingWindow(now, tenant.closingTime, branchTz)
        ) {
          continue;
        }
        await this.runForBranch(tenant, branch.id, adminUser.id, branchTz);
      }
      return;
    } catch (error) {
      this.logger.error(
        `Failed to process report for tenant ${tenant.name}: ${error.message}`,
      );
    }
  }

  private async runForBranch(
    tenant: { id: string; name: string; timezone?: string | null },
    branchId: string,
    userId: string,
    branchTz: string,
  ) {
    try {
      // PER-BRANCH dedup: skip only THIS branch if it already has a
      // finalized report for today (BRANCH-tz midnight). Each branch
      // closes independently, so one branch being done must NOT skip the
      // others — that was the leak when the check lived at tenant level.
      //
      // Branch-tz midnight: ZReportsService.generateAndSendReport now writes
      // `reportDate` as the BRANCH-local midnight instant via the same
      // getTenantMidnight helper (branchTz resolved below), so the dedup-read
      // and the generate-and-send-write key off the same UTC instant. Falls
      // back to tenant tz when the branch has none. isFinalized (not
      // emailSent) is the dedup axis: a finalized-but-email-failed report
      // must NOT re-enter the whole generate-and-send loop every 15 minutes.
      const branchTzMidnight = getTenantMidnight(new Date(), branchTz);
      const existingReport = await this.prisma.zReport.findFirst({
        where: {
          tenantId: tenant.id,
          branchId,
          reportDate: branchTzMidnight,
          isFinalized: true,
        },
      });
      if (existingReport) {
        this.logger.debug(
          `Report already sent today for tenant ${tenant.name} branch ${branchId}`,
        );
        return;
      }

      const result = await this.zReportsService.generateAndSendReport(
        tenant.id,
        branchId,
        userId,
      );

      if (result.emailSent) {
        this.logger.log(
          `Successfully sent Z-Report email for tenant ${tenant.name}`,
        );
      } else {
        this.logger.warn(
          `Z-Report generated but email not sent for tenant ${tenant.name}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process report for tenant ${tenant.name}: ${error.message}`,
      );
    }
  }

  /**
   * Manual trigger for testing
   */
  async triggerReportForTenant(
    tenantId: string,
  ): Promise<{ success: boolean; message: string }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, timezone: true, closingTime: true },
    });

    if (!tenant) {
      return { success: false, message: "Tenant not found" };
    }

    try {
      // Manual trigger forces generation for every branch regardless of the
      // closing-window match (the operator asked for it now).
      await this.processEndOfDayReport(tenant, true);
      return { success: true, message: "Report processed successfully" };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}
