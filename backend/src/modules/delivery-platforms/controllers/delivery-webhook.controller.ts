import {
  Controller,
  Post,
  Put,
  Param,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
  HttpException,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import {
  WebhookAuthGuard,
  WebhookPlatform,
} from '../guards/webhook-auth.guard';
import { DeliveryConfigService } from '../services/delivery-config.service';
import { DeliveryOrderService } from '../services/delivery-order.service';
import { DeliveryLogService } from '../services/delivery-log.service';
import { AdapterFactory } from '../adapters/adapter-factory';
import {
  DeliveryPlatform,
  PlatformLogDirection,
  PlatformLogAction,
} from '../constants/platform.enum';

// Aggressive throttle on every webhook endpoint so a signature-spraying
// attacker cannot amplify HMAC CPU cost or DB log writes.
const WEBHOOK_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

@ApiTags('delivery-webhooks')
@Public()
@Throttle(WEBHOOK_THROTTLE)
@UseGuards(WebhookAuthGuard)
@Controller('webhooks/delivery')
export class DeliveryWebhookController {
  private readonly logger = new Logger(DeliveryWebhookController.name);

  constructor(
    private readonly configService: DeliveryConfigService,
    private readonly orderService: DeliveryOrderService,
    private readonly logService: DeliveryLogService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  @Post('yemeksepeti/order/:remoteId')
  @WebhookPlatform('YEMEKSEPETI')
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
      if (!adapter.parseWebhookOrder) {
        throw new BadRequestException('Adapter cannot parse webhook order');
      }
      const normalizedOrder = adapter.parseWebhookOrder(body);

      const order = await this.orderService.processIncomingOrder(
        config.tenantId,
        normalizedOrder,
      );

      if (!order) {
        return { status: 'ok', message: 'duplicate order ignored' };
      }

      return { status: 'ok' };
    } catch (error: any) {
      this.logger.error(`Failed to process Yemeksepeti webhook: ${error.message}`);
      // Best-effort — do NOT rethrow from the log path. Also scrub the
      // PII-heavy raw body before persisting.
      await this.logService
        .log({
          tenantId: config.tenantId,
          platform: DeliveryPlatform.YEMEKSEPETI,
          direction: PlatformLogDirection.INBOUND,
          action: PlatformLogAction.ORDER_RECEIVED,
          externalId: body?.id || body?.orderToken,
          request: this.logService.scrubPii(body),
          success: false,
          error: error.message,
          nextRetryAt: new Date(Date.now() + 60_000),
        })
        .catch(() => undefined);

      throw new HttpException(
        { status: 'error', message: 'Order processing failed' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Put('yemeksepeti/:remoteId/order/:remoteOrderId/status')
  @WebhookPlatform('YEMEKSEPETI')
  @HttpCode(HttpStatus.OK)
  async yemeksepetiStatusUpdate(
    @Param('remoteId') remoteId: string,
    @Param('remoteOrderId') remoteOrderId: string,
    @Body() body: any,
  ) {
    this.logger.log(
      `Yemeksepeti status update for order ${remoteOrderId}: ${JSON.stringify(body)}`,
    );
    return { status: 'ok' };
  }

  @Post('trendyol/order/:remoteId')
  @WebhookPlatform('TRENDYOL')
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
      if (!adapter.parseWebhookOrder) {
        throw new BadRequestException('Adapter cannot parse webhook order');
      }
      const normalizedOrder = adapter.parseWebhookOrder(body);

      const order = await this.orderService.processIncomingOrder(
        config.tenantId,
        normalizedOrder,
      );

      if (!order) {
        return { status: 'ok', message: 'duplicate order ignored' };
      }

      return { status: 'ok' };
    } catch (error: any) {
      this.logger.error(`Failed to process Trendyol webhook: ${error.message}`);
      await this.logService
        .log({
          tenantId: config.tenantId,
          platform: DeliveryPlatform.TRENDYOL,
          direction: PlatformLogDirection.INBOUND,
          action: PlatformLogAction.ORDER_RECEIVED,
          externalId: body?.id || body?.orderId,
          request: this.logService.scrubPii(body),
          success: false,
          error: error.message,
          nextRetryAt: new Date(Date.now() + 60_000),
        })
        .catch(() => undefined);

      throw new HttpException(
        { status: 'error', message: 'Order processing failed' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
