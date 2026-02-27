import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdapterFactory } from '../adapters/adapter-factory';
import { DeliveryLogService } from './delivery-log.service';
import { DeliveryAuthService } from './delivery-auth.service';
import {
  SYNCABLE_STATUSES,
  STATUS_TO_PLATFORM_ACTION,
} from '../constants/platform-status-map';
import {
  PlatformLogDirection,
  PlatformLogAction,
} from '../constants/platform.enum';

@Injectable()
export class DeliveryStatusSyncService {
  private readonly logger = new Logger(DeliveryStatusSyncService.name);

  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
    private logService: DeliveryLogService,
    private authService: DeliveryAuthService,
  ) {}

  /**
   * Called after an order status changes in KDS or POS.
   * Syncs the new status back to the delivery platform.
   */
  async syncStatusToPlatform(orderId: string, newStatus: string) {
    // Only sync statuses that platforms care about
    if (!SYNCABLE_STATUSES.has(newStatus as any)) return;

    // Look up the order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    // Only sync delivery platform orders
    if (!order?.source || !order.externalOrderId) return;

    const { source: platform, externalOrderId, tenantId } = order;

    // Get the platform config
    const config = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { tenantId_platform: { tenantId, platform } },
    });

    if (!config?.isEnabled) return;

    // Get the adapter method to call
    const actionName = STATUS_TO_PLATFORM_ACTION[newStatus];
    if (!actionName) {
      this.logger.warn(
        `No platform action mapped for status "${newStatus}" on order ${orderId} (${platform})`,
      );
      return;
    }

    try {
      // Ensure valid token
      const freshConfig = await this.authService.ensureValidToken(config.id);
      if (!freshConfig) return;

      const adapter = this.adapterFactory.getAdapter(platform);

      // Call the appropriate adapter method (type-safe)
      await adapter[actionName](freshConfig, externalOrderId);

      await this.logService.log({
        tenantId,
        platform,
        direction: PlatformLogDirection.OUTBOUND,
        action: PlatformLogAction.STATUS_UPDATE,
        orderId,
        externalId: externalOrderId,
        request: { status: newStatus, action: actionName },
        success: true,
      });

      this.logger.log(
        `Status synced to ${platform}: ${externalOrderId} → ${newStatus}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to sync status to ${platform} for order ${externalOrderId}: ${error.message}`,
      );

      await this.logService.log({
        tenantId,
        platform,
        direction: PlatformLogDirection.OUTBOUND,
        action: PlatformLogAction.STATUS_UPDATE,
        orderId,
        externalId: externalOrderId,
        request: { status: newStatus, action: actionName },
        success: false,
        error: error.message,
        statusCode: error.response?.status,
        nextRetryAt: new Date(Date.now() + 30_000),
      });
    }
  }
}
