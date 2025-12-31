import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../../../../prisma/prisma.service';
import { IntegrationType } from '../../../../common/constants/integration-types.enum';
import { PlatformType, PlatformOrderStatus } from '../../constants';
import {
  IPlatformProvider,
  PlatformCredentials,
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

/**
 * Abstract base class for all platform providers
 * Provides common functionality and enforces the IPlatformProvider interface
 */
export abstract class BasePlatformProvider implements IPlatformProvider {
  protected readonly logger: Logger;
  protected tenantId: string | null = null;

  abstract readonly platformType: PlatformType;
  protected abstract readonly baseUrl: string;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly httpService: HttpService,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Initialize the provider for a specific tenant
   */
  async initialize(tenantId: string): Promise<void> {
    this.tenantId = tenantId;
  }

  /**
   * Set the tenant context for the provider
   */
  setTenantContext(tenantId: string): void {
    this.tenantId = tenantId;
  }

  /**
   * Get the current tenant ID
   */
  protected getTenantId(): string {
    if (!this.tenantId) {
      throw new Error('Tenant context not set. Call setTenantContext() first.');
    }
    return this.tenantId;
  }

  /**
   * Get credentials from the database for the current tenant
   */
  async getCredentials(): Promise<PlatformCredentials | null> {
    const tenantId = this.getTenantId();

    const settings = await this.prisma.integrationSettings.findFirst({
      where: {
        tenantId,
        integrationType: IntegrationType.DELIVERY_APP,
        provider: this.platformType,
      },
    });

    if (!settings?.config) {
      return null;
    }

    return {
      isConfigured: settings.isConfigured,
      ...(settings.config as object),
    } as PlatformCredentials;
  }

  /**
   * Check if the provider is configured for the current tenant
   */
  async isConfigured(): Promise<boolean> {
    const credentials = await this.getCredentials();
    return credentials?.isConfigured ?? false;
  }

  /**
   * Save or update credentials for the current tenant
   */
  protected async saveCredentials(
    credentials: Partial<PlatformCredentials>,
  ): Promise<void> {
    const tenantId = this.getTenantId();

    await this.prisma.integrationSettings.upsert({
      where: {
        tenantId_integrationType_provider: {
          tenantId,
          integrationType: IntegrationType.DELIVERY_APP,
          provider: this.platformType,
        },
      },
      create: {
        tenantId,
        integrationType: IntegrationType.DELIVERY_APP,
        provider: this.platformType,
        name: this.platformType,
        config: credentials as object,
        isEnabled: true,
        isConfigured: true,
      },
      update: {
        config: credentials as object,
        isConfigured: true,
        lastSyncedAt: new Date(),
      },
    });
  }

  /**
   * Log a sync operation
   */
  protected async logSync(params: {
    operationType: string;
    direction: 'INBOUND' | 'OUTBOUND';
    status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
    requestData?: unknown;
    responseData?: unknown;
    errorMessage?: string;
    errorCode?: string;
    platformOrderId?: string;
    productId?: string;
    durationMs?: number;
    retryCount?: number;
  }): Promise<void> {
    await this.prisma.integrationSyncLog.create({
      data: {
        tenantId: this.getTenantId(),
        platformType: this.platformType,
        operationType: params.operationType,
        direction: params.direction,
        status: params.status,
        requestData: params.requestData as object,
        responseData: params.responseData as object,
        errorMessage: params.errorMessage,
        errorCode: params.errorCode,
        platformOrderId: params.platformOrderId,
        productId: params.productId,
        durationMs: params.durationMs,
        retryCount: params.retryCount ?? 0,
      },
    });
  }

  /**
   * Generate authorization headers (to be overridden by subclasses)
   */
  protected abstract getAuthHeaders(): Promise<Record<string, string>>;

  /**
   * Make an authenticated API request
   */
  protected async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    data?: unknown,
    additionalHeaders?: Record<string, string>,
  ): Promise<T> {
    const headers = await this.getAuthHeaders();
    const url = `${this.baseUrl}${endpoint}`;

    const startTime = Date.now();

    try {
      const response = await this.httpService.axiosRef.request<T>({
        method,
        url,
        data,
        headers: {
          ...headers,
          ...additionalHeaders,
          'Content-Type': 'application/json',
        },
      });

      this.logger.debug(
        `API Request: ${method} ${endpoint} - ${Date.now() - startTime}ms`,
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `API Request Failed: ${method} ${endpoint} - ${error.message}`,
        error.response?.data,
      );
      throw error;
    }
  }

  // Abstract methods to be implemented by subclasses
  abstract acceptOrder(
    platformOrderId: string,
    estimatedPrepTime?: number,
  ): Promise<OrderAcceptResult>;

  abstract rejectOrder(
    platformOrderId: string,
    reason: string,
  ): Promise<OrderRejectResult>;

  abstract updateOrderStatus(
    platformOrderId: string,
    status: PlatformOrderStatus,
  ): Promise<OrderStatusUpdateResult>;

  abstract syncMenu(
    products: ProductSyncData[],
    categories: CategorySyncData[],
  ): Promise<MenuSyncResult>;

  abstract syncProductAvailability(
    platformProductId: string,
    isAvailable: boolean,
  ): Promise<void>;

  abstract syncProductPrice(
    platformProductId: string,
    price: number,
  ): Promise<void>;

  abstract setRestaurantOpen(): Promise<void>;

  abstract setRestaurantClosed(reason?: string): Promise<void>;

  abstract getRestaurantStatus(): Promise<RestaurantStatus>;

  abstract fetchNewOrders(since?: Date): Promise<PlatformOrderData[]>;

  abstract getOrderStatus(platformOrderId: string): Promise<string>;

  abstract verifyWebhook(
    payload: unknown,
    headers: Record<string, string>,
  ): boolean;

  abstract parseWebhookPayload(payload: unknown): PlatformOrderData | null;

  abstract testConnection(): Promise<ConnectionTestResult>;
}
