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
export class GetirAdapter extends BaseAdapter implements PlatformAdapter {
  constructor() {
    super('GetirAdapter', 'https://food-external-api.getir.com');
  }

  async authenticate(config: DeliveryPlatformConfig): Promise<AuthResult> {
    const credentials = config.credentials as any;
    const response = await this.request({
      method: 'POST',
      url: '/auth/login',
      data: {
        appSecretKey: credentials.appSecretKey,
        restaurantSecretKey: credentials.restaurantSecretKey,
      },
    });

    const token = response.data.token;
    // Getir tokens expire in 1 hour
    const expiresAt = new Date(Date.now() + 55 * 60 * 1000); // 55 min to refresh early

    return { token, expiresAt };
  }

  async acceptOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: 'POST',
      url: `/food-orders/${externalOrderId}/verify`,
      headers: this.getAuthHeaders(config.accessToken!),
    });
  }

  async rejectOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    await this.request({
      method: 'POST',
      url: `/food-orders/${externalOrderId}/cancel`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: { rejectReason: reason || 'Restaurant rejected the order' },
    });
  }

  async markPreparing(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: 'POST',
      url: `/food-orders/${externalOrderId}/prepare`,
      headers: this.getAuthHeaders(config.accessToken!),
    });
  }

  async markReady(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    await this.request({
      method: 'POST',
      url: `/food-orders/${externalOrderId}/handover`,
      headers: this.getAuthHeaders(config.accessToken!),
    });
  }

  async markPickedUp(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    // Getir handles pickup via courier - handover is the final status we send
    this.logger.log(`Order ${externalOrderId} picked up (no separate Getir API call needed)`);
  }

  async cancelOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    await this.request({
      method: 'POST',
      url: `/food-orders/${externalOrderId}/cancel`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: { cancelReason: reason || 'Restaurant cancelled the order' },
    });
  }

  async pollNewOrders(
    config: DeliveryPlatformConfig,
  ): Promise<NormalizedOrder[]> {
    const response = await this.request({
      method: 'POST',
      url: '/food-orders/periodic/unapproved',
      headers: this.getAuthHeaders(config.accessToken!),
    });

    const orders = response.data || [];
    return orders.map((order: any) => this.normalizeOrder(order));
  }

  async updateItemAvailability(
    config: DeliveryPlatformConfig,
    externalItemId: string,
    available: boolean,
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/food-products/${externalItemId}/status`,
      headers: this.getAuthHeaders(config.accessToken!),
      data: { isActive: available },
    });
  }

  async openRestaurant(config: DeliveryPlatformConfig): Promise<void> {
    await this.request({
      method: 'PUT',
      url: '/restaurants/status',
      headers: this.getAuthHeaders(config.accessToken!),
      data: { isOpen: true },
    });
  }

  async closeRestaurant(config: DeliveryPlatformConfig): Promise<void> {
    await this.request({
      method: 'PUT',
      url: '/restaurants/status',
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

  private normalizeOrder(raw: any): NormalizedOrder {
    const items = (raw.products || []).map((product: any) => ({
      externalItemId: product.productId || product.id,
      name: product.name,
      quantity: product.count || product.quantity || 1,
      unitPrice: product.price / 100, // Getir uses kuruş (cents)
      notes: product.note,
      modifiers: (product.optionCategories || []).flatMap((cat: any) =>
        (cat.options || []).map((opt: any) => ({
          name: opt.name,
          price: (opt.price || 0) / 100,
          quantity: opt.count || 1,
        })),
      ),
    }));

    return {
      platform: DeliveryPlatform.GETIR,
      externalOrderId: raw.id,
      customerName: raw.client?.name,
      customerPhone: raw.client?.clientPhoneNumber,
      customerAddress: raw.client?.deliveryAddress?.address,
      notes: raw.clientNote,
      items,
      totalAmount: (raw.totalPrice || 0) / 100,
      discount: (raw.discountTotal || 0) / 100,
      finalAmount: ((raw.totalPrice || 0) - (raw.discountTotal || 0)) / 100,
      rawPayload: raw,
      createdAt: raw.createdAt ? new Date(raw.createdAt) : undefined,
    };
  }
}
