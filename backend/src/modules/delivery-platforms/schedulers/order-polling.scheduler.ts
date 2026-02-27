import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdapterFactory } from '../adapters/adapter-factory';
import { DeliveryOrderService } from '../services/delivery-order.service';
import { DeliveryAuthService } from '../services/delivery-auth.service';
import { DeliveryConfigService } from '../services/delivery-config.service';
import { DeliveryLogService } from '../services/delivery-log.service';
import {
  POLLING_PLATFORMS,
  PLATFORM_POLL_INTERVALS,
  CIRCUIT_BREAKER_THRESHOLD,
} from '../constants/platform-status-map';
import { PlatformLogDirection, PlatformLogAction } from '../constants/platform.enum';

@Injectable()
export class OrderPollingScheduler {
  private readonly logger = new Logger(OrderPollingScheduler.name);

  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
    private orderService: DeliveryOrderService,
    private authService: DeliveryAuthService,
    private configService: DeliveryConfigService,
    private logService: DeliveryLogService,
  ) {}

  @Interval(15_000) // Run every 15 seconds
  async pollOrders() {
    // Get all enabled configs for polling-based platforms
    const configs = await this.prisma.deliveryPlatformConfig.findMany({
      where: {
        isEnabled: true,
        platform: { in: [...POLLING_PLATFORMS] },
        errorCount: { lt: CIRCUIT_BREAKER_THRESHOLD },
      },
    });

    for (const config of configs) {
      // Respect per-platform minimum intervals
      const minInterval = PLATFORM_POLL_INTERVALS[config.platform] || 15_000;
      if (
        config.lastOrderPollAt &&
        Date.now() - config.lastOrderPollAt.getTime() < minInterval
      ) {
        continue;
      }

      await this.pollPlatform(config);
    }
  }

  private async pollPlatform(config: any) {
    const adapter = this.adapterFactory.getAdapter(config.platform);
    if (!adapter.pollNewOrders) return;

    try {
      // Ensure valid token
      const freshConfig = await this.authService.ensureValidToken(config.id);
      if (!freshConfig) return;

      const orders = await adapter.pollNewOrders(freshConfig);

      // Update last poll time and reset error count on success
      await this.configService.updateLastPollTime(config.id);
      if (config.errorCount > 0) {
        await this.configService.resetErrorCount(config.id);
      }

      // Process each new order
      for (const normalizedOrder of orders) {
        try {
          await this.orderService.processIncomingOrder(
            config.tenantId,
            normalizedOrder,
          );
        } catch (error: any) {
          this.logger.error(
            `Failed to process ${config.platform} order ${normalizedOrder.externalOrderId}: ${error.message}`,
          );
          await this.logService.log({
            tenantId: config.tenantId,
            platform: config.platform,
            direction: PlatformLogDirection.INBOUND,
            action: PlatformLogAction.ORDER_RECEIVED,
            externalId: normalizedOrder.externalOrderId,
            request: normalizedOrder.rawPayload,
            success: false,
            error: error.message,
            nextRetryAt: new Date(Date.now() + 30_000),
          });
        }
      }

      if (orders.length > 0) {
        this.logger.log(
          `Polled ${orders.length} new orders from ${config.platform} (tenant: ${config.tenantId})`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Poll failed for ${config.platform} (tenant: ${config.tenantId}): ${error.message}`,
      );

      await this.configService.recordError(config.id, error.message);

      await this.logService.log({
        tenantId: config.tenantId,
        platform: config.platform,
        direction: PlatformLogDirection.INBOUND,
        action: PlatformLogAction.ORDER_POLL,
        success: false,
        error: error.message,
        statusCode: error.response?.status,
      });
    }
  }
}
