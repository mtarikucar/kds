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
import { FuudyProvider } from '../services/providers/fuudy.provider';
import { PlatformType, FuudyWebhookEvent } from '../constants';
import { DeadLetterStatus } from '../constants/platform-status.enum';

@Controller('webhooks/fuudy')
export class FuudyWebhookController {
  private readonly logger = new Logger(FuudyWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderIntegrationService: OrderIntegrationService,
    private readonly fuudyProvider: FuudyProvider,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.log(`Received Fuudy webhook: ${payload.event}`);

    if (!this.fuudyProvider.verifyWebhook(payload, headers)) {
      throw new BadRequestException('Invalid signature');
    }

    const tenantId = headers['x-tenant-id'] || payload.restaurantId;

    if (!tenantId) {
      throw new BadRequestException('Missing tenant ID');
    }

    try {
      switch (payload.event) {
        case FuudyWebhookEvent.NEW_ORDER:
          await this.handleNewOrder(tenantId, payload);
          break;

        case FuudyWebhookEvent.ORDER_CANCELLED:
          await this.handleOrderCancelled(tenantId, payload);
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
          platformType: PlatformType.FUUDY,
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

    const platformOrder = await this.prisma.platformOrder.findFirst({
      where: {
        tenantId,
        platformType: PlatformType.FUUDY,
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
