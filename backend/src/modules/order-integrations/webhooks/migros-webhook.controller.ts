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
import { MigrosProvider } from '../services/providers/migros.provider';
import { PlatformType, MigrosWebhookEvent } from '../constants';
import { DeadLetterStatus } from '../constants/platform-status.enum';

@Controller('webhooks/migros')
export class MigrosWebhookController {
  private readonly logger = new Logger(MigrosWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderIntegrationService: OrderIntegrationService,
    private readonly migrosProvider: MigrosProvider,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.log(`Received Migros webhook: ${payload.eventType}`);

    if (!this.migrosProvider.verifyWebhook(payload, headers)) {
      throw new BadRequestException('Invalid signature');
    }

    const tenantId = headers['x-tenant-id'] || payload.storeCode;

    if (!tenantId) {
      throw new BadRequestException('Missing tenant ID');
    }

    try {
      switch (payload.eventType) {
        case MigrosWebhookEvent.ORDER_CREATED:
          await this.handleOrderCreated(tenantId, payload);
          break;

        case MigrosWebhookEvent.ORDER_CANCELLED:
          await this.handleOrderCancelled(tenantId, payload);
          break;

        default:
          this.logger.warn(`Unknown event: ${payload.eventType}`);
      }

      return { success: true };
    } catch (error: any) {
      this.logger.error(`Webhook failed: ${error.message}`);

      await this.prisma.webhookDeadLetter.create({
        data: {
          tenantId,
          platformType: PlatformType.MIGROS,
          webhookType: payload.eventType || 'UNKNOWN',
          payload,
          headers,
          errorMessage: error.message,
          status: DeadLetterStatus.PENDING,
          nextRetryAt: new Date(Date.now() + 60000),
        },
      });

      return { success: true, queued: true };
    }
  }

  private async handleOrderCreated(tenantId: string, payload: any) {
    this.migrosProvider.setTenantContext(tenantId);

    const orderData = this.migrosProvider.parseWebhookPayload(payload);

    if (!orderData) {
      throw new Error('Failed to parse order data');
    }

    await this.orderIntegrationService.processIncomingOrder(
      tenantId,
      PlatformType.MIGROS,
      orderData,
    );
  }

  private async handleOrderCancelled(tenantId: string, payload: any) {
    const { orderId, reason } = payload;

    const platformOrder = await this.prisma.platformOrder.findFirst({
      where: {
        tenantId,
        platformType: PlatformType.MIGROS,
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

      if (platformOrder.orderId) {
        await this.prisma.order.update({
          where: { id: platformOrder.orderId },
          data: { status: 'CANCELLED' },
        });
      }
    }
  }
}
