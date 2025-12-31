import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  PlatformType,
  PlatformOrderStatus,
  GetirOrderStatus,
  SyncOperationType,
  SyncDirection,
} from '../../constants';
import {
  GetirCredentials,
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

interface GetirOrder {
  id: string;
  orderNo: string;
  status: string;
  client: {
    name: string;
    phone: string;
    deliveryAddress: {
      address: string;
      description?: string;
    };
  };
  products: Array<{
    id: string;
    name: string;
    count: number;
    price: number;
    totalPrice: number;
    note?: string;
    optionCategories?: Array<{
      options: Array<{
        id: string;
        name: string;
        price: number;
      }>;
    }>;
  }>;
  totalPrice: number;
  courierFee?: number;
  discount?: number;
  paymentMethodId: number;
  isPaid: boolean;
  createdAt: string;
}

/**
 * Getir Yemek Platform Provider
 * Note: Getir requires WebSocket for real-time orders
 */
@Injectable()
export class GetirProvider extends BasePlatformProvider {
  readonly platformType = PlatformType.GETIR;
  protected readonly baseUrl = 'https://partners.getir.com/api/v1';

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super(prisma, httpService);
  }

  protected async getAuthHeaders(): Promise<Record<string, string>> {
    const credentials =
      (await this.getCredentials()) as GetirCredentials | null;

    if (!credentials) {
      throw new Error('Getir credentials not configured');
    }

    return {
      'X-Api-Key': credentials.apiKey,
      'X-Restaurant-Id': credentials.restaurantId,
    };
  }

  async acceptOrder(
    platformOrderId: string,
    estimatedPrepTime = 25,
  ): Promise<OrderAcceptResult> {
    const startTime = Date.now();

    try {
      // Getir has strict SLA - must accept within 2 minutes
      await this.makeRequest('POST', `/orders/${platformOrderId}/accept`, {
        preparationTime: estimatedPrepTime,
      });

      await this.logSync({
        operationType: SyncOperationType.ORDER_STATUS_PUSH,
        direction: SyncDirection.OUTBOUND,
        status: 'SUCCESS',
        platformOrderId,
        durationMs: Date.now() - startTime,
      });

      return { success: true, estimatedPrepTime };
    } catch (error: any) {
      await this.logSync({
        operationType: SyncOperationType.ORDER_STATUS_PUSH,
        direction: SyncDirection.OUTBOUND,
        status: 'FAILED',
        platformOrderId,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });
      return { success: false, message: error.message };
    }
  }

  async rejectOrder(
    platformOrderId: string,
    reason: string,
  ): Promise<OrderRejectResult> {
    try {
      await this.makeRequest('POST', `/orders/${platformOrderId}/reject`, {
        rejectReason: reason,
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
      [PlatformOrderStatus.ACCEPTED]: GetirOrderStatus.ACCEPTED,
      [PlatformOrderStatus.REJECTED]: GetirOrderStatus.REJECTED,
      [PlatformOrderStatus.PREPARING]: GetirOrderStatus.PREPARING,
      [PlatformOrderStatus.READY]: GetirOrderStatus.READY_FOR_PICKUP,
      [PlatformOrderStatus.PICKED_UP]: GetirOrderStatus.ON_THE_WAY,
      [PlatformOrderStatus.DELIVERED]: GetirOrderStatus.DELIVERED,
      [PlatformOrderStatus.CANCELLED]: GetirOrderStatus.CANCELLED,
    };

    const getirStatus = statusMap[status];

    if (!getirStatus) {
      return {
        success: false,
        newStatus: status,
        message: `Status ${status} not supported`,
      };
    }

    try {
      await this.makeRequest('PUT', `/orders/${platformOrderId}/status`, {
        status: getirStatus,
      });
      return { success: true, newStatus: getirStatus };
    } catch (error: any) {
      return { success: false, newStatus: status, message: error.message };
    }
  }

  async syncMenu(
    products: ProductSyncData[],
    categories: CategorySyncData[],
  ): Promise<MenuSyncResult> {
    try {
      // Getir uses a different structure - products as "variants"
      const getirProducts = products.map((p) => ({
        id: p.platformProductId || p.productId,
        name: p.name,
        description: p.description,
        price: Math.round(p.price * 100), // Getir uses kuruş (cents)
        categoryId: p.categoryId,
        isActive: p.isAvailable,
        imageUrl: p.imageUrl,
      }));

      await this.makeRequest('PUT', '/menu/products', {
        products: getirProducts,
      });

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
    await this.makeRequest('PUT', `/products/${platformProductId}/status`, {
      isActive: isAvailable,
    });
  }

  async syncProductPrice(
    platformProductId: string,
    price: number,
  ): Promise<void> {
    await this.makeRequest('PUT', `/products/${platformProductId}/price`, {
      price: Math.round(price * 100), // kuruş
    });
  }

  async setRestaurantOpen(): Promise<void> {
    await this.makeRequest('PUT', '/restaurant/status', { isOpen: true });
  }

  async setRestaurantClosed(reason?: string): Promise<void> {
    await this.makeRequest('PUT', '/restaurant/status', {
      isOpen: false,
      reason,
    });
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
    try {
      const response = await this.makeRequest<{ orders: GetirOrder[] }>(
        'GET',
        '/orders?status=NEW',
      );
      return response.orders.map((order) => this.transformOrder(order));
    } catch {
      return [];
    }
  }

  private transformOrder(order: GetirOrder): PlatformOrderData {
    return {
      platformOrderId: order.id,
      platformOrderNumber: order.orderNo,
      platformType: PlatformType.GETIR,
      platformStatus: order.status,
      customerName: order.client.name,
      customerPhone: order.client.phone,
      deliveryAddress: order.client.deliveryAddress.address,
      deliveryInstructions: order.client.deliveryAddress.description,
      items: order.products.map((item) => ({
        platformProductId: item.id,
        name: item.name,
        quantity: item.count,
        unitPrice: item.price / 100, // Convert from kuruş
        totalPrice: item.totalPrice / 100,
        notes: item.note,
        modifiers:
          item.optionCategories?.flatMap((cat) =>
            cat.options.map((opt) => ({
              platformModifierId: opt.id,
              name: opt.name,
              quantity: 1,
              price: opt.price / 100,
            })),
          ) ?? [],
      })),
      subtotal: (order.totalPrice - (order.courierFee ?? 0)) / 100,
      deliveryFee: (order.courierFee ?? 0) / 100,
      discount: (order.discount ?? 0) / 100,
      total: order.totalPrice / 100,
      isPrepaid: order.isPaid,
      paymentMethod: order.paymentMethodId.toString(),
      createdAt: new Date(order.createdAt),
      rawData: order,
    };
  }

  verifyWebhook(payload: unknown, headers: Record<string, string>): boolean {
    const signature = headers['x-getir-signature'];
    const webhookSecret = this.configService.get<string>('GETIR_WEBHOOK_SECRET');

    if (!signature || !webhookSecret) return false;

    const expectedSignature = crypto
      .createHmac('sha512', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return signature === expectedSignature;
  }

  parseWebhookPayload(payload: unknown): PlatformOrderData | null {
    try {
      const data = payload as { type: string; order: GetirOrder };
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
        message: 'Connected to Getir API',
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
