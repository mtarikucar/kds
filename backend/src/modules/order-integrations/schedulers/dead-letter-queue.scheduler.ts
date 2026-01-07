import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderIntegrationService } from '../services/order-integration.service';
import { PlatformType } from '../constants';
import { PlatformOrderData } from '../interfaces';

/**
 * Scheduler for processing failed webhook payloads from the dead letter queue.
 * Uses exponential backoff for retries.
 *
 * NOTE: This scheduler is deprecated when Kafka DLQ is enabled (USE_KAFKA_DLQ=true).
 * In that case, the DLQConsumerService handles retry logic via Kafka topics.
 */
@Injectable()
export class DeadLetterQueueScheduler {
  private readonly logger = new Logger(DeadLetterQueueScheduler.name);
  private readonly useKafkaDLQ: boolean;

  // Exponential backoff intervals in minutes
  private readonly RETRY_INTERVALS = [1, 5, 15, 30, 60];

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly orderIntegrationService: OrderIntegrationService,
  ) {
    this.useKafkaDLQ = this.configService.get<boolean>('kafka.useKafkaDLQ', false) ||
                       this.configService.get<string>('USE_KAFKA_DLQ') === 'true';
  }

  /**
   * Process pending dead letter queue items every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processDeadLetterQueue() {
    // Skip if Kafka DLQ is enabled
    if (this.useKafkaDLQ) {
      this.logger.debug('Database DLQ disabled - using Kafka DLQ');
      return;
    }

    try {
      // Find items ready for retry
      const pendingItems = await this.prisma.webhookDeadLetter.findMany({
        where: {
          status: 'PENDING',
          nextRetryAt: {
            lte: new Date(),
          },
          retryCount: {
            lt: 5, // Max retries
          },
        },
        take: 10, // Process in batches
        orderBy: { createdAt: 'asc' },
      });

      if (pendingItems.length === 0) {
        return;
      }

      this.logger.log(`Processing ${pendingItems.length} dead letter items`);

      for (const item of pendingItems) {
        await this.processItem(item);
      }
    } catch (error: any) {
      this.logger.error(`Error processing dead letter queue: ${error.message}`);
    }
  }

  /**
   * Process a single dead letter item
   */
  private async processItem(item: any) {
    try {
      this.logger.log(
        `Retrying webhook ${item.id} (attempt ${item.retryCount + 1})`,
      );

      // Parse the payload based on webhook type
      const payload = item.payload as any;

      if (item.webhookType === 'ORDER') {
        // Re-process as incoming order
        const orderData: PlatformOrderData = {
          platformOrderId: payload.platformOrderId || payload.id,
          platformOrderNumber: payload.platformOrderNumber || payload.orderNumber,
          platformType: item.platformType as PlatformType,
          platformStatus: payload.status || 'NEW',
          rawData: payload,
          customerName: payload.customerName || payload.customer?.name,
          customerPhone: payload.customerPhone || payload.customer?.phone,
          customerAddress: payload.deliveryAddress || payload.customer?.address,
          deliveryAddress: payload.deliveryAddress,
          deliveryInstructions: payload.deliveryInstructions,
          estimatedDeliveryTime: payload.estimatedDeliveryTime,
          paymentMethod: payload.paymentMethod,
          isPrepaid: payload.isPrepaid ?? true,
          subtotal: payload.subtotal || payload.total,
          deliveryFee: payload.deliveryFee || 0,
          discount: payload.discount || 0,
          total: payload.total,
          createdAt: new Date(payload.createdAt || Date.now()),
          items: payload.items || [],
        };

        await this.orderIntegrationService.processIncomingOrder(
          item.tenantId,
          item.platformType as PlatformType,
          orderData,
        );

        // Mark as resolved
        await this.prisma.webhookDeadLetter.update({
          where: { id: item.id },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
          },
        });

        this.logger.log(`Successfully processed dead letter item ${item.id}`);
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to process dead letter item ${item.id}: ${error.message}`,
      );

      // Calculate next retry time with exponential backoff
      const nextRetryIndex = Math.min(
        item.retryCount,
        this.RETRY_INTERVALS.length - 1,
      );
      const nextRetryMinutes = this.RETRY_INTERVALS[nextRetryIndex];
      const nextRetryAt = new Date(Date.now() + nextRetryMinutes * 60 * 1000);

      // Update with error and next retry time
      await this.prisma.webhookDeadLetter.update({
        where: { id: item.id },
        data: {
          retryCount: item.retryCount + 1,
          nextRetryAt,
          errorMessage: error.message,
          status:
            item.retryCount + 1 >= item.maxRetries ? 'FAILED' : 'PENDING',
        },
      });
    }
  }

  /**
   * Clean up old resolved/failed items (runs daily)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldItems() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await this.prisma.webhookDeadLetter.deleteMany({
        where: {
          OR: [
            {
              status: 'RESOLVED',
              resolvedAt: { lt: thirtyDaysAgo },
            },
            {
              status: 'FAILED',
              updatedAt: { lt: thirtyDaysAgo },
            },
          ],
        },
      });

      if (result.count > 0) {
        this.logger.log(`Cleaned up ${result.count} old dead letter items`);
      }
    } catch (error: any) {
      this.logger.error(`Error cleaning up dead letter queue: ${error.message}`);
    }
  }

  /**
   * Add item to dead letter queue
   */
  async addToQueue(params: {
    tenantId: string;
    platformType: string;
    webhookType: string;
    payload: any;
    headers?: Record<string, string>;
    errorMessage: string;
  }) {
    const nextRetryAt = new Date(Date.now() + this.RETRY_INTERVALS[0] * 60 * 1000);

    await this.prisma.webhookDeadLetter.create({
      data: {
        tenantId: params.tenantId,
        platformType: params.platformType,
        webhookType: params.webhookType,
        payload: params.payload,
        headers: params.headers,
        errorMessage: params.errorMessage,
        nextRetryAt,
        maxRetries: 5,
      },
    });

    this.logger.log(
      `Added item to dead letter queue for ${params.platformType}`,
    );
  }
}
