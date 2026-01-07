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
import { GetirProvider } from '../services/providers/getir.provider';
import { WebhookProducerService } from '../../kafka/producers/webhook-producer.service';
import { PlatformType, GetirWebhookEvent } from '../constants';
import { DeadLetterStatus } from '../constants/platform-status.enum';

@Controller('webhooks/getir')
export class GetirWebhookController {
  private readonly logger = new Logger(GetirWebhookController.name);
  private readonly kafkaEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly orderIntegrationService: OrderIntegrationService,
    private readonly getirProvider: GetirProvider,
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
    this.logger.log(`Received Getir webhook: ${payload.type}`, { correlationId });

    if (!this.getirProvider.verifyWebhook(payload, headers)) {
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
      const webhookType = this.mapEventType(payload.type);

      await this.webhookProducer.produce({
        tenantId,
        platformType: PlatformType.GETIR,
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
      switch (payload.type) {
        case GetirWebhookEvent.ORDER_RECEIVED:
          await this.handleOrderReceived(tenantId, payload);
          break;

        case GetirWebhookEvent.ORDER_CANCELLED:
          await this.handleOrderCancelled(tenantId, payload);
          break;

        case GetirWebhookEvent.ORDER_STATUS_CHANGED:
          await this.handleOrderStatusChanged(tenantId, payload);
          break;

        default:
          this.logger.warn(`Unknown event: ${payload.type}`, { correlationId });
      }

      return { success: true, correlationId };
    } catch (error: any) {
      this.logger.error(`Webhook failed: ${error.message}`, { correlationId });

      await this.prisma.webhookDeadLetter.create({
        data: {
          tenantId,
          platformType: PlatformType.GETIR,
          webhookType: payload.type || 'UNKNOWN',
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

  private mapEventType(type: string): 'ORDER_CREATED' | 'ORDER_CANCELLED' | 'ORDER_UPDATED' | 'STATUS_CHANGED' {
    switch (type) {
      case GetirWebhookEvent.ORDER_RECEIVED:
        return 'ORDER_CREATED';
      case GetirWebhookEvent.ORDER_CANCELLED:
        return 'ORDER_CANCELLED';
      case GetirWebhookEvent.ORDER_STATUS_CHANGED:
        return 'STATUS_CHANGED';
      default:
        return 'STATUS_CHANGED';
    }
  }

  private async handleOrderReceived(tenantId: string, payload: any) {
    this.getirProvider.setTenantContext(tenantId);

    const orderData = this.getirProvider.parseWebhookPayload(payload);

    if (!orderData) {
      throw new Error('Failed to parse order data');
    }

    // Getir has strict SLA - order must be accepted within 2 minutes
    await this.orderIntegrationService.processIncomingOrder(
      tenantId,
      PlatformType.GETIR,
      orderData,
    );
  }

  private async handleOrderCancelled(tenantId: string, payload: any) {
    const { orderId, reason } = payload;

    await this.orderIntegrationService.handleOrderCancellation(
      tenantId,
      PlatformType.GETIR,
      orderId,
      reason || 'Cancelled by platform',
    );
  }

  private async handleOrderStatusChanged(tenantId: string, payload: any) {
    const { orderId, status } = payload;

    if (status) {
      await this.orderIntegrationService.handleStatusUpdate(
        tenantId,
        PlatformType.GETIR,
        orderId,
        status,
      );
    }
  }
}
