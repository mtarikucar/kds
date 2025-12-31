import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { KdsGateway } from '../../kds/kds.gateway';
import { OrdersService } from '../../orders/services/orders.service';
import { PlatformProviderFactory } from './platform-provider.factory';
import {
  PlatformType,
  PlatformOrderStatus,
  PLATFORM_STATUS_MAP,
  SyncOperationType,
  SyncDirection,
} from '../constants';
import { PlatformOrderData } from '../interfaces';
import { IntegrationType } from '../../../common/constants/integration-types.enum';
import { OrderType } from '../../../common/constants/order-status.enum';

@Injectable()
export class OrderIntegrationService {
  private readonly logger = new Logger(OrderIntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: PlatformProviderFactory,
    private readonly ordersService: OrdersService,
    private readonly kdsGateway: KdsGateway,
  ) {}

  /**
   * Process incoming order from a platform webhook
   */
  async processIncomingOrder(
    tenantId: string,
    platformType: PlatformType,
    orderData: PlatformOrderData,
  ) {
    const startTime = Date.now();

    try {
      // 1. Check if order already exists
      const existing = await this.prisma.platformOrder.findFirst({
        where: {
          tenantId,
          platformType,
          platformOrderId: orderData.platformOrderId,
        },
      });

      if (existing) {
        this.logger.warn(
          `Order ${orderData.platformOrderId} already exists for platform ${platformType}`,
        );
        return existing;
      }

      // 2. Map platform status to internal status
      const internalStatus =
        PLATFORM_STATUS_MAP[platformType]?.[orderData.platformStatus] ||
        PlatformOrderStatus.RECEIVED;

      // 3. Create platform order record
      const platformOrder = await this.prisma.platformOrder.create({
        data: {
          tenantId,
          platformType,
          platformOrderId: orderData.platformOrderId,
          platformOrderNumber: orderData.platformOrderNumber,
          platformStatus: orderData.platformStatus,
          internalStatus,
          rawOrderData: orderData.rawData as object,
          customerInfo: {
            name: orderData.customerName,
            phone: orderData.customerPhone,
            address: orderData.customerAddress,
          },
          deliveryInfo: {
            address: orderData.deliveryAddress,
            instructions: orderData.deliveryInstructions,
            estimatedTime: orderData.estimatedDeliveryTime,
          },
          paymentInfo: {
            method: orderData.paymentMethod,
            isPrepaid: orderData.isPrepaid,
            subtotal: orderData.subtotal,
            deliveryFee: orderData.deliveryFee,
            discount: orderData.discount,
          },
          platformCreatedAt: orderData.createdAt,
          platformTotal: orderData.total,
        },
      });

      // 4. Check if auto-accept is enabled
      const settings = await this.getIntegrationSettings(tenantId, platformType);
      if (settings?.autoAccept) {
        await this.acceptPlatformOrder(platformOrder.id, tenantId);
      }

      // 5. Emit WebSocket event for KDS
      this.emitPlatformOrderReceived(tenantId, platformOrder);

      // 6. Log success
      await this.logSync({
        tenantId,
        platformType,
        operationType: SyncOperationType.ORDER_RECEIVED,
        direction: SyncDirection.INBOUND,
        status: 'SUCCESS',
        platformOrderId: orderData.platformOrderId,
        durationMs: Date.now() - startTime,
      });

      return platformOrder;
    } catch (error: any) {
      await this.logSync({
        tenantId,
        platformType,
        operationType: SyncOperationType.ORDER_RECEIVED,
        direction: SyncDirection.INBOUND,
        status: 'FAILED',
        errorMessage: error.message,
        platformOrderId: orderData.platformOrderId,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Accept a platform order and create internal order
   */
  async acceptPlatformOrder(
    platformOrderId: string,
    tenantId: string,
    estimatedPrepTime?: number,
  ) {
    const platformOrder = await this.prisma.platformOrder.findFirst({
      where: { id: platformOrderId, tenantId },
    });

    if (!platformOrder) {
      throw new NotFoundException('Platform order not found');
    }

    if (platformOrder.orderId) {
      throw new BadRequestException('Order already accepted');
    }

    // 1. Get provider and accept on platform
    const provider = await this.providerFactory.getProviderForTenant(
      platformOrder.platformType as PlatformType,
      tenantId,
    );

    const settings = await this.getIntegrationSettings(
      tenantId,
      platformOrder.platformType as PlatformType,
    );

    const prepTime = estimatedPrepTime || settings?.defaultPrepTime || 30;

    const acceptResult = await provider.acceptOrder(
      platformOrder.platformOrderId,
      prepTime,
    );

    if (!acceptResult.success) {
      throw new BadRequestException(
        `Failed to accept order on platform: ${acceptResult.message}`,
      );
    }

    // 2. Create internal order
    const orderData = platformOrder.rawOrderData as PlatformOrderData['rawData'];
    const customerInfo = platformOrder.customerInfo as {
      name?: string;
      phone?: string;
    };

    // Map platform order items to internal order items
    const items = await this.mapPlatformItemsToInternal(
      tenantId,
      platformOrder.platformType as PlatformType,
      orderData,
    );

    const internalOrder = await this.ordersService.create(
      {
        type: OrderType.DELIVERY,
        customerName: customerInfo?.name,
        notes: `Platform Order: ${platformOrder.platformOrderNumber || platformOrder.platformOrderId}`,
        items,
      },
      null,
      tenantId,
    );

    // Update source to platform type (default is 'POS')
    await this.prisma.order.update({
      where: { id: internalOrder.id },
      data: { source: platformOrder.platformType },
    });

    // 3. Update platform order with internal order reference
    await this.prisma.platformOrder.update({
      where: { id: platformOrderId },
      data: {
        orderId: internalOrder.id,
        internalStatus: 'PENDING',
        acceptedAt: new Date(),
      },
    });

    // 4. Emit to KDS
    this.kdsGateway.emitNewOrder(tenantId, internalOrder);

    return internalOrder;
  }

  /**
   * Reject a platform order
   */
  async rejectPlatformOrder(
    platformOrderId: string,
    tenantId: string,
    reason: string,
  ) {
    const platformOrder = await this.prisma.platformOrder.findFirst({
      where: { id: platformOrderId, tenantId },
    });

    if (!platformOrder) {
      throw new NotFoundException('Platform order not found');
    }

    const provider = await this.providerFactory.getProviderForTenant(
      platformOrder.platformType as PlatformType,
      tenantId,
    );

    const result = await provider.rejectOrder(
      platformOrder.platformOrderId,
      reason,
    );

    if (!result.success) {
      throw new BadRequestException(
        `Failed to reject order on platform: ${result.message}`,
      );
    }

    await this.prisma.platformOrder.update({
      where: { id: platformOrderId },
      data: {
        internalStatus: PlatformOrderStatus.REJECTED,
        platformStatus: 'REJECTED',
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });

    return { success: true };
  }

  /**
   * Push order status update to platform
   */
  async pushStatusUpdate(orderId: string, tenantId: string, newStatus: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { platformOrder: true },
    });

    if (!order?.platformOrder) {
      return; // Not a platform order
    }

    const platformType = order.platformOrder.platformType as PlatformType;
    const provider = await this.providerFactory.getProviderForTenant(
      platformType,
      tenantId,
    );

    // Map internal status to platform status
    const platformStatus = this.mapInternalToPlatformStatus(newStatus);

    if (!platformStatus) {
      return; // Status not mappable
    }

    await provider.updateOrderStatus(
      order.platformOrder.platformOrderId,
      platformStatus,
    );

    // Update platform order record
    await this.prisma.platformOrder.update({
      where: { id: order.platformOrder.id },
      data: {
        internalStatus: newStatus,
        platformStatus: platformStatus.toString(),
        ...(newStatus === 'PREPARING' && { preparedAt: new Date() }),
        ...(newStatus === 'READY' && { readyAt: new Date() }),
        ...(newStatus === 'SERVED' && { deliveredAt: new Date() }),
      },
    });
  }

  /**
   * Get all platform orders for a tenant
   */
  async getPlatformOrders(
    tenantId: string,
    filters: {
      platformType?: PlatformType;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: any = { tenantId };

    if (filters.platformType) {
      where.platformType = filters.platformType;
    }

    if (filters.status) {
      const statuses = filters.status.split(',');
      where.internalStatus = { in: statuses };
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [orders, total] = await Promise.all([
      this.prisma.platformOrder.findMany({
        where,
        include: { order: true },
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
      }),
      this.prisma.platformOrder.count({ where }),
    ]);

    return { orders, total };
  }

  /**
   * Get platform order by ID
   */
  async getPlatformOrder(id: string, tenantId: string) {
    const order = await this.prisma.platformOrder.findFirst({
      where: { id, tenantId },
      include: { order: { include: { orderItems: true } } },
    });

    if (!order) {
      throw new NotFoundException('Platform order not found');
    }

    return order;
  }

  /**
   * Get integration settings for a platform
   */
  async getIntegrationSettings(tenantId: string, platformType: PlatformType) {
    const settings = await this.prisma.integrationSettings.findFirst({
      where: {
        tenantId,
        integrationType: IntegrationType.DELIVERY_APP,
        provider: platformType,
      },
    });

    if (!settings?.config) return null;

    return settings.config as {
      autoAccept?: boolean;
      defaultPrepTime?: number;
    };
  }

  /**
   * Map platform order items to internal order items
   */
  private async mapPlatformItemsToInternal(
    tenantId: string,
    platformType: PlatformType,
    rawOrderData: unknown,
  ) {
    // This would map platform product IDs to internal product IDs
    // using the PlatformProductMapping table
    const orderData = rawOrderData as { items?: Array<{ platformProductId: string; quantity: number; unitPrice: number; notes?: string }> };
    const items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      notes?: string;
    }> = [];

    if (!orderData.items) return items;

    for (const item of orderData.items) {
      const mapping = await this.prisma.platformProductMapping.findFirst({
        where: {
          tenantId,
          platformType,
          platformProductId: item.platformProductId,
        },
      });

      if (mapping) {
        items.push({
          productId: mapping.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          notes: item.notes,
        });
      }
    }

    return items;
  }

  /**
   * Map internal order status to platform status
   */
  private mapInternalToPlatformStatus(
    internalStatus: string,
  ): PlatformOrderStatus | null {
    const statusMap: Record<string, PlatformOrderStatus> = {
      PENDING: PlatformOrderStatus.ACCEPTED,
      PREPARING: PlatformOrderStatus.PREPARING,
      READY: PlatformOrderStatus.READY,
      SERVED: PlatformOrderStatus.DELIVERED,
      CANCELLED: PlatformOrderStatus.CANCELLED,
    };

    return statusMap[internalStatus] || null;
  }

  /**
   * Emit platform order received event
   */
  private emitPlatformOrderReceived(tenantId: string, platformOrder: any) {
    // Emit to KDS namespace
    this.kdsGateway.server
      .to(`kitchen-${tenantId}`)
      .emit('platformOrderReceived', {
        id: platformOrder.id,
        platformType: platformOrder.platformType,
        platformOrderNumber: platformOrder.platformOrderNumber,
        customerInfo: platformOrder.customerInfo,
        total: platformOrder.platformTotal,
        status: platformOrder.internalStatus,
        createdAt: platformOrder.createdAt,
      });
  }

  /**
   * Log sync operation
   */
  private async logSync(params: {
    tenantId: string;
    platformType: string;
    operationType: string;
    direction: string;
    status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
    errorMessage?: string;
    platformOrderId?: string;
    durationMs?: number;
  }) {
    await this.prisma.integrationSyncLog.create({
      data: {
        tenantId: params.tenantId,
        platformType: params.platformType,
        operationType: params.operationType,
        direction: params.direction,
        status: params.status,
        errorMessage: params.errorMessage,
        platformOrderId: params.platformOrderId,
        durationMs: params.durationMs,
      },
    });
  }
}
