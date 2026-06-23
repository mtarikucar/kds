import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DeliveryPlatformConfig } from "@prisma/client";
import { DeliveryPlatform } from "../constants/platform.enum";
import {
  AuthResult,
  MenuSyncItem,
  PlatformAdapter,
} from "../interfaces/platform-adapter.interface";
import { NormalizedOrder } from "../interfaces/platform-order.interface";
import { BaseAdapter } from "./base.adapter";

const MIGROS_PROD_BASE_URL = "https://partner-api.migros.com.tr/yemek";
// Migros Yemek runs a partner test environment, but its host is not publicly
// documented. Until the real sandbox host is confirmed, default to the
// production host so sandbox configs do not silently hit an invalid URL —
// override via MIGROS_SANDBOX_API_BASE_URL once the test host is known.
// TODO(delivery-sandbox): replace with the real Migros Yemek sandbox host.
const MIGROS_SANDBOX_BASE_URL = MIGROS_PROD_BASE_URL;

@Injectable()
export class MigrosAdapter extends BaseAdapter implements PlatformAdapter {
  constructor(private configService: ConfigService) {
    super(
      "MigrosAdapter",
      MIGROS_PROD_BASE_URL,
      configService,
      undefined,
      MIGROS_SANDBOX_BASE_URL,
    );
    this.overrideBaseURL(this.configService.get<string>("MIGROS_API_BASE_URL"));
    this.overrideSandboxBaseURL(
      this.configService.get<string>("MIGROS_SANDBOX_API_BASE_URL"),
    );
  }

  async authenticate(config: DeliveryPlatformConfig): Promise<AuthResult> {
    // Migros uses API key per branch - no token refresh needed
    const credentials = config.credentials as any;
    return {
      token: credentials.apiKey,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Effectively never expires
    };
  }

  async acceptOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/orders/${externalOrderId}/status`,
      headers: this.getMigrosHeaders(config),
      data: { status: "ACCEPTED" },
    });
  }

  async rejectOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/orders/${externalOrderId}/status`,
      headers: this.getMigrosHeaders(config),
      data: { status: "REJECTED", reason },
    });
  }

  async markPreparing(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/orders/${externalOrderId}/status`,
      headers: this.getMigrosHeaders(config),
      data: { status: "PREPARING" },
    });
  }

  async markReady(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/orders/${externalOrderId}/status`,
      headers: this.getMigrosHeaders(config),
      data: { status: "READY" },
    });
  }

  async markPickedUp(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    // Migros has limited status updates - markReady is the last status we can set
    this.logger.log(
      `Order ${externalOrderId} picked up (Migros: no separate pickup endpoint)`,
    );
  }

  async cancelOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/orders/${externalOrderId}/status`,
      headers: this.getMigrosHeaders(config),
      data: { status: "CANCELLED", reason },
    });
  }

  async pollNewOrders(
    config: DeliveryPlatformConfig,
  ): Promise<NormalizedOrder[]> {
    const response = await this.request({
      method: "GET",
      baseURL: this.resolveBaseURL(config),
      url: `/restaurants/${config.remoteRestaurantId}/orders?status=NEW`,
      headers: this.getMigrosHeaders(config),
    });

    const orders = response.data?.orders || response.data || [];
    return orders.map((order: any) => this.normalizeOrder(order));
  }

  async syncMenu(
    config: DeliveryPlatformConfig,
    items: MenuSyncItem[],
  ): Promise<void> {
    // Migros Yemek pushes the catalog under the store's menu resource. The
    // store id is the remoteRestaurantId; payload mirrors the other Turkish
    // platforms ({ products: [...] }).
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/restaurants/${config.remoteRestaurantId}/menu`,
      headers: this.getMigrosHeaders(config),
      data: { products: items },
    });
  }

  async updateItemAvailability(
    config: DeliveryPlatformConfig,
    externalItemId: string,
    available: boolean,
  ): Promise<void> {
    // Mirrors the Family-B live adapter:
    //   PUT /yemek/restaurants/:storeId/products/:productId/status { isAvailable }
    // (the "/yemek" prefix is already in the base URL here).
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/restaurants/${config.remoteRestaurantId}/products/${externalItemId}/status`,
      headers: this.getMigrosHeaders(config),
      data: { isAvailable: available },
    });
  }

  async openRestaurant(config: DeliveryPlatformConfig): Promise<void> {
    // Mirrors the Family-B live adapter:
    //   PUT /yemek/restaurants/:storeId/status { isOpen }
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/restaurants/${config.remoteRestaurantId}/status`,
      headers: this.getMigrosHeaders(config),
      data: { isOpen: true },
    });
  }

  async closeRestaurant(config: DeliveryPlatformConfig): Promise<void> {
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/restaurants/${config.remoteRestaurantId}/status`,
      headers: this.getMigrosHeaders(config),
      data: { isOpen: false },
    });
  }

  async testConnection(config: DeliveryPlatformConfig): Promise<boolean> {
    try {
      await this.request({
        method: "GET",
        baseURL: this.resolveBaseURL(config),
        url: `/restaurants/${config.remoteRestaurantId}`,
        headers: this.getMigrosHeaders(config),
      });
      return true;
    } catch {
      return false;
    }
  }

  private getMigrosHeaders(
    config: DeliveryPlatformConfig,
  ): Record<string, string> {
    const credentials = config.credentials as any;
    return {
      "X-API-Key": credentials.apiKey,
      "X-Branch-Id": config.remoteRestaurantId || "",
    };
  }

  private normalizeOrder(raw: any): NormalizedOrder {
    const items = (raw.products || raw.items || []).map((product: any) => ({
      externalItemId: product.productId || product.id,
      name: product.name || product.productName,
      quantity: product.quantity || product.count || 1,
      unitPrice: product.unitPrice || product.price || 0,
      notes: product.note,
      modifiers: (product.extras || []).map((opt: any) => ({
        name: opt.name,
        price: opt.price || 0,
        quantity: opt.quantity || 1,
      })),
    }));

    return {
      platform: DeliveryPlatform.MIGROS,
      externalOrderId: raw.id || raw.orderId,
      customerName: raw.customerName || raw.customer?.name,
      customerPhone: raw.customerPhone || raw.customer?.phone,
      customerAddress: raw.deliveryAddress || raw.customer?.address,
      notes: raw.customerNote || raw.note,
      items,
      totalAmount: raw.totalPrice || raw.totalAmount || 0,
      discount: raw.discountAmount || raw.discount || 0,
      finalAmount: raw.payableAmount || raw.finalAmount || raw.totalPrice || 0,
      rawPayload: raw,
      createdAt: raw.createdDate ? new Date(raw.createdDate) : undefined,
    };
  }
}
