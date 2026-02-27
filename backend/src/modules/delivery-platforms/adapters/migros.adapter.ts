import { Injectable } from '@nestjs/common';
import { DeliveryPlatformConfig } from '@prisma/client';
import { DeliveryPlatform } from '../constants/platform.enum';
import {
  AuthResult,
  PlatformAdapter,
} from '../interfaces/platform-adapter.interface';
import { NormalizedOrder } from '../interfaces/platform-order.interface';
import { BaseAdapter } from './base.adapter';

@Injectable()
export class MigrosAdapter extends BaseAdapter implements PlatformAdapter {
  constructor() {
    super('MigrosAdapter', 'https://partner-api.migros.com.tr/yemek');
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
      method: 'PUT',
      url: `/orders/${externalOrderId}/status`,
      headers: this.getMigrosHeaders(config),
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
      headers: this.getMigrosHeaders(config),
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
      headers: this.getMigrosHeaders(config),
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
      headers: this.getMigrosHeaders(config),
      data: { status: 'READY' },
    });
  }

  async markPickedUp(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
  ): Promise<void> {
    // Migros has limited status updates - markReady is the last status we can set
    this.logger.log(`Order ${externalOrderId} picked up (Migros: no separate pickup endpoint)`);
  }

  async cancelOrder(
    config: DeliveryPlatformConfig,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/orders/${externalOrderId}/status`,
      headers: this.getMigrosHeaders(config),
      data: { status: 'CANCELLED', reason },
    });
  }

  async pollNewOrders(
    config: DeliveryPlatformConfig,
  ): Promise<NormalizedOrder[]> {
    const response = await this.request({
      method: 'GET',
      url: `/restaurants/${config.remoteRestaurantId}/orders?status=NEW`,
      headers: this.getMigrosHeaders(config),
    });

    const orders = response.data?.orders || response.data || [];
    return orders.map((order: any) => this.normalizeOrder(order));
  }

  async testConnection(config: DeliveryPlatformConfig): Promise<boolean> {
    try {
      await this.request({
        method: 'GET',
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
      'X-API-Key': credentials.apiKey,
      'X-Branch-Id': config.remoteRestaurantId || '',
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
