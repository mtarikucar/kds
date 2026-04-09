import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Optional,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus } from '../../common/constants/order-status.enum';
import { validateTransition } from '../../common/utils/order-state-machine';
import { UpdateOrderItemStatusDto, OrderItemStatus } from './dto/update-order-item-status.dto';
import { KdsGateway } from './kds.gateway';
import { DeliveryStatusSyncService } from '../delivery-platforms/services/delivery-status-sync.service';
import { StockDeductionService } from '../stock-management/services/stock-deduction.service';

@Injectable()
export class KdsService {
  private readonly logger = new Logger(KdsService.name);

  constructor(
    private prisma: PrismaService,
    private kdsGateway: KdsGateway,
    @Optional()
    @Inject(forwardRef(() => DeliveryStatusSyncService))
    private deliveryStatusSync?: DeliveryStatusSyncService,
    @Optional()
    @Inject(forwardRef(() => StockDeductionService))
    private stockDeductionService?: StockDeductionService,
  ) {}

  async getKitchenOrders(tenantId: string) {
    // Get orders that are in kitchen workflow (PENDING, PREPARING, READY)
    return this.prisma.order.findMany({
      where: {
        tenantId,
        status: {
          in: [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY],
        },
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                image: true,
                categoryId: true,
              },
            },
          },
        },
        table: {
          select: {
            id: true,
            number: true,
            section: true,
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateOrderStatus(id: string, status: OrderStatus, tenantId: string) {
    // Use transaction with serializable isolation to prevent race conditions
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Verify order exists and belongs to tenant
      const order = await tx.order.findFirst({
        where: {
          id,
          tenantId,
        },
      });

      if (!order) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      // Prevent status updates for orders awaiting approval
      if (order.requiresApproval && order.status === OrderStatus.PENDING_APPROVAL) {
        throw new BadRequestException(
          'Order requires approval before status can be changed. Please approve the order first.'
        );
      }

      // Validate state transition using state machine (STRICT mode)
      validateTransition(order.status as OrderStatus, status);

      // Build update data with status timestamps
      const updateData: any = { status };
      if (status === OrderStatus.PREPARING) updateData.preparingAt = new Date();
      if (status === OrderStatus.READY) updateData.readyAt = new Date();

      // Update order status
      return tx.order.update({
        where: { id },
        data: updateData,
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
          table: true,
        },
      });
    });

    // Trigger stock deduction at the configured status (if applicable)
    if (this.stockDeductionService) {
      try {
        const result = await this.stockDeductionService.deductForOrder(id, tenantId, status);
        if (result?.lowStockAlerts?.length) {
          this.kdsGateway.emitLowStockAlert(tenantId, result.lowStockAlerts);
        }
      } catch (error: any) {
        this.logger.error(
          `Stock deduction failed for order ${id}: ${error.message}`,
          error.stack,
        );
      }
    }

    // Emit status change via WebSocket
    this.kdsGateway.emitOrderStatusChange(tenantId, id, status);

    // Sync status to delivery platform (if applicable)
    this.deliveryStatusSync?.syncStatusToPlatform(id, status).catch((err) => {
      this.logger.error(`Delivery platform sync failed for order ${id}: ${err.message}`);
    });

    return updatedOrder;
  }

  async updateOrderItemStatus(
    id: string,
    updateDto: UpdateOrderItemStatusDto,
    tenantId: string,
  ) {
    // Use transaction for atomicity: item update + all-ready check + order promotion
    const { updatedOrderItem, shouldPromote, orderId } = await this.prisma.$transaction(async (tx) => {
      // Verify order item exists
      const orderItem = await tx.orderItem.findUnique({
        where: { id: updateDto.orderItemId },
        include: {
          order: true,
        },
      });

      if (!orderItem) {
        throw new NotFoundException(`Order item with ID ${updateDto.orderItemId} not found`);
      }

      // Verify order belongs to tenant
      if (orderItem.order.tenantId !== tenantId) {
        throw new BadRequestException('Order item does not belong to your tenant');
      }

      // Update order item status
      const updated = await tx.orderItem.update({
        where: { id: updateDto.orderItemId },
        data: { status: updateDto.status },
        include: {
          product: true,
          order: true,
        },
      });

      // Check if all items are ready, then update order status
      const allItems = await tx.orderItem.findMany({
        where: { orderId: orderItem.orderId },
      });

      const allReady = allItems.every((item) => item.status === OrderItemStatus.READY);
      const shouldPromoteOrder =
        allReady &&
        orderItem.order.status !== OrderStatus.READY &&
        (!orderItem.order.requiresApproval || orderItem.order.status !== OrderStatus.PENDING_APPROVAL);

      return {
        updatedOrderItem: updated,
        shouldPromote: shouldPromoteOrder,
        orderId: orderItem.orderId,
      };
    });

    // Promote order outside transaction (updateOrderStatus has its own transaction)
    if (shouldPromote) {
      await this.updateOrderStatus(orderId, OrderStatus.READY, tenantId);
    }

    // Emit item status change via WebSocket
    this.kdsGateway.emitOrderItemStatusChange(
      tenantId,
      updateDto.orderItemId,
      updateDto.status,
    );

    return updatedOrderItem;
  }

  async cancelOrder(id: string, tenantId: string) {
    // Verify order exists and belongs to tenant
    const order = await this.prisma.order.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    // Validate state transition using state machine (STRICT mode)
    // This handles PAID and CANCELLED terminal states
    validateTransition(order.status as OrderStatus, OrderStatus.CANCELLED);

    // Update order status to CANCELLED
    const updatedOrder = await this.prisma.order.update({
      where: { id },
      data: { status: OrderStatus.CANCELLED },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        table: true,
      },
    });

    // Reverse ingredient deductions on cancellation
    if (this.stockDeductionService) {
      try {
        await this.stockDeductionService.reverseForOrder(id, tenantId);
      } catch (error: any) {
        this.logger.error(
          `CRITICAL: Stock reversal failed for cancelled order ${id}. Manual stock adjustment may be needed. Error: ${error.message}`,
          error.stack,
        );
      }
    }

    // Emit status change via WebSocket
    this.kdsGateway.emitOrderStatusChange(tenantId, id, OrderStatus.CANCELLED);

    // Sync cancellation to delivery platform (if applicable)
    this.deliveryStatusSync?.syncStatusToPlatform(id, OrderStatus.CANCELLED).catch((err) => {
      this.logger.error(`Delivery platform sync failed for order ${id}: ${err.message}`);
    });

    return updatedOrder;
  }
}
