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
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderIntegrationService } from '../services/order-integration.service';
import { TrendyolProvider } from '../services/providers/trendyol.provider';
import { PlatformType, TrendyolWebhookEvent } from '../constants';
import { DeadLetterStatus } from '../constants/platform-status.enum';

@Controller('webhooks/trendyol')
export class TrendyolWebhookController {
  private readonly logger = new Logger(TrendyolWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderIntegrationService: OrderIntegrationService,
    private readonly trendyolProvider: TrendyolProvider,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.log(`Received Trendyol webhook: ${payload.eventType}`);

    // Verify signature
    if (!this.trendyolProvider.verifyWebhook(payload, headers)) {
      this.logger.warn('Invalid webhook signature');
      throw new BadRequestException('Invalid signature');
    }

    // Extract tenant ID from headers or payload
    const tenantId = headers['x-tenant-id'] || payload.tenantId;

    if (!tenantId) {
      this.logger.error('No tenant ID in webhook');
      throw new BadRequestException('Missing tenant ID');
    }

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
          this.logger.warn(`Unknown event type: ${payload.eventType}`);
      }

      return { success: true };
    } catch (error: any) {
      this.logger.error(`Webhook processing failed: ${error.message}`, error.stack);

      // Add to dead letter queue for retry
      await this.addToDeadLetterQueue(tenantId, payload, headers, error);

      // Return success to prevent platform from retrying immediately
      // We'll handle retry ourselves via dead letter queue
      return { success: true, queued: true };
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

    const platformOrder = await this.prisma.platformOrder.findFirst({
      where: {
        tenantId,
        platformType: PlatformType.TRENDYOL,
        platformOrderId: orderId,
      },
    });

    if (platformOrder) {
      await this.prisma.platformOrder.update({
        where: { id: platformOrder.id },
        data: {
          internalStatus: 'CANCELLED',
          platformStatus: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });

      // If there's a linked internal order, cancel it too
      if (platformOrder.orderId) {
        await this.prisma.order.update({
          where: { id: platformOrder.orderId },
          data: { status: 'CANCELLED' },
        });
      }
    }
  }

  private async handleOrderUpdated(tenantId: string, payload: any) {
    const { orderId, status } = payload;

    await this.prisma.platformOrder.updateMany({
      where: {
        tenantId,
        platformType: PlatformType.TRENDYOL,
        platformOrderId: orderId,
      },
      data: {
        platformStatus: status,
      },
    });
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
