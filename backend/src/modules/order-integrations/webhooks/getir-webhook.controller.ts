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
import { GetirProvider } from '../services/providers/getir.provider';
import { PlatformType, GetirWebhookEvent } from '../constants';
import { DeadLetterStatus } from '../constants/platform-status.enum';

@Controller('webhooks/getir')
export class GetirWebhookController {
  private readonly logger = new Logger(GetirWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderIntegrationService: OrderIntegrationService,
    private readonly getirProvider: GetirProvider,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.log(`Received Getir webhook: ${payload.type}`);

    if (!this.getirProvider.verifyWebhook(payload, headers)) {
      throw new BadRequestException('Invalid signature');
    }

    const tenantId = headers['x-tenant-id'] || payload.restaurantId;

    if (!tenantId) {
      throw new BadRequestException('Missing tenant ID');
    }

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
          this.logger.warn(`Unknown event: ${payload.type}`);
      }

      return { success: true };
    } catch (error: any) {
      this.logger.error(`Webhook failed: ${error.message}`);

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

      return { success: true, queued: true };
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

    const platformOrder = await this.prisma.platformOrder.findFirst({
      where: {
        tenantId,
        platformType: PlatformType.GETIR,
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

  private async handleOrderStatusChanged(tenantId: string, payload: any) {
    const { orderId, status } = payload;

    await this.prisma.platformOrder.updateMany({
      where: {
        tenantId,
        platformType: PlatformType.GETIR,
        platformOrderId: orderId,
      },
      data: { platformStatus: status },
    });
  }
}
