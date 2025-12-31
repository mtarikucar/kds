import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  PlatformType,
  PlatformOrderStatus,
  MigrosOrderStatus,
  SyncOperationType,
  SyncDirection,
} from '../../constants';
import {
  MigrosCredentials,
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

interface MigrosOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  customer: {
    name: string;
    phone: string;
    address: string;
  };
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  totalAmount: number;
  deliveryFee: number;
  createdAt: string;
}

/**
 * Migros Hemen Platform Provider
 */
@Injectable()
export class MigrosProvider extends BasePlatformProvider {
  readonly platformType = PlatformType.MIGROS;
  protected readonly baseUrl = 'https://api.migros.com.tr/partner/v1';

  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super(prisma, httpService);
  }

  private async getAccessToken(): Promise<string> {
    const credentials =
      (await this.getCredentials()) as MigrosCredentials | null;

    if (!credentials) {
      throw new Error('Migros credentials not configured');
    }

    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      new Date() < this.tokenExpiresAt
    ) {
      return this.accessToken;
    }

    const response = await this.httpService.axiosRef.post(
      'https://api.migros.com.tr/oauth/token',
      {
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      },
    );

    this.accessToken = response.data.access_token;
    this.tokenExpiresAt = new Date(
      Date.now() + response.data.expires_in * 1000,
    );

    return this.accessToken!;
  }

  protected async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    const credentials =
      (await this.getCredentials()) as MigrosCredentials | null;

    return {
      Authorization: `Bearer ${token}`,
      'X-Store-Code': credentials?.storeCode || '',
    };
  }

  async acceptOrder(
    platformOrderId: string,
    estimatedPrepTime = 30,
  ): Promise<OrderAcceptResult> {
    try {
      await this.makeRequest('POST', `/orders/${platformOrderId}/confirm`, {
        estimatedTime: estimatedPrepTime,
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
      await this.makeRequest('POST', `/orders/${platformOrderId}/cancel`, {
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
      [PlatformOrderStatus.ACCEPTED]: MigrosOrderStatus.CONFIRMED,
      [PlatformOrderStatus.REJECTED]: MigrosOrderStatus.CANCELLED,
      [PlatformOrderStatus.PREPARING]: MigrosOrderStatus.PICKING,
      [PlatformOrderStatus.READY]: MigrosOrderStatus.READY,
      [PlatformOrderStatus.PICKED_UP]: null,
      [PlatformOrderStatus.DELIVERED]: MigrosOrderStatus.DELIVERED,
      [PlatformOrderStatus.CANCELLED]: MigrosOrderStatus.CANCELLED,
    };

    const migrosStatus = statusMap[status];

    if (!migrosStatus) {
      return { success: false, newStatus: status, message: 'Status not supported' };
    }

    try {
      await this.makeRequest('PUT', `/orders/${platformOrderId}/status`, {
        status: migrosStatus,
      });
      return { success: true, newStatus: migrosStatus };
    } catch (error: any) {
      return { success: false, newStatus: status, message: error.message };
    }
  }

  async syncMenu(
    products: ProductSyncData[],
    categories: CategorySyncData[],
  ): Promise<MenuSyncResult> {
    try {
      await this.makeRequest('PUT', '/catalog', { products, categories });
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
    await this.makeRequest('PUT', `/products/${platformProductId}/stock`, {
      inStock: isAvailable,
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
    await this.makeRequest('PUT', '/store/status', { isOpen: true });
  }

  async setRestaurantClosed(reason?: string): Promise<void> {
    await this.makeRequest('PUT', '/store/status', { isOpen: false, reason });
  }

  async getRestaurantStatus(): Promise<RestaurantStatus> {
    try {
      const response = await this.makeRequest<{ isOpen: boolean }>(
        'GET',
        '/store/status',
      );
      return { isOpen: response.isOpen };
    } catch {
      return { isOpen: false };
    }
  }

  async fetchNewOrders(since?: Date): Promise<PlatformOrderData[]> {
    try {
      const response = await this.makeRequest<{ orders: MigrosOrder[] }>(
        'GET',
        '/orders?status=PENDING',
      );
      return response.orders.map((order) => this.transformOrder(order));
    } catch {
      return [];
    }
  }

  async getOrderStatus(platformOrderId: string): Promise<string> {
    try {
      const response = await this.makeRequest<{ order: MigrosOrder }>(
        'GET',
        `/orders/${platformOrderId}`,
      );
      return response.order.status;
    } catch (error: any) {
      this.logger.error(`Failed to get order status: ${error.message}`);
      throw error;
    }
  }

  private transformOrder(order: MigrosOrder): PlatformOrderData {
    return {
      platformOrderId: order.orderId,
      platformOrderNumber: order.orderNumber,
      platformType: PlatformType.MIGROS,
      platformStatus: order.status,
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      deliveryAddress: order.customer.address,
      items: order.items.map((item) => ({
        platformProductId: item.sku,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
      subtotal: order.totalAmount - order.deliveryFee,
      deliveryFee: order.deliveryFee,
      total: order.totalAmount,
      isPrepaid: true, // Migros orders are typically prepaid
      createdAt: new Date(order.createdAt),
      rawData: order,
    };
  }

  verifyWebhook(payload: unknown, headers: Record<string, string>): boolean {
    const signature = headers['x-migros-signature'];
    const webhookSecret = this.configService.get<string>('MIGROS_WEBHOOK_SECRET');

    if (!signature || !webhookSecret) return false;

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return signature === expectedSignature;
  }

  parseWebhookPayload(payload: unknown): PlatformOrderData | null {
    try {
      const data = payload as { order: MigrosOrder };
      return data.order ? this.transformOrder(data.order) : null;
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    try {
      await this.getAccessToken();
      return {
        success: true,
        message: 'Connected to Migros API',
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
