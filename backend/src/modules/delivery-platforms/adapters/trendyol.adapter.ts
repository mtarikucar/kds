import { Injectable } from '@nestjs/common';
import { DeliveryPlatformConfig } from '@prisma/client';
import { DeliveryPlatform } from '../constants/platform.enum';
import {
  AuthResult,
  MenuSyncItem,
  PlatformAdapter,
} from '../interfaces/platform-adapter.interface';
import { NormalizedOrder } from '../interfaces/platform-order.interface';
import { BaseAdapter } from './base.adapter';

@Injectable()
export class TrendyolAdapter extends BaseAdapter implements PlatformAdapter {
  constructor() {
    super('TrendyolAdapter', 'https://api.trendyol.com/yemek');
  }

  async authenticate(config: DeliveryPlatformConfig): Promise<AuthResult> {
    const credentials = config.credentials as any;

    if (credentials.apiVersion === 'v2') {
      // New webhook-based integration
      const response = await this.request({
        method: 'POST',
        url: '/integration/auth/token',
        data: {
          integratorId: credentials.integratorId,
          integratorSecret: credentials.integratorSecret,
        },
      });
      const token = response.data.token;
      const expiresAt = new Date(Date.now() + 50 * 60 * 1000);
      return { token, expiresAt };
    }

    // Deprecated: Basic Auth - token is the base64 encoded credentials
    const token = Buffer.from(
      `${credentials.username}:${credentials.password}`,
    ).toString('base64');
    // Basic auth doesn't expire, but we set a long TTL
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return { token, expiresAt };
  }

  async acceptOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/orders/${externalOrderId}/status`,
      headers: this.getTrendyolAuthHeaders(config),
      data: { status: 'ACCEPTED' },
    });
  }

  async rejectOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/orders/${externalOrderId}/status`,
      headers: this.getTrendyolAuthHeaders(config),
      data: { status: 'REJECTED', reason },
    });
  }

  async markPreparing(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/orders/${externalOrderId}/status`,
      headers: this.getTrendyolAuthHeaders(config),
      data: { status: 'PREPARING' },
    });
  }

  async markReady(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/orders/${externalOrderId}/status`,
      headers: this.getTrendyolAuthHeaders(config),
      data: { status: 'READY' },
    });
  }

  async markPickedUp(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/orders/${externalOrderId}/status`,
      headers: this.getTrendyolAuthHeaders(config),
      data: { status: 'PICKED_UP' },
    });
  }

  async cancelOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/orders/${externalOrderId}/status`,
      headers: this.getTrendyolAuthHeaders(config),
      data: { status: 'CANCELLED', reason },
    });
  }

  async pollNewOrders(
    config: DeliveryPlatformConfig,
  ): Promise<NormalizedOrder[]> {
    const response = await this.request({
      method: 'GET',
      url: `/restaurants/${config.remoteRestaurantId}/orders?status=NEW`,
      headers: this.getTrendyolAuthHeaders(config),
    });

    const orders = response.data?.orders || response.data || [];
    return orders.map((order: any) => this.normalizeOrder(order));
  }

  parseWebhookOrder(rawPayload: Record<string, any>): NormalizedOrder {
    return this.normalizeOrder(rawPayload);
  }

  async syncMenu(
    config: DeliveryPlatformConfig,
    items: MenuSyncItem[],
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/restaurants/${config.remoteRestaurantId}/menu`,
      headers: this.getTrendyolAuthHeaders(config),
      data: { products: items },
    });
  }

  async updateItemAvailability(
    config: DeliveryPlatformConfig,
    externalItemId: string,
    available: boolean,
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/restaurants/${config.remoteRestaurantId}/products/${externalItemId}/status`,
      headers: this.getTrendyolAuthHeaders(config),
      data: { isAvailable: available },
    });
  }

  async openRestaurant(config: DeliveryPlatformConfig): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/restaurants/${config.remoteRestaurantId}/status`,
      headers: this.getTrendyolAuthHeaders(config),
      data: { isOpen: true },
    });
  }

  async closeRestaurant(config: DeliveryPlatformConfig): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/restaurants/${config.remoteRestaurantId}/status`,
      headers: this.getTrendyolAuthHeaders(config),
      data: { isOpen: false },
    });
  }

  async testConnection(config: DeliveryPlatformConfig): Promise<boolean> {
    try {
      const credentials = config.credentials as any;
      if (credentials.apiVersion === 'v2') {
        await this.authenticate(config);
      } else {
        await this.request({
          method: 'GET',
          url: `/restaurants/${config.remoteRestaurantId}`,
          headers: this.getTrendyolAuthHeaders(config),
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  private getTrendyolAuthHeaders(
    config: DeliveryPlatformConfig,
  ): Record<string, string> {
    const credentials = config.credentials as any;
    if (credentials.apiVersion === 'v2') {
      return { Authorization: `Bearer ${config.accessToken}` };
    }
    return { Authorization: `Basic ${config.accessToken}` };
  }

  private normalizeOrder(raw: any): NormalizedOrder {
    const items = (raw.products || raw.items || []).map((product: any) => ({
      externalItemId: product.productId || product.id,
      name: product.name || product.productName,
      quantity: product.quantity || product.count || 1,
      unitPrice: product.unitPrice || product.price || 0,
      notes: product.note,
      modifiers: (product.options || product.extras || []).map((opt: any) => ({
        name: opt.name,
        price: opt.price || 0,
        quantity: opt.quantity || 1,
      })),
    }));

    return {
      platform: DeliveryPlatform.TRENDYOL,
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
