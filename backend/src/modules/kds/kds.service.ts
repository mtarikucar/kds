import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus } from '../../common/constants/order-status.enum';
import { UpdateOrderItemStatusDto, OrderItemStatus } from './dto/update-order-item-status.dto';
import { KdsGateway } from './kds.gateway';

@Injectable()
export class KdsService {
  constructor(
    private prisma: PrismaService,
    private kdsGateway: KdsGateway,
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

    // Update order status
    const updatedOrder = await this.prisma.order.update({
      where: { id },
      data: { status },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        table: true,
      },
    });

    // Emit status change via WebSocket
    this.kdsGateway.emitOrderStatusChange(tenantId, id, status);

    return updatedOrder;
  }

  async updateOrderItemStatus(
    id: string,
    updateDto: UpdateOrderItemStatusDto,
    tenantId: string,
  ) {
    // Verify order item exists
    const orderItem = await this.prisma.orderItem.findUnique({
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
    const updatedOrderItem = await this.prisma.orderItem.update({
      where: { id: updateDto.orderItemId },
      data: { status: updateDto.status },
      include: {
        product: true,
        order: true,
      },
    });

    // Check if all items are ready, then update order status
    const allItems = await this.prisma.orderItem.findMany({
      where: { orderId: orderItem.orderId },
    });

    const allReady = allItems.every((item) => item.status === OrderItemStatus.READY);
    if (allReady && orderItem.order.status !== OrderStatus.READY) {
      await this.updateOrderStatus(orderItem.orderId, OrderStatus.READY, tenantId);
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

    // Don't allow cancelling already paid orders
    if (order.status === OrderStatus.PAID) {
      throw new BadRequestException('Cannot cancel paid orders');
    }

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

    // Emit status change via WebSocket
    this.kdsGateway.emitOrderStatusChange(tenantId, id, OrderStatus.CANCELLED);

    return updatedOrder;
  }
}
