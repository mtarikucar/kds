import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  PlatformType,
  PlatformOrderStatus,
  TrendyolOrderStatus,
  SyncOperationType,
  SyncDirection,
} from '../../constants';
import {
  TrendyolCredentials,
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

interface TrendyolOrder {
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
    productName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    note?: string;
    options?: Array<{
      optionId: string;
      optionName: string;
      quantity: number;
      price: number;
    }>;
  }>;
  totalAmount: number;
  deliveryFee?: number;
  discount?: number;
  paymentMethod: string;
  isPrepaid: boolean;
  estimatedDeliveryTime?: string;
  createdAt: string;
}

/**
 * Trendyol Go Platform Provider
 * Handles all Trendyol-specific API interactions
 */
@Injectable()
export class TrendyolProvider extends BasePlatformProvider {
  readonly platformType = PlatformType.TRENDYOL;
  protected readonly baseUrl = 'https://api.trendyol.com/yemekpartner';

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super(prisma, httpService);
  }

  /**
   * Generate authorization headers for Trendyol API
   */
  protected async getAuthHeaders(): Promise<Record<string, string>> {
    const credentials =
      (await this.getCredentials()) as TrendyolCredentials | null;

    if (!credentials) {
      throw new Error('Trendyol credentials not configured');
    }

    const auth = Buffer.from(
      `${credentials.apiKey}:${credentials.apiSecret}`,
    ).toString('base64');

    return {
      Authorization: `Basic ${auth}`,
      'X-Store-Id': credentials.storeId,
    };
  }

  /**
   * Accept an order from Trendyol
   */
  async acceptOrder(
    platformOrderId: string,
    estimatedPrepTime = 30,
  ): Promise<OrderAcceptResult> {
    const startTime = Date.now();

    try {
      await this.makeRequest('PUT', `/orders/${platformOrderId}/accept`, {
        estimatedPrepTime,
      });

      await this.logSync({
        operationType: SyncOperationType.ORDER_STATUS_PUSH,
        direction: SyncDirection.OUTBOUND,
        status: 'SUCCESS',
        platformOrderId,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        estimatedPrepTime,
        message: 'Order accepted successfully',
      };
    } catch (error: any) {
      await this.logSync({
        operationType: SyncOperationType.ORDER_STATUS_PUSH,
        direction: SyncDirection.OUTBOUND,
        status: 'FAILED',
        platformOrderId,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Reject an order from Trendyol
   */
  async rejectOrder(
    platformOrderId: string,
    reason: string,
  ): Promise<OrderRejectResult> {
    const startTime = Date.now();

    try {
      await this.makeRequest('PUT', `/orders/${platformOrderId}/reject`, {
        reason,
      });

      await this.logSync({
        operationType: SyncOperationType.ORDER_STATUS_PUSH,
        direction: SyncDirection.OUTBOUND,
        status: 'SUCCESS',
        platformOrderId,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Order rejected successfully',
      };
    } catch (error: any) {
      await this.logSync({
        operationType: SyncOperationType.ORDER_STATUS_PUSH,
        direction: SyncDirection.OUTBOUND,
        status: 'FAILED',
        platformOrderId,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Update order status on Trendyol
   */
  async updateOrderStatus(
    platformOrderId: string,
    status: PlatformOrderStatus,
  ): Promise<OrderStatusUpdateResult> {
    const startTime = Date.now();

    // Map internal status to Trendyol status
    const trendyolStatus = this.mapToTrendyolStatus(status);

    if (!trendyolStatus) {
      return {
        success: false,
        newStatus: status,
        message: `Status ${status} cannot be mapped to Trendyol status`,
      };
    }

    try {
      await this.makeRequest('PUT', `/orders/${platformOrderId}/status`, {
        status: trendyolStatus,
      });

      await this.logSync({
        operationType: SyncOperationType.ORDER_STATUS_PUSH,
        direction: SyncDirection.OUTBOUND,
        status: 'SUCCESS',
        platformOrderId,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        newStatus: trendyolStatus,
        message: `Order status updated to ${trendyolStatus}`,
      };
    } catch (error: any) {
      await this.logSync({
        operationType: SyncOperationType.ORDER_STATUS_PUSH,
        direction: SyncDirection.OUTBOUND,
        status: 'FAILED',
        platformOrderId,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        newStatus: status,
        message: error.message,
      };
    }
  }

  /**
   * Map internal status to Trendyol status
   */
  private mapToTrendyolStatus(status: PlatformOrderStatus): string | null {
    const statusMap: Record<PlatformOrderStatus, string | null> = {
      [PlatformOrderStatus.RECEIVED]: null, // Cannot set externally
      [PlatformOrderStatus.ACCEPTED]: TrendyolOrderStatus.ACCEPTED,
      [PlatformOrderStatus.REJECTED]: TrendyolOrderStatus.REJECTED,
      [PlatformOrderStatus.PREPARING]: TrendyolOrderStatus.PREPARING,
      [PlatformOrderStatus.READY]: TrendyolOrderStatus.READY,
      [PlatformOrderStatus.PICKED_UP]: TrendyolOrderStatus.ON_THE_WAY,
      [PlatformOrderStatus.DELIVERED]: TrendyolOrderStatus.DELIVERED,
      [PlatformOrderStatus.CANCELLED]: TrendyolOrderStatus.CANCELLED,
    };

    return statusMap[status];
  }

  /**
   * Sync menu to Trendyol
   */
  async syncMenu(
    products: ProductSyncData[],
    categories: CategorySyncData[],
  ): Promise<MenuSyncResult> {
    const startTime = Date.now();
    let syncedProducts = 0;
    let failedProducts = 0;
    let syncedModifiers = 0;
    let failedModifiers = 0;
    const errors: Array<{ productId: string; error: string }> = [];

    try {
      // Transform products to Trendyol format
      const trendyolProducts = products.map((product) => ({
        id: product.platformProductId || product.productId,
        name: product.name,
        description: product.description,
        price: product.price,
        categoryId: product.categoryId,
        isAvailable: product.isAvailable,
        imageUrl: product.imageUrl,
        options: product.modifierGroups?.map((group) => ({
          groupId: group.platformGroupId || group.groupId,
          name: group.name,
          selectionType: group.selectionType,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          isRequired: group.isRequired,
          items: group.modifiers.map((mod) => ({
            id: mod.platformModifierId || mod.modifierId,
            name: mod.name,
            price: mod.price,
            isAvailable: mod.isAvailable,
          })),
        })),
      }));

      // Send to Trendyol
      await this.makeRequest('PUT', '/menus', {
        products: trendyolProducts,
        categories: categories.map((cat) => ({
          id: cat.platformCategoryId || cat.categoryId,
          name: cat.name,
          displayOrder: cat.displayOrder,
          isActive: cat.isActive,
        })),
      });

      syncedProducts = products.length;
      syncedModifiers = products.reduce(
        (acc, p) =>
          acc +
          (p.modifierGroups?.reduce(
            (modAcc, g) => modAcc + g.modifiers.length,
            0,
          ) ?? 0),
        0,
      );

      await this.logSync({
        operationType: SyncOperationType.MENU_SYNC,
        direction: SyncDirection.OUTBOUND,
        status: 'SUCCESS',
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        syncedProducts,
        failedProducts,
        syncedModifiers,
        failedModifiers,
      };
    } catch (error: any) {
      failedProducts = products.length;

      await this.logSync({
        operationType: SyncOperationType.MENU_SYNC,
        direction: SyncDirection.OUTBOUND,
        status: 'FAILED',
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        syncedProducts: 0,
        failedProducts,
        syncedModifiers: 0,
        failedModifiers,
        errors: [{ productId: 'all', error: error.message }],
      };
    }
  }

  /**
   * Sync product availability to Trendyol
   */
  async syncProductAvailability(
    platformProductId: string,
    isAvailable: boolean,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      await this.makeRequest(
        'PUT',
        `/products/${platformProductId}/availability`,
        {
          isAvailable,
        },
      );

      await this.logSync({
        operationType: SyncOperationType.AVAILABILITY_SYNC,
        direction: SyncDirection.OUTBOUND,
        status: 'SUCCESS',
        productId: platformProductId,
        durationMs: Date.now() - startTime,
      });
    } catch (error: any) {
      await this.logSync({
        operationType: SyncOperationType.AVAILABILITY_SYNC,
        direction: SyncDirection.OUTBOUND,
        status: 'FAILED',
        productId: platformProductId,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Sync product price to Trendyol
   */
  async syncProductPrice(
    platformProductId: string,
    price: number,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      await this.makeRequest('PUT', `/products/${platformProductId}/price`, {
        price,
      });

      await this.logSync({
        operationType: SyncOperationType.PRICE_SYNC,
        direction: SyncDirection.OUTBOUND,
        status: 'SUCCESS',
        productId: platformProductId,
        durationMs: Date.now() - startTime,
      });
    } catch (error: any) {
      await this.logSync({
        operationType: SyncOperationType.PRICE_SYNC,
        direction: SyncDirection.OUTBOUND,
        status: 'FAILED',
        productId: platformProductId,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Set restaurant as open on Trendyol
   */
  async setRestaurantOpen(): Promise<void> {
    const startTime = Date.now();

    try {
      await this.makeRequest('PUT', '/restaurants/status', {
        isOpen: true,
      });

      await this.logSync({
        operationType: SyncOperationType.RESTAURANT_STATUS,
        direction: SyncDirection.OUTBOUND,
        status: 'SUCCESS',
        durationMs: Date.now() - startTime,
      });
    } catch (error: any) {
      await this.logSync({
        operationType: SyncOperationType.RESTAURANT_STATUS,
        direction: SyncDirection.OUTBOUND,
        status: 'FAILED',
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Set restaurant as closed on Trendyol
   */
  async setRestaurantClosed(reason?: string): Promise<void> {
    const startTime = Date.now();

    try {
      await this.makeRequest('PUT', '/restaurants/status', {
        isOpen: false,
        closedReason: reason,
      });

      await this.logSync({
        operationType: SyncOperationType.RESTAURANT_STATUS,
        direction: SyncDirection.OUTBOUND,
        status: 'SUCCESS',
        durationMs: Date.now() - startTime,
      });
    } catch (error: any) {
      await this.logSync({
        operationType: SyncOperationType.RESTAURANT_STATUS,
        direction: SyncDirection.OUTBOUND,
        status: 'FAILED',
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get restaurant status from Trendyol
   */
  async getRestaurantStatus(): Promise<RestaurantStatus> {
    try {
      const response = await this.makeRequest<{
        isOpen: boolean;
        closedReason?: string;
        nextOpenTime?: string;
      }>('GET', '/restaurants/status');

      return {
        isOpen: response.isOpen,
        closedReason: response.closedReason,
        nextOpenTime: response.nextOpenTime
          ? new Date(response.nextOpenTime)
          : undefined,
      };
    } catch (error: any) {
      this.logger.error('Failed to get restaurant status', error.message);
      return {
        isOpen: false,
        closedReason: 'Unable to fetch status',
      };
    }
  }

  /**
   * Fetch new orders from Trendyol (polling)
   */
  async fetchNewOrders(since?: Date): Promise<PlatformOrderData[]> {
    try {
      let endpoint = '/orders?status=NEW';
      if (since) {
        endpoint += `&startDate=${since.toISOString()}`;
      }
      const response = await this.makeRequest<{ orders: TrendyolOrder[] }>(
        'GET',
        endpoint,
      );

      return response.orders.map((order) => this.transformOrder(order));
    } catch (error: any) {
      this.logger.error('Failed to fetch new orders', error.message);
      return [];
    }
  }

  /**
   * Get order status from Trendyol
   */
  async getOrderStatus(platformOrderId: string): Promise<string> {
    try {
      const response = await this.makeRequest<{ order: TrendyolOrder }>(
        'GET',
        `/orders/${platformOrderId}`,
      );
      return response.order.status;
    } catch (error: any) {
      this.logger.error(`Failed to get order status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transform Trendyol order to normalized format
   */
  private transformOrder(order: TrendyolOrder): PlatformOrderData {
    return {
      platformOrderId: order.id,
      platformOrderNumber: order.orderNumber,
      platformType: PlatformType.TRENDYOL,
      platformStatus: order.status,
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      customerAddress: order.customer.address,
      deliveryAddress: order.customer.address,
      items: order.items.map((item) => ({
        platformProductId: item.productId,
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        notes: item.note,
        modifiers: item.options?.map((opt) => ({
          platformModifierId: opt.optionId,
          name: opt.optionName,
          quantity: opt.quantity,
          price: opt.price,
        })),
      })),
      subtotal: order.totalAmount - (order.deliveryFee ?? 0),
      deliveryFee: order.deliveryFee,
      discount: order.discount,
      total: order.totalAmount,
      isPrepaid: order.isPrepaid,
      paymentMethod: order.paymentMethod,
      createdAt: new Date(order.createdAt),
      rawData: order,
    };
  }

  /**
   * Verify Trendyol webhook signature
   */
  verifyWebhook(payload: unknown, headers: Record<string, string>): boolean {
    const signature = headers['x-trendyol-signature'];

    if (!signature) {
      this.logger.warn('No signature found in webhook headers');
      return false;
    }

    const webhookSecret = this.configService.get<string>(
      'TRENDYOL_WEBHOOK_SECRET',
    );

    if (!webhookSecret) {
      this.logger.warn('TRENDYOL_WEBHOOK_SECRET not configured');
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('base64');

    return signature === expectedSignature;
  }

  /**
   * Parse Trendyol webhook payload to normalized format
   */
  parseWebhookPayload(payload: unknown): PlatformOrderData | null {
    try {
      const webhookData = payload as {
        eventType: string;
        order: TrendyolOrder;
      };

      if (!webhookData.order) {
        return null;
      }

      return this.transformOrder(webhookData.order);
    } catch (error: any) {
      this.logger.error('Failed to parse Trendyol webhook payload', error);
      return null;
    }
  }

  /**
   * Test connection to Trendyol API
   */
  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();

    try {
      await this.makeRequest('GET', '/restaurants/status');

      return {
        success: true,
        message: 'Successfully connected to Trendyol API',
        latencyMs: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Connection failed: ${error.message}`,
        latencyMs: Date.now() - startTime,
        details: {
          error: error.response?.data || error.message,
        },
      };
    }
  }
}
