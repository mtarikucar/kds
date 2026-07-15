import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { withAdvisoryLock } from "../../../common/scheduling/advisory-lock";

/**
 * Nightly retention sweep for the camera-CV telemetry tables. The edge
 * ingest appends occupancy rows at fps × cameras × tenants — the only axis
 * in this product that grows faster than orders — and until this service
 * NOTHING pruned them in production (only the dev mock generator deleted
 * rows). Unbounded telemetry on the same Postgres that holds money data is
 * a disk-pressure incident waiting for the hardware go-live.
 *
 * Retention windows (env-tunable):
 *  - occupancy_records:    ANALYTICS_OCCUPANCY_RETENTION_DAYS (default 30)
 *  - traffic_flow_records: ANALYTICS_TRAFFIC_RETENTION_DAYS  (default 90)
 *  - analytics heatmap cache: expired rows (validUntil in the past)
 *
 * Deletes run in fixed-size batches with a per-run batch cap so a huge
 * backlog can't hold long row locks or bloat one transaction; the next
 * night's run continues where this one stopped. Advisory-locked so only
 * one replica sweeps; the deletes are idempotent anyway.
 */
@Injectable()
export class AnalyticsRetentionService {
  private readonly logger = new Logger(AnalyticsRetentionService.name);

  private static readonly BATCH_SIZE = 5000;
  private static readonly MAX_BATCHES_PER_RUN = 40; // ≤200k rows/table/night

  constructor(private readonly prisma: PrismaService) {}

  private retentionDays(envKey: string, fallback: number): number {
    const raw = Number(process.env[envKey]);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  @Cron("40 3 * * *")
  async sweep(): Promise<void> {
    await withAdvisoryLock(
      this.prisma,
      "analytics.retention-sweep",
      async () => {
        const occupancyDays = this.retentionDays(
          "ANALYTICS_OCCUPANCY_RETENTION_DAYS",
          30,
        );
        const trafficDays = this.retentionDays(
          "ANALYTICS_TRAFFIC_RETENTION_DAYS",
          90,
        );

        const occupancy = await this.pruneBatched(
          "occupancy_records",
          "timestamp",
          new Date(Date.now() - occupancyDays * 24 * 60 * 60 * 1000),
        );
        const traffic = await this.pruneBatched(
          "traffic_flow_records",
          "hourBucket",
          new Date(Date.now() - trafficDays * 24 * 60 * 60 * 1000),
        );
        // Heatmap cache rows carry their own expiry; the write path purges
        // per-tenant, this catches tenants that stopped writing.
        const cache = await this.prisma.analyticsHeatmapCache.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });

        if (occupancy + traffic + cache.count > 0) {
          this.logger.log(
            `Retention sweep: occupancy=${occupancy} traffic=${traffic} expiredCache=${cache.count} rows pruned`,
          );
        }
      },
    );
  }

  /** Batched delete by an indexed timestamp column. The column name comes
      from the two hardcoded call sites above — never user input. */
  private async pruneBatched(
    table: "occupancy_records" | "traffic_flow_records",
    column: "timestamp" | "hourBucket",
    cutoff: Date,
  ): Promise<number> {
    let total = 0;
    for (let i = 0; i < AnalyticsRetentionService.MAX_BATCHES_PER_RUN; i++) {
      const deleted: number = await this.prisma.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "id" IN (SELECT "id" FROM "${table}" WHERE "${column}" < $1 LIMIT ${AnalyticsRetentionService.BATCH_SIZE})`,
        cutoff,
      );
      total += deleted;
      if (deleted < AnalyticsRetentionService.BATCH_SIZE) break;
    }
    if (total === AnalyticsRetentionService.MAX_BATCHES_PER_RUN * 5000) {
      this.logger.warn(
        `Retention sweep hit the per-run cap on ${table} — backlog continues tomorrow`,
      );
    }
    return total;
  }
}
