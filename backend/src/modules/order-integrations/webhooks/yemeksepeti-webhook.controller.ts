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
import { YemeksepetiProvider } from '../services/providers/yemeksepeti.provider';
import { PlatformType, YemeksepetiWebhookEvent } from '../constants';
import { DeadLetterStatus } from '../constants/platform-status.enum';

@Controller('webhooks/yemeksepeti')
export class YemeksepetiWebhookController {
  private readonly logger = new Logger(YemeksepetiWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderIntegrationService: OrderIntegrationService,
    private readonly yemeksepetiProvider: YemeksepetiProvider,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.log(`Received Yemeksepeti webhook: ${payload.event}`);

    if (!this.yemeksepetiProvider.verifyWebhook(payload, headers)) {
      throw new BadRequestException('Invalid signature');
    }

    const tenantId = headers['x-tenant-id'] || payload.vendorId;

    if (!tenantId) {
      throw new BadRequestException('Missing tenant ID');
    }

    try {
      switch (payload.event) {
        case YemeksepetiWebhookEvent.NEW_ORDER:
          await this.handleNewOrder(tenantId, payload);
          break;

        case YemeksepetiWebhookEvent.ORDER_CANCELLED:
          await this.handleOrderCancelled(tenantId, payload);
          break;

        case YemeksepetiWebhookEvent.ORDER_STATUS_UPDATED:
          await this.handleOrderStatusUpdated(tenantId, payload);
          break;

        default:
          this.logger.warn(`Unknown event: ${payload.event}`);
      }

      return { success: true };
    } catch (error: any) {
      this.logger.error(`Webhook failed: ${error.message}`);

      await this.prisma.webhookDeadLetter.create({
        data: {
          tenantId,
          platformType: PlatformType.YEMEKSEPETI,
          webhookType: payload.event || 'UNKNOWN',
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

  private async handleNewOrder(tenantId: string, payload: any) {
    this.yemeksepetiProvider.setTenantContext(tenantId);

    const orderData = this.yemeksepetiProvider.parseWebhookPayload(payload);

    if (!orderData) {
      throw new Error('Failed to parse order data');
    }

    await this.orderIntegrationService.processIncomingOrder(
      tenantId,
      PlatformType.YEMEKSEPETI,
      orderData,
    );
  }

  private async handleOrderCancelled(tenantId: string, payload: any) {
    const { orderId, reason } = payload;

    const platformOrder = await this.prisma.platformOrder.findFirst({
      where: {
        tenantId,
        platformType: PlatformType.YEMEKSEPETI,
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

  private async handleOrderStatusUpdated(tenantId: string, payload: any) {
    const { orderId, status } = payload;

    await this.prisma.platformOrder.updateMany({
      where: {
        tenantId,
        platformType: PlatformType.YEMEKSEPETI,
        platformOrderId: orderId,
      },
      data: { platformStatus: status },
    });
  }
}
