import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderDto } from '../dto/update-order.dto';
import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';
import { OrderStatus, StockMovementType } from '../../../common/constants/order-status.enum';
import { KdsGateway } from '../../kds/kds.gateway';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => KdsGateway))
    private kdsGateway: KdsGateway,
  ) {}

  private generateOrderNumber(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `ORD-${timestamp}-${random}`;
  }

  async create(createOrderDto: CreateOrderDto, userId: string, tenantId: string) {
    // Validate table if provided
    if (createOrderDto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: {
          id: createOrderDto.tableId,
          tenantId,
        },
      });

      if (!table) {
        throw new BadRequestException('Invalid table or table does not belong to your tenant');
      }
    }

    // Validate all products exist and belong to tenant
    const productIds = createOrderDto.items.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId,
      },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products are invalid or do not belong to your tenant');
    }

    // Check product availability
    const unavailableProducts = products.filter((p) => !p.isAvailable);
    if (unavailableProducts.length > 0) {
      throw new BadRequestException(
        `Products not available: ${unavailableProducts.map((p) => p.name).join(', ')}`
      );
    }

    // Calculate totals
    let totalAmount = 0;
    const orderItems = createOrderDto.items.map((item) => {
      const subtotal = item.quantity * item.unitPrice;
      totalAmount += subtotal;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal,
        notes: item.notes,
      };
    });

    const discount = createOrderDto.discount || 0;
    const finalAmount = totalAmount - discount;

    // Generate order number
    const orderNumber = this.generateOrderNumber();

    // Create order with items
    const createData: any = {
      orderNumber,
      type: createOrderDto.type,
      status: OrderStatus.PENDING,
      totalAmount,
      discount,
      finalAmount,
      notes: createOrderDto.notes,
      customerName: createOrderDto.customerName,
      userId,
      tenantId,
      orderItems: {
        create: orderItems,
      },
    };

    if (createOrderDto.tableId) {
      createData.tableId = createOrderDto.tableId;
    }

    const createdOrder = await this.prisma.order.create({
      data: createData,
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                image: true,
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
    });

    // Emit new order to kitchen via WebSocket
    this.kdsGateway.emitNewOrder(tenantId, createdOrder);

    return createdOrder;
  }

  async findAll(
    tenantId: string,
    tableId?: string,
    statuses?: OrderStatus[],
    startDate?: Date,
    endDate?: Date,
  ) {
    const where: any = { tenantId };

    if (tableId) {
      where.tableId = tableId;
    }

    if (statuses && statuses.length > 0) {
      // Support both single status and multiple statuses
      if (statuses.length === 1) {
        where.status = statuses[0];
      } else {
        where.status = { in: statuses };
      }
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = startDate;
      }
      if (endDate) {
        where.createdAt.lte = endDate;
      }
    }

    console.log('[Orders Service] Where clause:', JSON.stringify(where, null, 2));

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                image: true,
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
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log('[Orders Service] Found orders:', orders.length, 'orders with statuses:', orders.map(o => o.status));

    return orders;
  }

  async findOne(id: string, tenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                image: true,
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
        payments: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
  }

  async update(id: string, updateOrderDto: UpdateOrderDto, tenantId: string) {
    // Check if order exists and belongs to tenant
    const order = await this.findOne(id, tenantId);

    // Don't allow updates to paid or cancelled orders
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot update paid or cancelled orders');
    }

    const updateData: any = {
      notes: updateOrderDto.notes,
      customerName: updateOrderDto.customerName,
    };

    // If items are provided, update the order items
    if (updateOrderDto.items && updateOrderDto.items.length > 0) {
      // Validate all products exist and belong to tenant
      const productIds = updateOrderDto.items.map((item) => item.productId);
      const products = await this.prisma.product.findMany({
        where: {
          id: { in: productIds },
          tenantId,
        },
      });

      if (products.length !== productIds.length) {
        throw new BadRequestException('One or more products are invalid or do not belong to your tenant');
      }

      // Check product availability
      const unavailableProducts = products.filter((p) => !p.isAvailable);
      if (unavailableProducts.length > 0) {
        throw new BadRequestException(
          `Products not available: ${unavailableProducts.map((p) => p.name).join(', ')}`
        );
      }

      // Calculate new totals
      let totalAmount = 0;
      const orderItems = updateOrderDto.items.map((item) => {
        const subtotal = item.quantity * item.unitPrice;
        totalAmount += subtotal;
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal,
          notes: item.notes,
        };
      });

      const discount = updateOrderDto.discount !== undefined ? updateOrderDto.discount : Number(order.discount);
      const finalAmount = totalAmount - discount;

      // Delete old items and create new ones
      await this.prisma.orderItem.deleteMany({
        where: { orderId: id },
      });

      updateData.orderItems = {
        create: orderItems,
      };
      updateData.totalAmount = totalAmount;
      updateData.discount = discount;
      updateData.finalAmount = finalAmount;
    } else if (updateOrderDto.discount !== undefined) {
      // Only discount is being updated
      updateData.discount = updateOrderDto.discount;
      updateData.finalAmount = Number(order.totalAmount) - updateOrderDto.discount;
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                image: true,
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
    });

    // If items were updated, emit to kitchen via WebSocket
    if (updateOrderDto.items && updateOrderDto.items.length > 0) {
      this.kdsGateway.emitOrderUpdated(tenantId, updatedOrder);
    }

    return updatedOrder;
  }

  async updateStatus(id: string, updateStatusDto: UpdateOrderStatusDto, tenantId: string) {
    // Check if order exists and belongs to tenant
    await this.findOne(id, tenantId);

    const updatedOrder = await this.prisma.order.update({
      where: { id },
      data: {
        status: updateStatusDto.status,
      },
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
    this.kdsGateway.emitOrderStatusChange(tenantId, id, updateStatusDto.status);

    return updatedOrder;
  }

  async remove(id: string, tenantId: string) {
    // Check if order exists and belongs to tenant
    const order = await this.findOne(id, tenantId);

    // Only allow deletion of pending or cancelled orders
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.CANCELLED) {
      throw new BadRequestException('Can only delete pending or cancelled orders');
    }

    return this.prisma.order.delete({
      where: { id },
    });
  }

  async deductStockForOrder(orderId: string, tenantId: string) {
    const order = await this.findOne(orderId, tenantId);

    return this.prisma.$transaction(async (tx) => {
      for (const item of order.orderItems) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (product && product.stockTracked) {
          const newStock = product.currentStock - item.quantity;

          if (newStock < 0) {
            throw new BadRequestException(
              `Insufficient stock for product: ${product.name}`
            );
          }

          await tx.product.update({
            where: { id: product.id },
            data: {
              currentStock: newStock,
              isAvailable: newStock > 0,
            },
          });

          // Create stock movement record
          await tx.stockMovement.create({
            data: {
              type: StockMovementType.OUT,
              quantity: item.quantity,
              reason: `Order ${order.orderNumber}`,
              productId: product.id,
              userId: order.userId,
              tenantId: order.tenantId,
            },
          });
        }
      }
    });
  }
}
