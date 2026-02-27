import {
  Controller,
  Post,
  Put,
  Param,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhookAuthGuard } from '../guards/webhook-auth.guard';
import { DeliveryConfigService } from '../services/delivery-config.service';
import { DeliveryOrderService } from '../services/delivery-order.service';
import { DeliveryLogService } from '../services/delivery-log.service';
import { AdapterFactory } from '../adapters/adapter-factory';
import { DeliveryPlatform, PlatformLogDirection, PlatformLogAction } from '../constants/platform.enum';

@ApiTags('delivery-webhooks')
@Controller('webhooks/delivery')
export class DeliveryWebhookController {
  private readonly logger = new Logger(DeliveryWebhookController.name);

  constructor(
    private readonly configService: DeliveryConfigService,
    private readonly orderService: DeliveryOrderService,
    private readonly logService: DeliveryLogService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  /**
   * Yemeksepeti: Receive new order webhook
   * POST /webhooks/delivery/yemeksepeti/order/:remoteId
   */
  @Post('yemeksepeti/order/:remoteId')
  @UseGuards(WebhookAuthGuard)
  @HttpCode(HttpStatus.OK)
  async yemeksepetiNewOrder(
    @Param('remoteId') remoteId: string,
    @Body() body: any,
  ) {
    this.logger.log(`Yemeksepeti order webhook received for restaurant ${remoteId}`);

    const config = await this.configService.findByRemoteRestaurantId(
      DeliveryPlatform.YEMEKSEPETI,
      remoteId,
    );

    if (!config) {
      this.logger.warn(`No config found for Yemeksepeti restaurant ${remoteId}`);
      return { status: 'ignored', reason: 'restaurant not configured' };
    }

    try {
      const adapter = this.adapterFactory.getAdapter(DeliveryPlatform.YEMEKSEPETI);
      const normalizedOrder = adapter.parseWebhookOrder!(body);

      const order = await this.orderService.processIncomingOrder(
        config.tenantId,
        normalizedOrder,
      );

      return { status: 'ok', orderId: order.id };
    } catch (error: any) {
      this.logger.error(
        `Failed to process Yemeksepeti webhook: ${error.message}`,
      );

      await this.logService.log({
        tenantId: config.tenantId,
        platform: DeliveryPlatform.YEMEKSEPETI,
        direction: PlatformLogDirection.INBOUND,
        action: PlatformLogAction.ORDER_RECEIVED,
        externalId: body?.id || body?.orderToken,
        request: body,
        success: false,
        error: error.message,
        nextRetryAt: new Date(Date.now() + 60_000),
      });

      return { status: 'error', message: error.message };
    }
  }

  /**
   * Yemeksepeti: Receive status update webhook
   * PUT /webhooks/delivery/yemeksepeti/:remoteId/order/:remoteOrderId/status
   */
  @Put('yemeksepeti/:remoteId/order/:remoteOrderId/status')
  @UseGuards(WebhookAuthGuard)
  @HttpCode(HttpStatus.OK)
  async yemeksepetiStatusUpdate(
    @Param('remoteId') remoteId: string,
    @Param('remoteOrderId') remoteOrderId: string,
    @Body() body: any,
  ) {
    this.logger.log(
      `Yemeksepeti status update for order ${remoteOrderId}: ${JSON.stringify(body)}`,
    );
    // Status updates from Yemeksepeti are informational (e.g., courier picked up)
    // We log them but don't change KDS order status
    return { status: 'ok' };
  }

  /**
   * Trendyol: Receive new order webhook (v2 integrations)
   * POST /webhooks/delivery/trendyol/order/:remoteId
   */
  @Post('trendyol/order/:remoteId')
  @UseGuards(WebhookAuthGuard)
  @HttpCode(HttpStatus.OK)
  async trendyolNewOrder(
    @Param('remoteId') remoteId: string,
    @Body() body: any,
  ) {
    this.logger.log(`Trendyol order webhook received for restaurant ${remoteId}`);

    const config = await this.configService.findByRemoteRestaurantId(
      DeliveryPlatform.TRENDYOL,
      remoteId,
    );

    if (!config) {
      this.logger.warn(`No config found for Trendyol restaurant ${remoteId}`);
      return { status: 'ignored', reason: 'restaurant not configured' };
    }

    try {
      const adapter = this.adapterFactory.getAdapter(DeliveryPlatform.TRENDYOL);
      const normalizedOrder = adapter.parseWebhookOrder!(body);

      const order = await this.orderService.processIncomingOrder(
        config.tenantId,
        normalizedOrder,
      );

      return { status: 'ok', orderId: order.id };
    } catch (error: any) {
      this.logger.error(
        `Failed to process Trendyol webhook: ${error.message}`,
      );

      await this.logService.log({
        tenantId: config.tenantId,
        platform: DeliveryPlatform.TRENDYOL,
        direction: PlatformLogDirection.INBOUND,
        action: PlatformLogAction.ORDER_RECEIVED,
        externalId: body?.id || body?.orderId,
        request: body,
        success: false,
        error: error.message,
        nextRetryAt: new Date(Date.now() + 60_000),
      });

      return { status: 'error', message: error.message };
    }
  }
}
