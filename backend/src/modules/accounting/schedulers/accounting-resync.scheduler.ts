import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { AccountingSyncService } from "../services/accounting-sync.service";

/**
 * Hourly re-sync of e-documents the provider rejected (externalStatus=FAILED) —
 * the async GİB accept lifecycle's recovery path. Finds tenants with FAILED
 * invoices and retries each tenant's batch; per-tenant + per-invoice failures
 * are isolated so one bad row can't stall the rest.
 */
@Injectable()
export class AccountingResyncScheduler {
  private readonly logger = new Logger(AccountingResyncScheduler.name);

  constructor(
    private prisma: PrismaService,
    private sync: AccountingSyncService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async resyncFailed(): Promise<void> {
    const tenants = await this.prisma.salesInvoice.findMany({
      where: { externalStatus: "FAILED" },
      select: { tenantId: true },
      distinct: ["tenantId"],
      take: 500,
    });
    for (const t of tenants) {
      try {
        const n = await this.sync.resyncFailedInvoices(t.tenantId);
        if (n > 0) {
          this.logger.log(
            `Re-synced ${n} FAILED e-document(s) for tenant ${t.tenantId}`,
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `Re-sync sweep failed for tenant ${t.tenantId}: ${err?.message}`,
        );
      }
    }
  }
}
