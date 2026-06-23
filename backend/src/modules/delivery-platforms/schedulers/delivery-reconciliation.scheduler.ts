import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { withAdvisoryLock } from "../../../common/scheduling/advisory-lock";
import { DeliveryReconciliationService } from "../services/delivery-reconciliation.service";

/**
 * Low-frequency (daily) reconciliation sweep for delivery-platform configs.
 *
 * Guarded exactly like the other delivery schedulers: a same-pod `isRunning`
 * overlap guard plus a cross-replica `withAdvisoryLock` so only one replica
 * runs the pass per tick. The heavy lifting is in DeliveryReconciliationService
 * — this class only schedules + coordinates and swallows errors so a transient
 * DB blip can never crash the scheduler.
 */
@Injectable()
export class DeliveryReconciliationScheduler {
  private readonly logger = new Logger(DeliveryReconciliationScheduler.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliationService: DeliveryReconciliationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: "delivery-reconciliation",
  })
  async runReconciliation(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug("Previous reconciliation tick still running, skipping");
      return;
    }
    this.isRunning = true;
    try {
      await withAdvisoryLock(
        this.prisma,
        "delivery-reconciliation-scheduler",
        async () => {
          try {
            const summary = await this.reconciliationService.reconcile();
            this.logger.log(
              `Delivery reconciliation complete: ${summary.scannedConfigs} configs scanned, ${summary.driftedConfigs} drifted`,
            );
          } catch (error: any) {
            this.logger.error(
              `Delivery reconciliation failed: ${error?.message}`,
            );
          }
        },
        this.logger,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
