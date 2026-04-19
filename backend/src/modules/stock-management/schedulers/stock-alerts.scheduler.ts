import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { StockAlertsService } from '../services/stock-alerts.service';

/**
 * Hourly background check for low-stock + expiring batches. Previously
 * these services only fired when a user happened to open the dashboard,
 * which meant a closed restaurant heading into the weekend never got
 * any warnings. Advisory lock keeps horizontally-scaled replicas from
 * stampeding the same tenants.
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
      >(`SELECT pg_try_advisory_lock(${this.lockId('stock-alerts')}) AS locked`);
      if (!locked) return;
      try {
        const tenants = await this.prisma.tenant.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true },
        });
        for (const { id } of tenants) {
          try {
            await this.alertsService.checkLowStock(id);
            await this.alertsService.checkExpiringBatches(id);
          } catch (err: any) {
            this.logger.error(
              `Stock alert check failed for tenant ${id}: ${err?.message}`,
            );
          }
        }
      } finally {
        await this.prisma.$queryRawUnsafe(
          `SELECT pg_advisory_unlock(${this.lockId('stock-alerts')})`,
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
