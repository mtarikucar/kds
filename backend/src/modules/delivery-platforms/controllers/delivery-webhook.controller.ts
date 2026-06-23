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
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../../auth/decorators/public.decorator";
import {
  WebhookAuthGuard,
  WebhookPlatform,
} from "../guards/webhook-auth.guard";
import { DeliveryConfigService } from "../services/delivery-config.service";
import { DeliveryOrderService } from "../services/delivery-order.service";
import { DeliveryLogService } from "../services/delivery-log.service";
import { AdapterFactory } from "../adapters/adapter-factory";
import {
  DeliveryPlatform,
  PlatformLogDirection,
  PlatformLogAction,
} from "../constants/platform.enum";

// Aggressive throttle on every webhook endpoint so a signature-spraying
// attacker cannot amplify HMAC CPU cost or DB log writes.
const WEBHOOK_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

@ApiTags("delivery-webhooks")
@Public()
@Throttle(WEBHOOK_THROTTLE)
@UseGuards(WebhookAuthGuard)
@Controller("webhooks/delivery")
export class DeliveryWebhookController {
  private readonly logger = new Logger(DeliveryWebhookController.name);

  constructor(
    private readonly configService: DeliveryConfigService,
    private readonly orderService: DeliveryOrderService,
    private readonly logService: DeliveryLogService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  @Post("yemeksepeti/order/:remoteId")
  @WebhookPlatform("YEMEKSEPETI")
  @HttpCode(HttpStatus.OK)
  async yemeksepetiNewOrder(
    @Param("remoteId") remoteId: string,
    @Body() body: any,
  ) {
    this.logger.log(
      `Yemeksepeti order webhook received for restaurant ${remoteId}`,
    );

    const config = await this.configService.findByRemoteRestaurantId(
      DeliveryPlatform.YEMEKSEPETI,
      remoteId,
    );

    if (!config) {
      this.logger.warn(
        `No config found for Yemeksepeti restaurant ${remoteId}`,
      );
      return { status: "ignored", reason: "restaurant not configured" };
    }

    try {
      const adapter = this.adapterFactory.getAdapter(
        DeliveryPlatform.YEMEKSEPETI,
      );
      if (!adapter.parseWebhookOrder) {
        throw new BadRequestException("Adapter cannot parse webhook order");
      }
      const normalizedOrder = adapter.parseWebhookOrder(body);

      const order = await this.orderService.processIncomingOrder(
        config.tenantId,
        normalizedOrder,
      );

      if (!order) {
        return { status: "ok", message: "duplicate order ignored" };
      }

      return { status: "ok" };
    } catch (error: any) {
      this.logger.error(
        `Failed to process Yemeksepeti webhook: ${error.message}`,
      );
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
        { status: "error", message: "Order processing failed" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Put("yemeksepeti/:remoteId/order/:remoteOrderId/status")
  @WebhookPlatform("YEMEKSEPETI")
  @HttpCode(HttpStatus.OK)
  async yemeksepetiStatusUpdate(
    @Param("remoteId") remoteId: string,
    @Param("remoteOrderId") remoteOrderId: string,
    @Body() body: any,
  ) {
    // Resolve tenant first — Yemeksepeti's path doesn't carry the tenant
    // directly; we look it up by the chain-id (`remoteId`).
    const config = await this.configService.findByRemoteRestaurantId(
      DeliveryPlatform.YEMEKSEPETI,
      remoteId,
    );
    if (!config) {
      this.logger.warn(`No config found for Yemeksepeti chain ${remoteId}`);
      return { status: "ignored", reason: "restaurant not configured" };
    }

    const platformStatus = body?.status ?? body?.event ?? body?.state;
    const result = await this.orderService.applyPlatformStatusUpdate({
      platform: DeliveryPlatform.YEMEKSEPETI,
      remoteOrderId,
      tenantId: config.tenantId,
      platformStatus,
    });

    this.logger.log(
      `Yemeksepeti status '${platformStatus}' for ${remoteOrderId} -> ${
        result.mappedTo ?? "unmapped"
      }${result.matched ? "" : " (no-op)"}`,
    );
    return { status: "ok", matched: result.matched, mappedTo: result.mappedTo };
  }

  /**
   * Yemeksepeti refund notification (INBOUND). Yemeksepeti (Delivery Hero)
   * folds some cancellations into its status webhook, but a refund event
   * carries the refunded amount, so it gets a dedicated route. The platform
   * already moved the money — applyPlatformRefund only reflects it on our
   * Order (full → cancelled-with-refund; partial → recorded on the order's
   * note + externalData ledger) and NEVER pushes anything back.
   */
  @Post("yemeksepeti/:remoteId/order/:remoteOrderId/refund")
  @WebhookPlatform("YEMEKSEPETI")
  @HttpCode(HttpStatus.OK)
  async yemeksepetiRefund(
    @Param("remoteId") remoteId: string,
    @Param("remoteOrderId") remoteOrderId: string,
    @Body() body: any,
  ) {
    return this.handleRefund(
      DeliveryPlatform.YEMEKSEPETI,
      remoteId,
      remoteOrderId,
      body,
    );
  }

  /**
   * Yemeksepeti order amendment (INBOUND) — the platform changed an existing
   * order's items before the kitchen committed it. The body is a full amended
   * order payload, parsed by the same adapter parser as new orders, then
   * routed to applyPlatformAmendment (re-resolves items + recomputes totals +
   * re-emits to KDS, refused once the order is committed/served).
   */
  @Put("yemeksepeti/:remoteId/order/:remoteOrderId/amend")
  @WebhookPlatform("YEMEKSEPETI")
  @HttpCode(HttpStatus.OK)
  async yemeksepetiAmend(
    @Param("remoteId") remoteId: string,
    @Param("remoteOrderId") remoteOrderId: string,
    @Body() body: any,
  ) {
    return this.handleAmendment(
      DeliveryPlatform.YEMEKSEPETI,
      remoteId,
      remoteOrderId,
      body,
    );
  }

  @Post("trendyol/order/:remoteId")
  @WebhookPlatform("TRENDYOL")
  @HttpCode(HttpStatus.OK)
  async trendyolNewOrder(
    @Param("remoteId") remoteId: string,
    @Body() body: any,
  ) {
    this.logger.log(
      `Trendyol order webhook received for restaurant ${remoteId}`,
    );

    const config = await this.configService.findByRemoteRestaurantId(
      DeliveryPlatform.TRENDYOL,
      remoteId,
    );

    if (!config) {
      this.logger.warn(`No config found for Trendyol restaurant ${remoteId}`);
      return { status: "ignored", reason: "restaurant not configured" };
    }

    try {
      const adapter = this.adapterFactory.getAdapter(DeliveryPlatform.TRENDYOL);
      if (!adapter.parseWebhookOrder) {
        throw new BadRequestException("Adapter cannot parse webhook order");
      }
      const normalizedOrder = adapter.parseWebhookOrder(body);

      const order = await this.orderService.processIncomingOrder(
        config.tenantId,
        normalizedOrder,
      );

      if (!order) {
        return { status: "ok", message: "duplicate order ignored" };
      }

      return { status: "ok" };
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
        { status: "error", message: "Order processing failed" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Trendyol order status / cancellation webhook. Mirrors the Yemeksepeti
   * status route: resolve the tenant by the restaurant id, then hand the
   * platform-supplied status to applyPlatformStatusUpdate, which maps a
   * cancellation onto the internal Order idempotently.
   *
   * IMPORTANT: this is the INBOUND direction — the platform already knows the
   * order is cancelled (it told us). applyPlatformStatusUpdate only mutates the
   * internal Order + notifies the KDS; it deliberately does NOT push any status
   * back to the platform, so a platform-originated CANCELLED never echoes a
   * redundant (and potentially error-raising) outbound call.
   */
  @Put("trendyol/:remoteId/order/:remoteOrderId/status")
  @WebhookPlatform("TRENDYOL")
  @HttpCode(HttpStatus.OK)
  async trendyolStatusUpdate(
    @Param("remoteId") remoteId: string,
    @Param("remoteOrderId") remoteOrderId: string,
    @Body() body: any,
  ) {
    const config = await this.configService.findByRemoteRestaurantId(
      DeliveryPlatform.TRENDYOL,
      remoteId,
    );
    if (!config) {
      this.logger.warn(`No config found for Trendyol restaurant ${remoteId}`);
      return { status: "ignored", reason: "restaurant not configured" };
    }

    const platformStatus = body?.status ?? body?.event ?? body?.state;
    const result = await this.orderService.applyPlatformStatusUpdate({
      platform: DeliveryPlatform.TRENDYOL,
      remoteOrderId,
      tenantId: config.tenantId,
      platformStatus,
    });

    this.logger.log(
      `Trendyol status '${platformStatus}' for ${remoteOrderId} -> ${
        result.mappedTo ?? "unmapped"
      }${result.matched ? "" : " (no-op)"}`,
    );
    return { status: "ok", matched: result.matched, mappedTo: result.mappedTo };
  }

  /**
   * Trendyol refund notification (INBOUND). Same contract as the Yemeksepeti
   * refund route — the platform initiated the refund; we only reflect it on
   * our Order and never push back.
   */
  @Post("trendyol/:remoteId/order/:remoteOrderId/refund")
  @WebhookPlatform("TRENDYOL")
  @HttpCode(HttpStatus.OK)
  async trendyolRefund(
    @Param("remoteId") remoteId: string,
    @Param("remoteOrderId") remoteOrderId: string,
    @Body() body: any,
  ) {
    return this.handleRefund(
      DeliveryPlatform.TRENDYOL,
      remoteId,
      remoteOrderId,
      body,
    );
  }

  /**
   * Trendyol order amendment (INBOUND) — full amended cart in the body, routed
   * to applyPlatformAmendment.
   */
  @Put("trendyol/:remoteId/order/:remoteOrderId/amend")
  @WebhookPlatform("TRENDYOL")
  @HttpCode(HttpStatus.OK)
  async trendyolAmend(
    @Param("remoteId") remoteId: string,
    @Param("remoteOrderId") remoteOrderId: string,
    @Body() body: any,
  ) {
    return this.handleAmendment(
      DeliveryPlatform.TRENDYOL,
      remoteId,
      remoteOrderId,
      body,
    );
  }

  // ── Shared inbound refund/amendment handlers ──────────────────────────────
  //
  // Only the two webhook-driven platforms the WebhookAuthGuard verifies
  // (YEMEKSEPETI, TRENDYOL) expose these routes. Getir + Migros are polling
  // platforms with no inbound webhook auth path, so their refunds/amendments
  // are out of scope here (they'd surface via polling, not this controller).

  /**
   * Reflect an inbound, platform-initiated refund. Resolves the tenant by the
   * restaurant id, extracts the (optional) refunded amount / reason / refundId
   * from the body, and hands it to applyPlatformRefund. INBOUND only — never
   * pushes a refund back to the platform (it initiated).
   */
  private async handleRefund(
    platform: DeliveryPlatform,
    remoteId: string,
    remoteOrderId: string,
    body: any,
  ) {
    const config = await this.configService.findByRemoteRestaurantId(
      platform,
      remoteId,
    );
    if (!config) {
      this.logger.warn(
        `No config found for ${platform} restaurant ${remoteId}`,
      );
      return { status: "ignored", reason: "restaurant not configured" };
    }

    // Tolerate the common field shapes; a missing/zero amount ⇒ full refund.
    const rawAmount =
      body?.refundAmount ??
      body?.amount ??
      body?.refundedAmount ??
      body?.totalRefund ??
      null;
    const refundAmount =
      rawAmount == null || rawAmount === "" ? null : Number(rawAmount);
    const refundId =
      body?.refundId ?? body?.id ?? body?.refundReferenceId ?? null;
    const reason = body?.reason ?? body?.refundReason ?? null;

    const result = await this.orderService.applyPlatformRefund({
      platform,
      remoteOrderId,
      tenantId: config.tenantId,
      refundAmount,
      reason,
      refundId,
    });

    this.logger.log(
      `${platform} refund for ${remoteOrderId} -> ${
        result.type ?? "n/a"
      } applied=${result.applied}${result.duplicate ? " (duplicate)" : ""}`,
    );
    return {
      status: "ok",
      matched: result.matched,
      applied: result.applied,
      type: result.type,
      duplicate: result.duplicate ?? false,
    };
  }

  /**
   * Reflect an inbound order amendment. The body is a full amended order
   * payload; we parse it with the same adapter parser as new orders so item
   * mapping + modifier shape stay identical, then route to
   * applyPlatformAmendment. The `:remoteOrderId` path param is informational
   * — the externalOrderId in the parsed payload is authoritative.
   */
  private async handleAmendment(
    platform: DeliveryPlatform,
    remoteId: string,
    remoteOrderId: string,
    body: any,
  ) {
    const config = await this.configService.findByRemoteRestaurantId(
      platform,
      remoteId,
    );
    if (!config) {
      this.logger.warn(
        `No config found for ${platform} restaurant ${remoteId}`,
      );
      return { status: "ignored", reason: "restaurant not configured" };
    }

    try {
      const adapter = this.adapterFactory.getAdapter(platform);
      if (!adapter.parseWebhookOrder) {
        throw new BadRequestException("Adapter cannot parse webhook order");
      }
      const normalizedOrder = adapter.parseWebhookOrder(body);

      const result = await this.orderService.applyPlatformAmendment(
        config.tenantId,
        normalizedOrder,
      );

      this.logger.log(
        `${platform} amendment for ${remoteOrderId} -> matched=${result.matched} applied=${result.applied}${
          result.refused ? ` refused: ${result.reason}` : ""
        }${result.duplicate ? " (duplicate)" : ""}`,
      );
      return {
        status: "ok",
        matched: result.matched,
        applied: result.applied,
        refused: result.refused ?? false,
        duplicate: result.duplicate ?? false,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to process ${platform} amendment webhook: ${error.message}`,
      );
      await this.logService
        .log({
          tenantId: config.tenantId,
          platform,
          direction: PlatformLogDirection.INBOUND,
          action: PlatformLogAction.ORDER_AMENDED,
          externalId: remoteOrderId,
          request: this.logService.scrubPii(body),
          success: false,
          error: error.message,
          nextRetryAt: new Date(Date.now() + 60_000),
        })
        .catch(() => undefined);

      throw new HttpException(
        { status: "error", message: "Amendment processing failed" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
