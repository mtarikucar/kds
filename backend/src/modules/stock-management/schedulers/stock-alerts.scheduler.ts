import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { StockAlertsService } from "../services/stock-alerts.service";

/**
 * Hourly background check for low-stock + expiring batches. Previously
 * these services only fired when a user happened to open the dashboard,
 * which meant a closed restaurant heading into the weekend never got
 * any warnings. Advisory lock keeps horizontally-scaled replicas from
 * stampeding the same tenants.
 *
 * The realtime alert rooms are branch-suffixed (kitchen/pos-tenant-branch),
 * so the emit only reaches clients when a branchId is supplied. An earlier
 * version called the alert service tenant-wide (no branchId) — the queries
 * ran but the emit was gated behind `if (branchId && ...)`, so the cron
 * NEVER pushed an alert to a screen. We now iterate each tenant's ACTIVE
 * branches and run the checks per branch so the gateway emit actually fires.
 */
@Injectable()
export class StockAlertsScheduler {
  private readonly logger = new Logger(StockAlertsScheduler.name);
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private alertsService: StockAlertsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runHourlyChecks() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const [{ locked }] = await this.prisma.$queryRawUnsafe<
        { locked: boolean }[]
      >(
        `SELECT pg_try_advisory_lock(${this.lockId("stock-alerts")}) AS locked`,
      );
      if (!locked) return;
      try {
        // Pull every ACTIVE tenant together with its ACTIVE branches in one
        // query (bounded: tenants × their own branches, no N+1). Branch status
        // is the lowercase "active|suspended|archived" enum on the Branch
        // model — suspended/archived branches are skipped.
        const tenants = await this.prisma.tenant.findMany({
          where: { status: "ACTIVE" },
          select: {
            id: true,
            branches: {
              where: { status: "active" },
              select: { id: true },
            },
          },
        });
        for (const tenant of tenants) {
          for (const branch of tenant.branches) {
            try {
              // Pass branchId so the gateway emit fires (branch-suffixed rooms).
              await this.alertsService.checkLowStock(tenant.id, branch.id);
              await this.alertsService.checkExpiringBatches(
                tenant.id,
                undefined,
                branch.id,
              );
            } catch (err: any) {
              this.logger.error(
                `Stock alert check failed for tenant ${tenant.id} branch ${branch.id}: ${err?.message}`,
              );
            }
          }
        }
      } finally {
        await this.prisma.$queryRawUnsafe(
          `SELECT pg_advisory_unlock(${this.lockId("stock-alerts")})`,
        );
      }
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
}
