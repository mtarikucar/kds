import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformProviderFactory } from '../services/platform-provider.factory';
import { OrderIntegrationService } from '../services/order-integration.service';
import { PlatformType } from '../constants';
import { IntegrationType } from '../../../common/constants/integration-types.enum';

/**
 * Scheduler for polling orders from platforms that don't support reliable webhooks.
 * This is a fallback mechanism to ensure no orders are missed.
 */
@Injectable()
export class OrderPollingScheduler {
  private readonly logger = new Logger(OrderPollingScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: PlatformProviderFactory,
    private readonly orderIntegrationService: OrderIntegrationService,
  ) {}

  /**
   * Poll for new orders every 2 minutes
   * This is a fallback for platforms with unreliable webhook delivery
   */
  @Cron(CronExpression.EVERY_10_SECONDS) // In production, use EVERY_2_MINUTES
  async pollForNewOrders() {
    try {
      // Get all tenants with polling-enabled platforms
      const settings = await this.prisma.integrationSettings.findMany({
        where: {
          integrationType: IntegrationType.DELIVERY_APP,
          isEnabled: true,
          isConfigured: true,
        },
      });

      // Group by tenant for efficient processing
      const tenantSettings = new Map<string, any[]>();
      for (const setting of settings) {
        const existing = tenantSettings.get(setting.tenantId) || [];
        existing.push(setting);
        tenantSettings.set(setting.tenantId, existing);
      }

      for (const [tenantId, platformSettings] of tenantSettings) {
        for (const setting of platformSettings) {
          // Check if polling is enabled for this platform
          const config = setting.config as { enablePolling?: boolean } | null;
          if (!config?.enablePolling) {
            continue;
          }

          await this.pollPlatform(tenantId, setting.provider as PlatformType);
        }
      }
    } catch (error: any) {
      this.logger.error(`Error in order polling: ${error.message}`);
    }
  }

  /**
   * Poll a specific platform for new orders
   */
  private async pollPlatform(tenantId: string, platformType: PlatformType) {
    try {
      const provider = await this.providerFactory.getProviderForTenant(
        platformType,
        tenantId,
      );

      // Get last poll timestamp
      const lastPoll = await this.getLastPollTimestamp(tenantId, platformType);

      // Fetch new orders since last poll
      const orders = await provider.fetchNewOrders(lastPoll);

      if (orders.length === 0) {
        return;
      }

      this.logger.log(
        `Found ${orders.length} new orders from ${platformType} for tenant ${tenantId}`,
      );

      for (const orderData of orders) {
        try {
          // Check if order already exists
          const existing = await this.prisma.platformOrder.findFirst({
            where: {
              tenantId,
              platformType,
              platformOrderId: orderData.platformOrderId,
            },
          });

          if (existing) {
            // Update status if changed
            if (existing.platformStatus !== orderData.platformStatus) {
              await this.prisma.platformOrder.update({
                where: { id: existing.id },
                data: {
                  platformStatus: orderData.platformStatus,
                  updatedAt: new Date(),
                },
              });
            }
            continue;
          }

          // Process as new order
          await this.orderIntegrationService.processIncomingOrder(
            tenantId,
            platformType,
            orderData,
          );
        } catch (error: any) {
          this.logger.error(
            `Failed to process polled order ${orderData.platformOrderId}: ${error.message}`,
          );
        }
      }

      // Update last poll timestamp
      await this.updateLastPollTimestamp(tenantId, platformType);
    } catch (error: any) {
      this.logger.error(
        `Failed to poll ${platformType} for tenant ${tenantId}: ${error.message}`,
      );
    }
  }

  /**
   * Get the timestamp of the last successful poll
   */
  private async getLastPollTimestamp(
    tenantId: string,
    platformType: PlatformType,
  ): Promise<Date> {
    const setting = await this.prisma.integrationSettings.findFirst({
      where: {
        tenantId,
        integrationType: IntegrationType.DELIVERY_APP,
        provider: platformType,
      },
    });

    // Default to 1 hour ago if no last poll
    return setting?.lastSyncedAt || new Date(Date.now() - 60 * 60 * 1000);
  }

  /**
   * Update the last poll timestamp
   */
  private async updateLastPollTimestamp(
    tenantId: string,
    platformType: PlatformType,
  ) {
    await this.prisma.integrationSettings.updateMany({
      where: {
        tenantId,
        integrationType: IntegrationType.DELIVERY_APP,
        provider: platformType,
      },
      data: {
        lastSyncedAt: new Date(),
      },
    });
  }

  /**
   * Sync order statuses every 5 minutes
   * This ensures platform and internal statuses stay in sync
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncOrderStatuses() {
    try {
      // Find active orders that may need status sync
      const activeOrders = await this.prisma.platformOrder.findMany({
        where: {
          internalStatus: {
            in: ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY'],
          },
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          },
        },
        include: {
          order: true,
        },
      });

      for (const platformOrder of activeOrders) {
        try {
          // Skip if no internal order linked
          if (!platformOrder.order) {
            continue;
          }

          const provider = await this.providerFactory.getProviderForTenant(
            platformOrder.platformType as PlatformType,
            platformOrder.tenantId,
          );

          // Get current status from platform
          const platformStatus = await provider.getOrderStatus(
            platformOrder.platformOrderId,
          );

          // Update if status changed
          if (platformStatus !== platformOrder.platformStatus) {
            await this.prisma.platformOrder.update({
              where: { id: platformOrder.id },
              data: {
                platformStatus,
                updatedAt: new Date(),
              },
            });

            this.logger.log(
              `Updated platform order ${platformOrder.id} status: ${platformOrder.platformStatus} -> ${platformStatus}`,
            );
          }
        } catch (error: any) {
          // Silently fail for individual orders
          this.logger.debug(
            `Failed to sync status for order ${platformOrder.id}: ${error.message}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Error in order status sync: ${error.message}`);
    }
  }
}
