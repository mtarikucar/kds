import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { DeliveryLogService } from '../services/delivery-log.service';
import { DeliveryStatusSyncService } from '../services/delivery-status-sync.service';
import { DeliveryAuthService } from '../services/delivery-auth.service';
import { AdapterFactory } from '../adapters/adapter-factory';
import { PlatformLogAction } from '../constants/platform.enum';

@Injectable()
export class RetryScheduler {
  private readonly logger = new Logger(RetryScheduler.name);

  constructor(
    private prisma: PrismaService,
    private logService: DeliveryLogService,
    private statusSyncService: DeliveryStatusSyncService,
    private authService: DeliveryAuthService,
    private adapterFactory: AdapterFactory,
  ) {}

  @Interval(60_000) // Every 1 minute
  async retryFailedOperations() {
    try {
      const failedOps = await this.logService.getFailedOperations(20);

      for (const op of failedOps) {
        try {
          // Retry status sync operations
          if (
            op.action === PlatformLogAction.STATUS_UPDATE &&
            op.orderId
          ) {
            // Re-read current order status from DB to avoid syncing stale status
            const order = await this.prisma.order.findUnique({
              where: { id: op.orderId },
            });
            if (!order) {
              await this.logService.markRetrySuccess(op.id);
              this.logger.log(`Order ${op.orderId} no longer exists, skipping retry for log ${op.id}`);
              continue;
            }
            await this.statusSyncService.syncStatusToPlatform(
              op.orderId,
              order.status,
            );
            await this.logService.markRetrySuccess(op.id);
            this.logger.log(`Retry succeeded for log ${op.id}`);
          } else if (
            op.action === PlatformLogAction.ORDER_ACCEPTED &&
            op.orderId &&
            op.externalId
          ) {
            // Retry auto-accept: look up order, get config + adapter, re-call acceptOrder
            const order = await this.prisma.order.findUnique({
              where: { id: op.orderId },
            });
            // Don't "accept" an order the staff has since rejected /
            // cancelled — otherwise the retry would silently flip it
            // back to the platform side.
            if (
              order &&
              ['CANCELLED', 'REJECTED', 'PAID'].includes(order.status as string)
            ) {
              await this.logService.markRetrySuccess(op.id);
              this.logger.log(
                `Skipping ORDER_ACCEPTED retry for ${op.orderId} (status ${order.status})`,
              );
              continue;
            }
            if (order?.source && order.tenantId) {
              const config = await this.prisma.deliveryPlatformConfig.findUnique({
                where: {
                  tenantId_platform: {
                    tenantId: order.tenantId,
                    platform: order.source,
                  },
                },
              });
              if (config) {
                const freshConfig = await this.authService.ensureValidToken(config.id);
                if (freshConfig) {
                  const adapter = this.adapterFactory.getAdapter(order.source);
                  await adapter.acceptOrder(freshConfig, op.externalId);
                  await this.logService.markRetrySuccess(op.id);
                  this.logger.log(`ORDER_ACCEPTED retry succeeded for log ${op.id}`);
                  continue;
                }
              }
            }
            await this.logService.incrementRetry(op.id);
          } else {
            // For non-status-sync operations, just increment retry count
            await this.logService.incrementRetry(op.id);
          }
        } catch (error: any) {
          await this.logService.incrementRetry(op.id);
          this.logger.warn(
            `Retry failed for log ${op.id}: ${error.message}`,
          );
        }
      }

      if (failedOps.length > 0) {
        this.logger.log(`Processed ${failedOps.length} retry operations`);
      }
    } catch (error: any) {
      this.logger.error(`Retry scheduler error: ${error.message}`);
    }
  }
}
