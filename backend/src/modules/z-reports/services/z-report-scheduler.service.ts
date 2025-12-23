import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { ZReportsService } from '../z-reports.service';

@Injectable()
export class ZReportSchedulerService {
  private readonly logger = new Logger(ZReportSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zReportsService: ZReportsService,
  ) {}

  /**
   * Check every 15 minutes for tenants at their closing time
   * and generate/send Z-Reports automatically
   */
  @Cron('*/15 * * * *', { name: 'z-report-email-check' })
  async handleZReportEmails() {
    this.logger.log('Checking for tenants at closing time...');

    try {
      const tenantsAtClosingTime = await this.getTenantsAtClosingTime();

      if (tenantsAtClosingTime.length === 0) {
        this.logger.debug('No tenants at closing time');
        return;
      }

      this.logger.log(`Found ${tenantsAtClosingTime.length} tenant(s) at closing time`);

      for (const tenant of tenantsAtClosingTime) {
        await this.processEndOfDayReport(tenant);
      }
    } catch (error) {
      this.logger.error(`Failed to process Z-Report emails: ${error.message}`, error.stack);
    }
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
        // Check if we haven't already sent a report today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existingReport = await this.prisma.zReport.findFirst({
          where: {
            tenantId: tenant.id,
            reportDate: today,
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
   * Convert a date to a specific timezone
   */
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
