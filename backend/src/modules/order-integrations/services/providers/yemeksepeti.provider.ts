import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  PlatformType,
  PlatformOrderStatus,
  YemeksepetiOrderStatus,
  SyncOperationType,
  SyncDirection,
} from '../../constants';
import {
  YemeksepetiCredentials,
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

interface YemeksepetiOrder {
  orderId: string;
  displayId: string;
  status: string;
  customer: {
    fullName: string;
    phoneNumber: string;
    deliveryAddress: {
      fullAddress: string;
      notes?: string;
    };
  };
  orderLines: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    notes?: string;
    modifiers?: Array<{
      modifierId: string;
      modifierName: string;
      quantity: number;
      price: number;
    }>;
  }>;
  payment: {
    totalAmount: number;
    deliveryFee: number;
    discount: number;
    paymentMethod: string;
    isPaid: boolean;
  };
  estimatedDeliveryTime?: string;
  createdDate: string;
}

/**
 * Yemeksepeti Platform Provider
 * Handles all Yemeksepeti-specific API interactions
 */
@Injectable()
export class YemeksepetiProvider extends BasePlatformProvider {
  readonly platformType = PlatformType.YEMEKSEPETI;
  protected readonly baseUrl = 'https://api.yemeksepeti.com/partner/v1';

  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super(prisma, httpService);
  }

  /**
   * Get or refresh OAuth access token
   */
  private async getAccessToken(): Promise<string> {
    const credentials =
      (await this.getCredentials()) as YemeksepetiCredentials | null;

    if (!credentials) {
      throw new Error('Yemeksepeti credentials not configured');
    }

    // Check if we have a valid cached token
    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      new Date() < this.tokenExpiresAt
    ) {
      return this.accessToken;
    }

    // Request new token
    const response = await this.httpService.axiosRef.post(
      'https://api.yemeksepeti.com/oauth/token',
      {
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
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
      (await this.getCredentials()) as YemeksepetiCredentials | null;

    return {
      Authorization: `Bearer ${token}`,
      'X-Vendor-Id': credentials?.vendorId || '',
    };
  }

  async acceptOrder(
    platformOrderId: string,
    estimatedPrepTime = 30,
  ): Promise<OrderAcceptResult> {
    const startTime = Date.now();

    try {
      await this.makeRequest('POST', `/orders/${platformOrderId}/confirm`, {
        estimatedPrepTime,
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
    const startTime = Date.now();

    try {
      await this.makeRequest('POST', `/orders/${platformOrderId}/reject`, {
        reason,
      });

      await this.logSync({
        operationType: SyncOperationType.ORDER_STATUS_PUSH,
        direction: SyncDirection.OUTBOUND,
        status: 'SUCCESS',
        platformOrderId,
        durationMs: Date.now() - startTime,
      });

      return { success: true };
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

  async updateOrderStatus(
    platformOrderId: string,
    status: PlatformOrderStatus,
  ): Promise<OrderStatusUpdateResult> {
    const statusMap: Record<PlatformOrderStatus, string | null> = {
      [PlatformOrderStatus.RECEIVED]: null,
      [PlatformOrderStatus.ACCEPTED]: YemeksepetiOrderStatus.CONFIRMED,
      [PlatformOrderStatus.REJECTED]: YemeksepetiOrderStatus.REJECTED,
      [PlatformOrderStatus.PREPARING]: YemeksepetiOrderStatus.PREPARING,
      [PlatformOrderStatus.READY]: null, // Yemeksepeti doesn't have READY status
      [PlatformOrderStatus.PICKED_UP]: YemeksepetiOrderStatus.ON_THE_WAY,
      [PlatformOrderStatus.DELIVERED]: YemeksepetiOrderStatus.DELIVERED,
      [PlatformOrderStatus.CANCELLED]: YemeksepetiOrderStatus.CANCELLED,
    };

    const yemeksepetiStatus = statusMap[status];

    if (!yemeksepetiStatus) {
      return {
        success: false,
        newStatus: status,
        message: `Status ${status} not supported by Yemeksepeti`,
      };
    }

    try {
      await this.makeRequest('PUT', `/orders/${platformOrderId}/status`, {
        status: yemeksepetiStatus,
      });
      return { success: true, newStatus: yemeksepetiStatus };
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
    await this.makeRequest('PUT', '/vendor/status', { isOpen: true });
  }

  async setRestaurantClosed(reason?: string): Promise<void> {
    await this.makeRequest('PUT', '/vendor/status', {
      isOpen: false,
      reason,
    });
  }

  async getRestaurantStatus(): Promise<RestaurantStatus> {
    try {
      const response = await this.makeRequest<{ isOpen: boolean }>(
        'GET',
        '/vendor/status',
      );
      return { isOpen: response.isOpen };
    } catch {
      return { isOpen: false };
    }
  }

  async fetchNewOrders(since?: Date): Promise<PlatformOrderData[]> {
    try {
      const response = await this.makeRequest<{ orders: YemeksepetiOrder[] }>(
        'GET',
        '/orders?status=WAITING_CONFIRMATION',
      );
      return response.orders.map((order) => this.transformOrder(order));
    } catch {
      return [];
    }
  }

  async getOrderStatus(platformOrderId: string): Promise<string> {
    try {
      const response = await this.makeRequest<{ order: YemeksepetiOrder }>(
        'GET',
        `/orders/${platformOrderId}`,
      );
      return response.order.status;
    } catch (error: any) {
      this.logger.error(`Failed to get order status: ${error.message}`);
      throw error;
    }
  }

  private transformOrder(order: YemeksepetiOrder): PlatformOrderData {
    return {
      platformOrderId: order.orderId,
      platformOrderNumber: order.displayId,
      platformType: PlatformType.YEMEKSEPETI,
      platformStatus: order.status,
      customerName: order.customer.fullName,
      customerPhone: order.customer.phoneNumber,
      deliveryAddress: order.customer.deliveryAddress.fullAddress,
      deliveryInstructions: order.customer.deliveryAddress.notes,
      items: order.orderLines.map((item) => ({
        platformProductId: item.productId,
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.lineTotal,
        notes: item.notes,
        modifiers: item.modifiers?.map((mod) => ({
          platformModifierId: mod.modifierId,
          name: mod.modifierName,
          quantity: mod.quantity,
          price: mod.price,
        })),
      })),
      subtotal: order.payment.totalAmount - order.payment.deliveryFee,
      deliveryFee: order.payment.deliveryFee,
      discount: order.payment.discount,
      total: order.payment.totalAmount,
      isPrepaid: order.payment.isPaid,
      paymentMethod: order.payment.paymentMethod,
      createdAt: new Date(order.createdDate),
      rawData: order,
    };
  }

  verifyWebhook(payload: unknown, headers: Record<string, string>): boolean {
    const signature = headers['x-yemeksepeti-signature'];
    const webhookSecret = this.configService.get<string>(
      'YEMEKSEPETI_WEBHOOK_SECRET',
    );

    if (!signature || !webhookSecret) return false;

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return signature === expectedSignature;
  }

  parseWebhookPayload(payload: unknown): PlatformOrderData | null {
    try {
      const data = payload as { order: YemeksepetiOrder };
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
        message: 'Connected to Yemeksepeti API',
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
