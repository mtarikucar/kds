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
import { FuudyProvider } from '../services/providers/fuudy.provider';
import { WebhookProducerService } from '../../kafka/producers/webhook-producer.service';
import { PlatformType, FuudyWebhookEvent } from '../constants';
import { DeadLetterStatus } from '../constants/platform-status.enum';

@Controller('webhooks/fuudy')
export class FuudyWebhookController {
  private readonly logger = new Logger(FuudyWebhookController.name);
  private readonly kafkaEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly orderIntegrationService: OrderIntegrationService,
    private readonly fuudyProvider: FuudyProvider,
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
    this.logger.log(`Received Fuudy webhook: ${payload.event}`, { correlationId });

    if (!this.fuudyProvider.verifyWebhook(payload, headers)) {
      this.logger.warn('Invalid webhook signature', { correlationId });
      throw new BadRequestException('Invalid signature');
    }

    const tenantId = headers['x-tenant-id'] || payload.restaurantId;

    if (!tenantId) {
      throw new BadRequestException('Missing tenant ID');
    }

    const platformOrderId = payload.orderId || payload.id;

    // If Kafka is enabled, produce to Kafka for async processing
    if (this.kafkaEnabled && this.webhookProducer.isEnabled()) {
      return this.handleWithKafka(tenantId, platformOrderId, payload, headers, correlationId);
    }

    // Fallback to synchronous processing
    return this.handleSynchronously(tenantId, payload, headers, correlationId);
  }

  private async handleWithKafka(
    tenantId: string,
    platformOrderId: string,
    payload: any,
    headers: Record<string, string>,
    correlationId: string,
  ) {
    try {
      const webhookType = this.mapEventType(payload.event);

      await this.webhookProducer.produce({
        tenantId,
        platformType: PlatformType.FUUDY,
        platformOrderId,
        webhookType,
        rawPayload: payload,
        headers,
        correlationId,
      });

      return {
        success: true,
        correlationId,
        message: 'Webhook received and queued for processing',
      };
    } catch (error: any) {
      this.logger.error(`Failed to queue webhook to Kafka: ${error.message}`, { correlationId });
      return this.handleSynchronously(tenantId, payload, headers, correlationId);
    }
  }

  private async handleSynchronously(
    tenantId: string,
    payload: any,
    headers: Record<string, string>,
    correlationId: string,
  ) {
    try {
      switch (payload.event) {
        case FuudyWebhookEvent.NEW_ORDER:
          await this.handleNewOrder(tenantId, payload);
          break;

        case FuudyWebhookEvent.ORDER_CANCELLED:
          await this.handleOrderCancelled(tenantId, payload);
          break;

        default:
          this.logger.warn(`Unknown event: ${payload.event}`, { correlationId });
      }

      return { success: true, correlationId };
    } catch (error: any) {
      this.logger.error(`Webhook failed: ${error.message}`, { correlationId });

      await this.prisma.webhookDeadLetter.create({
        data: {
          tenantId,
          platformType: PlatformType.FUUDY,
          webhookType: payload.event || 'UNKNOWN',
          payload,
          headers,
          errorMessage: error.message,
          status: DeadLetterStatus.PENDING,
          nextRetryAt: new Date(Date.now() + 60000),
        },
      });

      return { success: true, queued: true, correlationId };
    }
  }

  private mapEventType(event: string): 'ORDER_CREATED' | 'ORDER_CANCELLED' | 'ORDER_UPDATED' | 'STATUS_CHANGED' {
    switch (event) {
      case FuudyWebhookEvent.NEW_ORDER:
        return 'ORDER_CREATED';
      case FuudyWebhookEvent.ORDER_CANCELLED:
        return 'ORDER_CANCELLED';
      default:
        return 'STATUS_CHANGED';
    }
  }

  private async handleNewOrder(tenantId: string, payload: any) {
    this.fuudyProvider.setTenantContext(tenantId);

    const orderData = this.fuudyProvider.parseWebhookPayload(payload);

    if (!orderData) {
      throw new Error('Failed to parse order data');
    }

    await this.orderIntegrationService.processIncomingOrder(
      tenantId,
      PlatformType.FUUDY,
      orderData,
    );
  }

  private async handleOrderCancelled(tenantId: string, payload: any) {
    const { orderId, reason } = payload;

    await this.orderIntegrationService.handleOrderCancellation(
      tenantId,
      PlatformType.FUUDY,
      orderId,
      reason || 'Cancelled by platform',
    );
  }
}
