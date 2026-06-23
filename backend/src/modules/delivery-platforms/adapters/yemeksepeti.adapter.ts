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

const YEMEKSEPETI_PROD_BASE_URL = "https://middleware-api.yemeksepeti.com";
// Yemeksepeti (Delivery Hero) does expose a vendor/integration test
// environment, but its host is not publicly published. Until the real
// sandbox host is confirmed, default to the production host so sandbox
// configs do not silently hit an invalid URL — override via
// YEMEKSEPETI_SANDBOX_API_BASE_URL once the test host is known.
// TODO(delivery-sandbox): replace with the real Yemeksepeti sandbox host.
const YEMEKSEPETI_SANDBOX_BASE_URL = YEMEKSEPETI_PROD_BASE_URL;

@Injectable()
export class YemeksepetiAdapter extends BaseAdapter implements PlatformAdapter {
  constructor(private configService: ConfigService) {
    super(
      "YemeksepetiAdapter",
      YEMEKSEPETI_PROD_BASE_URL,
      configService,
      undefined,
      YEMEKSEPETI_SANDBOX_BASE_URL,
    );
    this.overrideBaseURL(
      this.configService.get<string>("YEMEKSEPETI_API_BASE_URL"),
    );
    this.overrideSandboxBaseURL(
      this.configService.get<string>("YEMEKSEPETI_SANDBOX_API_BASE_URL"),
    );
  }

  async authenticate(config: DeliveryPlatformConfig): Promise<AuthResult> {
    const credentials = config.credentials as any;
    const response = await this.request({
      method: "POST",
      baseURL: this.resolveBaseURL(config),
      url: "/v2/login",
      data: {
        grant_type: "client_credentials",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      },
    });

    const token = response.data.access_token;
    const expiresIn = response.data.expires_in || 3600;
    const expiresAt = new Date(Date.now() + (expiresIn - 300) * 1000); // Refresh 5 min early

    return { token, expiresAt };
  }

  async acceptOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: "POST",
      baseURL: this.resolveBaseURL(config),
      url: `/v2/order/status/${externalOrderId}`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: { status: "accepted" },
    });
  }

  async rejectOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    await this.request({
      method: "POST",
      baseURL: this.resolveBaseURL(config),
      url: `/v2/order/status/${externalOrderId}`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: {
        status: "rejected",
        reason: reason || "Restaurant rejected the order",
      },
    });
  }

  async markPreparing(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: "POST",
      baseURL: this.resolveBaseURL(config),
      url: `/v2/order/status/${externalOrderId}`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: { status: "preparing" },
    });
  }

  async markReady(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: "POST",
      baseURL: this.resolveBaseURL(config),
      url: `/v2/orders/${externalOrderId}/preparation-completed`,
      headers: this.getAuthHeaders(config.accessToken!),
    });
  }

  async markPickedUp(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: "POST",
      baseURL: this.resolveBaseURL(config),
      url: `/v2/order/status/${externalOrderId}`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: { status: "delivered" },
    });
  }

  async cancelOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    await this.request({
      method: "POST",
      baseURL: this.resolveBaseURL(config),
      url: `/v2/order/status/${externalOrderId}`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: { status: "cancelled", reason: reason || "Restaurant cancelled" },
    });
  }

  parseWebhookOrder(rawPayload: Record<string, any>): NormalizedOrder {
    const items = (rawPayload.products || rawPayload.items || []).map(
      (product: any) => ({
        externalItemId: product.productId || product.id,
        name: product.productName || product.name,
        quantity: product.count || product.quantity || 1,
        unitPrice: product.unitPrice || product.price || 0,
        notes: product.note || product.description,
        modifiers: (product.options || []).map((opt: any) => ({
          name: opt.name,
          price: opt.price || 0,
          quantity: opt.count || 1,
        })),
      }),
    );

    return {
      platform: DeliveryPlatform.YEMEKSEPETI,
      externalOrderId: rawPayload.id || rawPayload.orderToken,
      customerName: rawPayload.customerName || rawPayload.customer?.name,
      customerPhone: rawPayload.customerPhone || rawPayload.customer?.phone,
      customerAddress:
        rawPayload.deliveryAddress || rawPayload.customer?.address,
      notes: rawPayload.customerNote || rawPayload.note,
      items,
      totalAmount: rawPayload.totalPrice || rawPayload.totalAmount || 0,
      discount: rawPayload.discountAmount || rawPayload.discount || 0,
      finalAmount:
        rawPayload.paymentAmount ||
        rawPayload.finalAmount ||
        rawPayload.totalPrice ||
        0,
      rawPayload,
    };
  }

  async syncMenu(
    config: DeliveryPlatformConfig,
    items: MenuSyncItem[],
  ): Promise<void> {
    const credentials = config.credentials as any;
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/v2/chains/${credentials.chainCode}/catalog`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: { items },
    });
  }

  async updateItemAvailability(
    config: DeliveryPlatformConfig,
    externalItemId: string,
    available: boolean,
  ): Promise<void> {
    const credentials = config.credentials as any;
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/v2/chains/${credentials.chainCode}/vendors/${credentials.posVendorId}/catalog/items/availability`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: {
        items: [{ id: externalItemId, available }],
      },
    });
  }

  async openRestaurant(config: DeliveryPlatformConfig): Promise<void> {
    const credentials = config.credentials as any;
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/v2/vendors/${credentials.posVendorId}/status`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: { isOpen: true },
    });
  }

  async closeRestaurant(config: DeliveryPlatformConfig): Promise<void> {
    const credentials = config.credentials as any;
    await this.request({
      method: "PUT",
      baseURL: this.resolveBaseURL(config),
      url: `/v2/vendors/${credentials.posVendorId}/status`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: { isOpen: false },
    });
  }

  async testConnection(config: DeliveryPlatformConfig): Promise<boolean> {
    try {
      await this.authenticate(config);
      return true;
    } catch {
      return false;
    }
  }
}
