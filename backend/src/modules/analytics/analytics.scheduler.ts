import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { InsightsService } from "./services/insights.service";

/**
 * Nightly insights refresh. InsightsService.generateInsights previously only
 * ran when a client happened to call the on-demand endpoint — in production
 * nothing called it, so insights were simply never produced. This cron runs
 * once a day (03:30, low-traffic window) for every ACTIVE branch of every
 * ACTIVE tenant, then prunes expired implemented/dismissed insights per
 * tenant.
 *
 * Advisory lock keeps horizontally-scaled replicas from generating duplicate
 * insights for the same tenants — matches the stock-alerts / z-report /
 * subscription-scheduler pattern already in use.
 */
@Injectable()
export class AnalyticsScheduler {
  private readonly logger = new Logger(AnalyticsScheduler.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly insightsService: InsightsService,
  ) {}

  @Cron("30 3 * * *", { name: "analytics-insights-daily" })
  async handleDailyInsights() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const [{ locked }] = await this.prisma.$queryRawUnsafe<
        { locked: boolean }[]
      >(
        `SELECT pg_try_advisory_lock(${this.lockId("analytics-insights")}) AS locked`,
      );
      if (!locked) {
        this.logger.debug(
          "Another replica holds the analytics-insights scheduler lock",
        );
        return;
      }

      try {
        // Pull every ACTIVE tenant together with its ACTIVE branches in one
        // query (bounded: tenants × their own branches, no N+1). Insights are
        // per-branch (they derive from branch-scoped tableAnalytics /
        // trafficFlowRecord rows), so generation iterates branches; the
        // expired-insight prune is tenant-wide.
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
              await this.insightsService.generateInsights(tenant.id, branch.id);
            } catch (err: any) {
              this.logger.error(
                `Insight generation failed for tenant ${tenant.id} branch ${branch.id}: ${err?.message}`,
              );
            }
          }
          try {
            await this.insightsService.archiveExpiredInsights(tenant.id);
          } catch (err: any) {
            this.logger.error(
              `Insight archival failed for tenant ${tenant.id}: ${err?.message}`,
            );
          }
        }
      } finally {
        await this.prisma.$queryRawUnsafe(
          `SELECT pg_advisory_unlock(${this.lockId("analytics-insights")})`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to run daily insights job: ${error.message}`,
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
}
