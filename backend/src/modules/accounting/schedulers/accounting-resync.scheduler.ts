import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { AccountingSyncService } from "../services/accounting-sync.service";
import { STUCK_SYNCING_THRESHOLD_MS } from "../constants/accounting.enum";

/**
 * Hourly re-sync of e-documents the provider rejected (externalStatus=FAILED) —
 * the async GİB accept lifecycle's recovery path. Finds tenants with FAILED
 * invoices — or crash-stuck SYNCING ones past the staleness threshold (audit
 * A6: a worker that died mid-sync leaves the row parked in SYNCING forever) —
 * and retries each tenant's batch; per-tenant + per-invoice failures are
 * isolated so one bad row can't stall the rest.
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
    const stuckBefore = new Date(Date.now() - STUCK_SYNCING_THRESHOLD_MS);
    const tenants = await this.prisma.salesInvoice.findMany({
      where: {
        OR: [
          { externalStatus: "FAILED" },
          // A6: crash-stuck SYNCING rows. resyncFailedInvoices releases them
          // back to FAILED (with a syncError trail) before its retry pass;
          // without this OR their tenants would never even enter the sweep.
          {
            externalStatus: "SYNCING",
            updatedAt: { lt: stuckBefore },
          },
        ],
      },
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
