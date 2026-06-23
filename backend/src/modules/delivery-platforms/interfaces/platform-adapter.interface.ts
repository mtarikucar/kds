import { DeliveryPlatformConfig } from "@prisma/client";
import { NormalizedOrder } from "./platform-order.interface";

export interface AuthResult {
  token: string;
  expiresAt: Date;
}

export interface MenuSyncItem {
  externalItemId: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

export interface PlatformAdapter {
  /** Authenticate with the platform and obtain access token */
  authenticate(config: DeliveryPlatformConfig): Promise<AuthResult>;

  /** Accept an incoming order on the platform */
  acceptOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void>;

  /** Reject an incoming order on the platform */
  rejectOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void>;

  /** Mark order as being prepared */
  markPreparing(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void>;

  /** Mark order as ready for pickup */
  markReady(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void>;

  /** Mark order as picked up by courier */
  markPickedUp(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void>;

  /** Cancel an order on the platform */
  cancelOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void>;

  /**
   * Restaurant-INITIATED (outbound) refund of an order on the platform.
   *
   * OPTIONAL — on the four Turkish platforms we integrate (Getir,
   * Yemeksepeti, Trendyol, Migros) refunds are owned by the platform's own
   * customer-service / settlement flow, NOT the restaurant POS, so none of
   * those adapters implements this method. The common case is the INBOUND
   * direction: the platform initiates the refund and notifies us — handled by
   * DeliveryOrderService.applyPlatformRefund, which never calls back out.
   *
   * An adapter should implement this ONLY if its platform genuinely exposes a
   * restaurant-initiated refund endpoint. DeliveryOrderService.refundOrderOnPlatform
   * dispatches here only when implemented and otherwise throws an honest
   * "unsupported" error rather than faking an outbound call.
   *
   * @param amount Partial refund amount in major units; omit for a full refund.
   */
  refundOrder?(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    amount?: number,
  ): Promise<void>;

  /** Poll platform for new orders (Getir, Migros, Trendyol) */
  pollNewOrders?(config: DeliveryPlatformConfig): Promise<NormalizedOrder[]>;

  /** Parse a webhook payload into normalized order (Yemeksepeti, Trendyol) */
  parseWebhookOrder?(rawPayload: Record<string, any>): NormalizedOrder;

  /** Push menu items to platform */
  syncMenu?(
    config: DeliveryPlatformConfig,
    items: MenuSyncItem[],
  ): Promise<void>;

  /** Update single item availability on platform */
  updateItemAvailability?(
    config: DeliveryPlatformConfig,
    externalItemId: string,
    available: boolean,
  ): Promise<void>;

  /** Open restaurant on platform */
  openRestaurant?(config: DeliveryPlatformConfig): Promise<void>;

  /** Close restaurant on platform */
  closeRestaurant?(config: DeliveryPlatformConfig): Promise<void>;

  /** Test connection/credentials with platform */
  testConnection(config: DeliveryPlatformConfig): Promise<boolean>;
}
