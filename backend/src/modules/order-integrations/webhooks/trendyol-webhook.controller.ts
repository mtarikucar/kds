import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderIntegrationService } from '../services/order-integration.service';
import { TrendyolProvider } from '../services/providers/trendyol.provider';
import { WebhookProducerService } from '../../kafka/producers/webhook-producer.service';
import { PlatformType, TrendyolWebhookEvent } from '../constants';
import { DeadLetterStatus } from '../constants/platform-status.enum';

@Controller('webhooks/trendyol')
export class TrendyolWebhookController {
  private readonly logger = new Logger(TrendyolWebhookController.name);
  private readonly kafkaEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly orderIntegrationService: OrderIntegrationService,
    private readonly trendyolProvider: TrendyolProvider,
    private readonly webhookProducer: WebhookProducerService,
  ) {
    this.kafkaEnabled = this.configService.get<boolean>('kafka.enabled', false);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
  ) {
    const correlationId = headers['x-correlation-id'] || randomUUID();
    this.logger.log(`Received Trendyol webhook: ${payload.eventType}`, { correlationId });

    // Verify signature
    if (!this.trendyolProvider.verifyWebhook(payload, headers)) {
      this.logger.warn('Invalid webhook signature', { correlationId });
      throw new BadRequestException('Invalid signature');
    }

    // Extract tenant ID from headers or payload
    const tenantId = headers['x-tenant-id'] || payload.tenantId;

    if (!tenantId) {
      this.logger.error('No tenant ID in webhook', { correlationId });
      throw new BadRequestException('Missing tenant ID');
    }

    // Extract platform order ID
    const platformOrderId = payload.orderId || payload.id || payload.orderNumber;

    // If Kafka is enabled, produce to Kafka for async processing
    if (this.kafkaEnabled && this.webhookProducer.isEnabled()) {
      return this.handleWithKafka(tenantId, platformOrderId, payload, headers, correlationId);
    }

    // Fallback to synchronous processing
    return this.handleSynchronously(tenantId, payload, headers, correlationId);
  }

  /**
   * Handle webhook via Kafka (async processing)
   */
  private async handleWithKafka(
    tenantId: string,
    platformOrderId: string,
    payload: any,
    headers: Record<string, string>,
    correlationId: string,
  ) {
    try {
      const webhookType = this.mapEventType(payload.eventType);

      await this.webhookProducer.produce({
        tenantId,
        platformType: PlatformType.TRENDYOL,
        platformOrderId,
        webhookType,
        rawPayload: payload,
        headers,
        correlationId,
      });

      this.logger.log(`Webhook queued for async processing: ${platformOrderId}`, { correlationId });

      return {
        success: true,
        correlationId,
        message: 'Webhook received and queued for processing',
      };
    } catch (error: any) {
      this.logger.error(`Failed to queue webhook to Kafka: ${error.message}`, { correlationId });
      // Fallback to synchronous processing
      return this.handleSynchronously(tenantId, payload, headers, correlationId);
    }
  }

  /**
   * Handle webhook synchronously (fallback mode)
   */
  private async handleSynchronously(
    tenantId: string,
    payload: any,
    headers: Record<string, string>,
    correlationId: string,
  ) {
    try {
      switch (payload.eventType) {
        case TrendyolWebhookEvent.ORDER_CREATED:
          await this.handleOrderCreated(tenantId, payload);
          break;

        case TrendyolWebhookEvent.ORDER_CANCELLED:
          await this.handleOrderCancelled(tenantId, payload);
          break;

        case TrendyolWebhookEvent.ORDER_UPDATED:
          await this.handleOrderUpdated(tenantId, payload);
          break;

        default:
          this.logger.warn(`Unknown event type: ${payload.eventType}`, { correlationId });
      }

      return { success: true, correlationId };
    } catch (error: any) {
      this.logger.error(`Webhook processing failed: ${error.message}`, { correlationId, stack: error.stack });

      // Add to dead letter queue for retry
      await this.addToDeadLetterQueue(tenantId, payload, headers, error);

      // Return success to prevent platform from retrying immediately
      return { success: true, queued: true, correlationId };
    }
  }

  /**
   * Map Trendyol event type to standard webhook type
   */
  private mapEventType(eventType: string): 'ORDER_CREATED' | 'ORDER_CANCELLED' | 'ORDER_UPDATED' | 'STATUS_CHANGED' {
    switch (eventType) {
      case TrendyolWebhookEvent.ORDER_CREATED:
        return 'ORDER_CREATED';
      case TrendyolWebhookEvent.ORDER_CANCELLED:
        return 'ORDER_CANCELLED';
      case TrendyolWebhookEvent.ORDER_UPDATED:
        return 'ORDER_UPDATED';
      default:
        return 'STATUS_CHANGED';
    }
  }

  private async handleOrderCreated(tenantId: string, payload: any) {
    this.trendyolProvider.setTenantContext(tenantId);

    const orderData = this.trendyolProvider.parseWebhookPayload(payload);

    if (!orderData) {
      throw new Error('Failed to parse order data');
    }

    await this.orderIntegrationService.processIncomingOrder(
      tenantId,
      PlatformType.TRENDYOL,
      orderData,
    );
  }

  private async handleOrderCancelled(tenantId: string, payload: any) {
    const { orderId, reason } = payload;

    await this.orderIntegrationService.handleOrderCancellation(
      tenantId,
      PlatformType.TRENDYOL,
      orderId,
      reason || 'Cancelled by platform',
    );
  }

  private async handleOrderUpdated(tenantId: string, payload: any) {
    const { orderId, status } = payload;

    if (status) {
      await this.orderIntegrationService.handleStatusUpdate(
        tenantId,
        PlatformType.TRENDYOL,
        orderId,
        status,
      );
    }
  }

  private async addToDeadLetterQueue(
    tenantId: string,
    payload: any,
    headers: Record<string, string>,
    error: Error,
  ) {
    await this.prisma.webhookDeadLetter.create({
      data: {
        tenantId,
        platformType: PlatformType.TRENDYOL,
        webhookType: payload.eventType || 'UNKNOWN',
        payload,
        headers,
        errorMessage: error.message,
        status: DeadLetterStatus.PENDING,
        nextRetryAt: new Date(Date.now() + 60000), // Retry in 1 minute
      },
    });
  }
}
