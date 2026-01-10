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
import { validateTransition } from '../../../common/utils/order-state-machine';
import { TableStatus } from '../../tables/dto/create-table.dto';
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

    // Validate modifiers if present
    const allModifierIds = createOrderDto.items.flatMap((item) =>
      (item.modifiers || []).map((m) => m.modifierId)
    );

    const modifiers = allModifierIds.length > 0
      ? await this.prisma.modifier.findMany({
          where: {
            id: { in: allModifierIds },
            tenantId,
            isAvailable: true,
          },
        })
      : [];

    const modifierMap = new Map(modifiers.map((m) => [m.id, m]));

    // Validate all modifiers exist
    for (const modifierId of allModifierIds) {
      if (!modifierMap.has(modifierId)) {
        throw new BadRequestException(`Modifier ${modifierId} not found or unavailable`);
      }
    }

    // Calculate totals
    let totalAmount = 0;
    const orderItems = createOrderDto.items.map((item) => {
      // Calculate modifier total for this item
      let modifierTotal = 0;
      const itemModifiers = (item.modifiers || []).map((mod) => {
        const modifier = modifierMap.get(mod.modifierId);
        const priceAdjustment = Number(modifier?.priceAdjustment || 0);
        modifierTotal += priceAdjustment * mod.quantity;
        return {
          modifierId: mod.modifierId,
          quantity: mod.quantity,
          priceAdjustment,
        };
      });

      const subtotal = item.quantity * (item.unitPrice + modifierTotal);
      totalAmount += subtotal;

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal,
        modifierTotal,
        notes: item.notes,
        modifiers: itemModifiers.length > 0 ? { create: itemModifiers } : undefined,
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
      requiresApproval: false, // POS orders don't require approval
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
            modifiers: {
              include: {
                modifier: {
                  select: {
                    id: true,
                    name: true,
                    priceAdjustment: true,
                  },
                },
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

    // Always emit to kitchen via WebSocket when order is updated
    // This ensures KDS updates even when only discount/notes/customerName change
    this.kdsGateway.emitOrderUpdated(tenantId, updatedOrder);

    return updatedOrder;
  }

  async updateStatus(id: string, updateStatusDto: UpdateOrderStatusDto, tenantId: string) {
    // Check if order exists and belongs to tenant
    const order = await this.findOne(id, tenantId);

    // Prevent status updates for orders awaiting approval (must use approve endpoint)
    if (order.requiresApproval && order.status === OrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Order requires approval before status can be changed. Please approve the order first.'
      );
    }

    // Validate state transition using state machine (STRICT mode)
    validateTransition(order.status as OrderStatus, updateStatusDto.status);

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

  async approveOrder(orderId: string, userId: string, tenantId: string) {
    // Find the order
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        tenantId,
      },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: {
              include: {
                modifier: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== OrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Order is not pending approval');
    }

    // Update order status to PENDING and set approval info
    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.PENDING,
        requiresApproval: false,
        approvedAt: new Date(),
        approvedById: userId,
      },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: {
              include: {
                modifier: {
                  include: {
                    group: true,
                  },
                },
              },
            },
          },
        },
        table: true,
        approvedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Mark table as occupied if this order has a table
    if (updatedOrder.tableId) {
      await this.prisma.table.update({
        where: { id: updatedOrder.tableId },
        data: { status: TableStatus.OCCUPIED },
      });
    }

    // Emit WebSocket events for real-time updates
    // Emit as new order for kitchen and POS systems
    this.kdsGateway.emitNewOrder(tenantId, updatedOrder);
    // Also emit update event for any listening clients
    this.kdsGateway.emitOrderUpdated(tenantId, updatedOrder);

    // CRITICAL: Notify customer if this is a QR menu order
    if (updatedOrder.sessionId) {
      this.kdsGateway.emitCustomerOrderApproved(updatedOrder.sessionId, updatedOrder);
    }

    return updatedOrder;
  }
}
