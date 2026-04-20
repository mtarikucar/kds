import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { ZReportsService } from '../z-reports.service';

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
  @Cron('*/15 * * * *', { name: 'z-report-email-check' })
  async handleZReportEmails() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const [{ locked }] = await this.prisma.$queryRawUnsafe<
        { locked: boolean }[]
      >(`SELECT pg_try_advisory_lock(${this.lockId('z-report-scheduler')}) AS locked`);
      if (!locked) {
        this.logger.debug('Another replica holds the z-report scheduler lock');
        return;
      }

      try {
        const tenantsAtClosingTime = await this.getTenantsAtClosingTime();
        if (tenantsAtClosingTime.length === 0) return;

        this.logger.log(`Found ${tenantsAtClosingTime.length} tenant(s) at closing time`);
        for (const tenant of tenantsAtClosingTime) {
          await this.processEndOfDayReport(tenant);
        }
      } finally {
        await this.prisma.$queryRawUnsafe(
          `SELECT pg_advisory_unlock(${this.lockId('z-report-scheduler')})`,
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
   * Get tenants whose closing time matches the current time (within 15-minute window)
   */
  private async getTenantsAtClosingTime() {
    // Get all tenants with report email enabled
    const tenants = await this.prisma.tenant.findMany({
      where: {
        reportEmailEnabled: true,
        reportEmails: {
          isEmpty: false,
        },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        closingTime: true,
        timezone: true,
        reportEmails: true,
      },
    });

    if (tenants.length === 0) {
      return [];
    }

    const now = new Date();
    const matchingTenants: typeof tenants = [];

    for (const tenant of tenants) {
      if (!tenant.closingTime) continue;

      // Parse tenant's closing time (HH:mm format)
      const [closingHour, closingMinute] = tenant.closingTime.split(':').map(Number);

      // Get current time in tenant's timezone
      const tenantNow = this.getTimeInTimezone(now, tenant.timezone || 'UTC');
      const currentHour = tenantNow.getHours();
      const currentMinute = tenantNow.getMinutes();

      // Check if current time matches closing time (within 15-minute window)
      // We check if we're within 0-14 minutes after the closing time
      const closingTimeInMinutes = closingHour * 60 + closingMinute;
      const currentTimeInMinutes = currentHour * 60 + currentMinute;

      // Match if current time is within 0-14 minutes after closing time
      const minutesSinceClosing = currentTimeInMinutes - closingTimeInMinutes;
      if (minutesSinceClosing >= 0 && minutesSinceClosing < 15) {
        // Check if we haven't already sent a report today IN THE TENANT'S
        // TIMEZONE. ZReportsService.generateReport writes `reportDate` as
        // the tenant-local midnight instant; using server-local midnight
        // here would miss-match for any non-UTC tenant and the scheduler
        // would then re-enter generateReport every 15min during the
        // closing window, each time throwing a BadRequestException that
        // polluted the error logs.
        const tenantTzMidnight = this.getTenantMidnight(
          now,
          tenant.timezone || 'UTC',
        );

        const existingReport = await this.prisma.zReport.findFirst({
          where: {
            tenantId: tenant.id,
            reportDate: tenantTzMidnight,
            emailSent: true,
          },
        });

        if (!existingReport) {
          matchingTenants.push(tenant);
        } else {
          this.logger.debug(`Report already sent today for tenant ${tenant.name}`);
        }
      }
    }

    return matchingTenants;
  }

  /**
   * UTC instant representing "today at 00:00" in the tenant's timezone.
   * Mirrors ZReportsService.computeDayBoundsInTimezone so the scheduler's
   * "already sent?" lookup hits the row that generateReport actually
   * created. Uses Intl.DateTimeFormat + offset correction; falls back to
   * server-local midnight on an unknown tz string.
   */
  private getTenantMidnight(now: Date, timezone: string): Date {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const y = parseInt(parts.find((p) => p.type === 'year')?.value ?? '1970', 10);
      const m = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1', 10);
      const d = parseInt(parts.find((p) => p.type === 'day')?.value ?? '1', 10);
      const approx = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
      const probe = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(approx);
      const get = (t: string) => parseInt(probe.find((p) => p.type === t)?.value ?? '0', 10);
      const zonedAsUtc = Date.UTC(
        get('year'),
        get('month') - 1,
        get('day'),
        get('hour') % 24,
        get('minute'),
        get('second'),
      );
      const offset = zonedAsUtc - approx.getTime();
      return new Date(approx.getTime() - offset);
    } catch {
      const fallback = new Date(now);
      fallback.setHours(0, 0, 0, 0);
      return fallback;
    }
  }

  private getTimeInTimezone(date: Date, timezone: string): Date {
    try {
      const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      };

      const formatter = new Intl.DateTimeFormat('en-US', options);
      const parts = formatter.formatToParts(date);

      const values: Record<string, number> = {};
      parts.forEach((part) => {
        if (part.type !== 'literal') {
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
   * Process end-of-day report for a tenant
   */
  private async processEndOfDayReport(tenant: { id: string; name: string }) {
    this.logger.log(`Processing end-of-day report for tenant: ${tenant.name}`);

    try {
      // Get or create admin user for this tenant
      const adminUser = await this.prisma.user.findFirst({
        where: {
          tenantId: tenant.id,
          role: 'ADMIN',
        },
        select: { id: true },
      });

      if (!adminUser) {
        this.logger.warn(`No admin user found for tenant ${tenant.name}, skipping`);
        return;
      }

      // Generate and send report
      const result = await this.zReportsService.generateAndSendReport(tenant.id, adminUser.id);

      if (result.emailSent) {
        this.logger.log(`Successfully sent Z-Report email for tenant ${tenant.name}`);
      } else {
        this.logger.warn(`Z-Report generated but email not sent for tenant ${tenant.name}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process report for tenant ${tenant.name}: ${error.message}`);
    }
  }

  /**
   * Manual trigger for testing
   */
  async triggerReportForTenant(tenantId: string): Promise<{ success: boolean; message: string }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    });

    if (!tenant) {
      return { success: false, message: 'Tenant not found' };
    }

    try {
      await this.processEndOfDayReport(tenant);
      return { success: true, message: 'Report processed successfully' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}
