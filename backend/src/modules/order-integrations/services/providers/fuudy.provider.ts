import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  PlatformType,
  PlatformOrderStatus,
  FuudyOrderStatus,
} from '../../constants';
import {
  FuudyCredentials,
  PlatformOrderData,
  ProductSyncData,
  CategorySyncData,
  MenuSyncResult,
  ConnectionTestResult,
  OrderAcceptResult,
  OrderRejectResult,
  OrderStatusUpdateResult,
  RestaurantStatus,
} from '../../interfaces';
import { BasePlatformProvider } from './base-platform.provider';

interface FuudyOrder {
  id: string;
  orderNumber: string;
  status: string;
  customer: {
    name: string;
    phone: string;
    address: string;
  };
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    price: number;
    total: number;
    notes?: string;
  }>;
  total: number;
  deliveryFee: number;
  paymentMethod: string;
  isPaid: boolean;
  createdAt: string;
}

/**
 * Fuudy Platform Provider
 */
@Injectable()
export class FuudyProvider extends BasePlatformProvider {
  readonly platformType = PlatformType.FUUDY;
  protected readonly baseUrl = 'https://api.fuudy.com/v1';

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super(prisma, httpService);
  }

  protected async getAuthHeaders(): Promise<Record<string, string>> {
    const credentials =
      (await this.getCredentials()) as FuudyCredentials | null;

    if (!credentials) {
      throw new Error('Fuudy credentials not configured');
    }

    return {
      'X-Api-Key': credentials.apiKey,
      'X-Restaurant-Id': credentials.restaurantId,
    };
  }

  async acceptOrder(
    platformOrderId: string,
    estimatedPrepTime = 30,
  ): Promise<OrderAcceptResult> {
    try {
      await this.makeRequest('POST', `/orders/${platformOrderId}/accept`, {
        prepTime: estimatedPrepTime,
      });
      return { success: true, estimatedPrepTime };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async rejectOrder(
    platformOrderId: string,
    reason: string,
  ): Promise<OrderRejectResult> {
    try {
      await this.makeRequest('POST', `/orders/${platformOrderId}/reject`, {
        reason,
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async updateOrderStatus(
    platformOrderId: string,
    status: PlatformOrderStatus,
  ): Promise<OrderStatusUpdateResult> {
    const statusMap: Record<PlatformOrderStatus, string | null> = {
      [PlatformOrderStatus.RECEIVED]: null,
      [PlatformOrderStatus.ACCEPTED]: FuudyOrderStatus.ACCEPTED,
      [PlatformOrderStatus.REJECTED]: null,
      [PlatformOrderStatus.PREPARING]: FuudyOrderStatus.PREPARING,
      [PlatformOrderStatus.READY]: FuudyOrderStatus.READY,
      [PlatformOrderStatus.PICKED_UP]: null,
      [PlatformOrderStatus.DELIVERED]: FuudyOrderStatus.DELIVERED,
      [PlatformOrderStatus.CANCELLED]: FuudyOrderStatus.CANCELLED,
    };

    const fuudyStatus = statusMap[status];

    if (!fuudyStatus) {
      return { success: false, newStatus: status, message: 'Status not supported' };
    }

    try {
      await this.makeRequest('PUT', `/orders/${platformOrderId}/status`, {
        status: fuudyStatus,
      });
      return { success: true, newStatus: fuudyStatus };
    } catch (error: any) {
      return { success: false, newStatus: status, message: error.message };
    }
  }

  async syncMenu(
    products: ProductSyncData[],
    categories: CategorySyncData[],
  ): Promise<MenuSyncResult> {
    try {
      await this.makeRequest('PUT', '/menu', { products, categories });
      return {
        success: true,
        syncedProducts: products.length,
        failedProducts: 0,
        syncedModifiers: 0,
        failedModifiers: 0,
      };
    } catch (error: any) {
      return {
        success: false,
        syncedProducts: 0,
        failedProducts: products.length,
        syncedModifiers: 0,
        failedModifiers: 0,
        errors: [{ productId: 'all', error: error.message }],
      };
    }
  }

  async syncProductAvailability(
    platformProductId: string,
    isAvailable: boolean,
  ): Promise<void> {
    await this.makeRequest('PUT', `/products/${platformProductId}/available`, {
      available: isAvailable,
    });
  }

  async syncProductPrice(
    platformProductId: string,
    price: number,
  ): Promise<void> {
    await this.makeRequest('PUT', `/products/${platformProductId}/price`, {
      price,
    });
  }

  async setRestaurantOpen(): Promise<void> {
    await this.makeRequest('PUT', '/restaurant/open', {});
  }

  async setRestaurantClosed(reason?: string): Promise<void> {
    await this.makeRequest('PUT', '/restaurant/close', { reason });
  }

  async getRestaurantStatus(): Promise<RestaurantStatus> {
    try {
      const response = await this.makeRequest<{ isOpen: boolean }>(
        'GET',
        '/restaurant/status',
      );
      return { isOpen: response.isOpen };
    } catch {
      return { isOpen: false };
    }
  }

  async fetchNewOrders(): Promise<PlatformOrderData[]> {
    // Fuudy may require polling since webhooks are limited
    try {
      const response = await this.makeRequest<{ orders: FuudyOrder[] }>(
        'GET',
        '/orders?status=NEW',
      );
      return response.orders.map((order) => this.transformOrder(order));
    } catch {
      return [];
    }
  }

  private transformOrder(order: FuudyOrder): PlatformOrderData {
    return {
      platformOrderId: order.id,
      platformOrderNumber: order.orderNumber,
      platformType: PlatformType.FUUDY,
      platformStatus: order.status,
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      deliveryAddress: order.customer.address,
      items: order.items.map((item) => ({
        platformProductId: item.productId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.total,
        notes: item.notes,
      })),
      subtotal: order.total - order.deliveryFee,
      deliveryFee: order.deliveryFee,
      total: order.total,
      isPrepaid: order.isPaid,
      paymentMethod: order.paymentMethod,
      createdAt: new Date(order.createdAt),
      rawData: order,
    };
  }

  verifyWebhook(payload: unknown, headers: Record<string, string>): boolean {
    const signature = headers['x-fuudy-signature'];
    const webhookSecret = this.configService.get<string>('FUUDY_WEBHOOK_SECRET');

    if (!signature || !webhookSecret) return false;

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return signature === expectedSignature;
  }

  parseWebhookPayload(payload: unknown): PlatformOrderData | null {
    try {
      const data = payload as { order: FuudyOrder };
      return data.order ? this.transformOrder(data.order) : null;
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    try {
      await this.makeRequest('GET', '/restaurant/status');
      return {
        success: true,
        message: 'Connected to Fuudy API',
        latencyMs: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message,
        latencyMs: Date.now() - startTime,
      };
    }
  }
}
