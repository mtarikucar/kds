import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { DeliveryLogService } from "../services/delivery-log.service";
import { DeliveryStatusSyncService } from "../services/delivery-status-sync.service";
import { DeliveryAuthService } from "../services/delivery-auth.service";
import { AdapterFactory } from "../adapters/adapter-factory";
import { PlatformLogAction } from "../constants/platform.enum";
import { withAdvisoryLock } from "../../../common/scheduling/advisory-lock";

@Injectable()
export class RetryScheduler {
  private readonly logger = new Logger(RetryScheduler.name);
  // Same-pod overlap guard for ticks that overrun the 60s interval —
  // the advisory lock handles cross-replica coordination but doesn't
  // help if a single pod's tick is still running when the next fires.
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private logService: DeliveryLogService,
    private statusSyncService: DeliveryStatusSyncService,
    private authService: DeliveryAuthService,
    private adapterFactory: AdapterFactory,
  ) {}

  @Interval(60_000) // Every 1 minute
  async retryFailedOperations() {
    if (this.isRunning) {
      this.logger.debug("Previous retry tick still running, skipping");
      return;
    }
    this.isRunning = true;
    try {
      // Cross-replica coordination via shared withAdvisoryLock helper.
      // Without this, every pod fires @Interval(60_000) on the same
      // wall-clock minute, all fetch the same getFailedOperations(20)
      // rows, and all call adapter.acceptOrder for the same orders →
      // the delivery platform receives duplicate accept calls (some
      // platforms reject duplicates with errors that THEN bump our
      // circuit-breaker counter, others silently accept the dup and
      // tag the order with two acceptance timestamps). order-polling
      // and entitlement-projector already use this helper.
      await withAdvisoryLock(
        this.prisma,
        "delivery-retry-scheduler",
        async () => {
          await this.runRetries();
        },
        this.logger,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async runRetries() {
    try {
      const failedOps = await this.logService.getFailedOperations(20);

      for (const op of failedOps) {
        try {
          // Retry status sync operations
          if (op.action === PlatformLogAction.STATUS_UPDATE && op.orderId) {
            // Re-read current order status from DB to avoid syncing
            // stale status. Compound WHERE with the log's tenantId
            // (defence-in-depth) so a corrupt log entry pointing at
            // another tenant's order can't drive a cross-tenant
            // status sync.
            const order = await this.prisma.order.findFirst({
              where: { id: op.orderId, tenantId: op.tenantId },
            });
            if (!order) {
              await this.logService.markRetrySuccess(op.id);
              this.logger.log(
                `Order ${op.orderId} no longer exists, skipping retry for log ${op.id}`,
              );
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
            // Compound WHERE with op.tenantId — same rationale as the
            // STATUS_UPDATE branch above.
            const order = await this.prisma.order.findFirst({
              where: { id: op.orderId, tenantId: op.tenantId },
            });
            // Don't "accept" an order the staff has since rejected /
            // cancelled — otherwise the retry would silently flip it
            // back to the platform side.
            if (
              order &&
              ["CANCELLED", "REJECTED", "PAID"].includes(order.status as string)
            ) {
              await this.logService.markRetrySuccess(op.id);
              this.logger.log(
                `Skipping ORDER_ACCEPTED retry for ${op.orderId} (status ${order.status})`,
              );
              continue;
            }
            if (order?.source && order.tenantId) {
              const config =
                await this.prisma.deliveryPlatformConfig.findUnique({
                  where: {
                    tenantId_platform: {
                      tenantId: order.tenantId,
                      platform: order.source,
                    },
                  },
                });
              if (config) {
                const freshConfig = await this.authService.ensureValidToken(
                  config.id,
                );
                if (freshConfig) {
                  const adapter = this.adapterFactory.getAdapter(order.source);
                  await adapter.acceptOrder(freshConfig, op.externalId);
                  await this.logService.markRetrySuccess(op.id);
                  this.logger.log(
                    `ORDER_ACCEPTED retry succeeded for log ${op.id}`,
                  );
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
          this.logger.warn(`Retry failed for log ${op.id}: ${error.message}`);
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
