import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCustomerOrderDto } from '../dto/create-customer-order.dto';
import { CreateWaiterRequestDto, CreateBillRequestDto } from '../dto/waiter-request.dto';

@Injectable()
export class CustomerOrdersService {
  constructor(private prisma: PrismaService) {}

  // ========================================
  // CUSTOMER ORDERS
  // ========================================

  async createOrder(dto: CreateCustomerOrderDto) {
    // Verify tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Verify table exists and belongs to tenant
    const table = await this.prisma.table.findFirst({
      where: {
        id: dto.tableId,
        tenantId: dto.tenantId,
      },
    });

    if (!table) {
      throw new NotFoundException('Table not found');
    }

    // Validate products and modifiers, calculate totals
    const validatedItems = await this.validateAndCalculateItems(
      dto.items,
      dto.tenantId
    );

    const totalAmount = validatedItems.reduce(
      (sum, item) => sum + item.itemTotal,
      0
    );
    const discount = 0;
    const finalAmount = totalAmount - discount;

    // Generate order number
    const orderNumber = await this.generateOrderNumber(dto.tenantId);

    // Create order with items and modifiers
    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        tenantId: dto.tenantId,
        tableId: dto.tableId,
        sessionId: dto.sessionId,
        customerPhone: dto.customerPhone,
        status: 'PENDING_APPROVAL',
        requiresApproval: true,
        type: 'DINE_IN',
        totalAmount,
        discount,
        finalAmount,
        notes: dto.notes,
        orderItems: {
          create: validatedItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            modifierTotal: item.modifierTotal,
            subtotal: item.itemTotal,
            notes: item.notes,
            status: 'PENDING',
            modifiers: {
              create: item.modifiers.map((mod) => ({
                modifierId: mod.modifierId,
                quantity: mod.quantity,
                priceAdjustment: mod.priceAdjustment,
              })),
            },
          })),
        },
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
      },
    });

    return order;
  }

  async getSessionOrders(sessionId: string, tenantId: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        sessionId,
        tenantId,
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
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return orders;
  }

  async getOrderById(orderId: string, sessionId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        sessionId,
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

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  // ========================================
  // WAITER REQUESTS
  // ========================================

  async createWaiterRequest(dto: CreateWaiterRequestDto) {
    // Verify table exists and belongs to tenant
    const table = await this.prisma.table.findFirst({
      where: {
        id: dto.tableId,
        tenantId: dto.tenantId,
      },
    });

    if (!table) {
      throw new NotFoundException('Table not found');
    }

    return this.prisma.waiterRequest.create({
      data: {
        tableId: dto.tableId,
        sessionId: dto.sessionId,
        message: dto.message,
        status: 'PENDING',
      },
      include: {
        table: true,
      },
    });
  }

  async getSessionWaiterRequests(sessionId: string, tenantId: string) {
    // Verify session has orders for this tenant
    const orderCount = await this.prisma.order.count({
      where: {
        sessionId,
        tenantId,
      },
    });

    if (orderCount === 0) {
      throw new NotFoundException('No orders found for this session');
    }

    return this.prisma.waiterRequest.findMany({
      where: {
        sessionId,
        table: {
          tenantId,
        },
      },
      include: {
        table: true,
        acknowledgedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // ========================================
  // BILL REQUESTS
  // ========================================

  async createBillRequest(dto: CreateBillRequestDto) {
    // Verify table exists and belongs to tenant
    const table = await this.prisma.table.findFirst({
      where: {
        id: dto.tableId,
        tenantId: dto.tenantId,
      },
    });

    if (!table) {
      throw new NotFoundException('Table not found');
    }

    // Check if there's already a pending bill request for this session
    const existingRequest = await this.prisma.billRequest.findFirst({
      where: {
        sessionId: dto.sessionId,
        status: 'PENDING',
      },
    });

    if (existingRequest) {
      return existingRequest;
    }

    return this.prisma.billRequest.create({
      data: {
        tableId: dto.tableId,
        sessionId: dto.sessionId,
        status: 'PENDING',
      },
      include: {
        table: true,
      },
    });
  }

  async getSessionBillRequests(sessionId: string, tenantId: string) {
    // Verify session has orders for this tenant
    const orderCount = await this.prisma.order.count({
      where: {
        sessionId,
        tenantId,
      },
    });

    if (orderCount === 0) {
      throw new NotFoundException('No orders found for this session');
    }

    return this.prisma.billRequest.findMany({
      where: {
        sessionId,
        table: {
          tenantId,
        },
      },
      include: {
        table: true,
        acknowledgedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // ========================================
  // HELPER METHODS
  // ========================================

  private async validateAndCalculateItems(
    items: CreateCustomerOrderDto['items'],
    tenantId: string
  ) {
    const productIds = items.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId,
        isAvailable: true,
      },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products are invalid or unavailable');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    // Validate modifiers if present
    const allModifierIds = items.flatMap((item) =>
      (item.modifiers || []).map((m) => m.modifierId)
    );

    const modifiers =
      allModifierIds.length > 0
        ? await this.prisma.modifier.findMany({
            where: {
              id: { in: allModifierIds },
              tenantId,
              isAvailable: true,
            },
          })
        : [];

    const modifierMap = new Map(modifiers.map((m) => [m.id, m]));

    // Calculate totals for each item
    return items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new BadRequestException(`Product ${item.productId} not found`);
      }

      const unitPrice = Number(product.price);
      let modifierTotal = 0;
      const validatedModifiers = (item.modifiers || []).map((mod) => {
        const modifier = modifierMap.get(mod.modifierId);
        if (!modifier) {
          throw new BadRequestException(`Modifier ${mod.modifierId} not found`);
        }

        const modPrice = Number(modifier.priceAdjustment) * mod.quantity;
        modifierTotal += modPrice;

        return {
          modifierId: mod.modifierId,
          quantity: mod.quantity,
          priceAdjustment: Number(modifier.priceAdjustment),
        };
      });

      const itemTotal = (unitPrice + modifierTotal) * item.quantity;

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        modifierTotal,
        itemTotal,
        notes: item.notes,
        modifiers: validatedModifiers,
      };
    });
  }

  private async generateOrderNumber(tenantId: string): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

    const lastOrder = await this.prisma.order.findFirst({
      where: {
        tenantId,
        createdAt: {
          gte: new Date(today.setHours(0, 0, 0, 0)),
        },
      },
      orderBy: {
        orderNumber: 'desc',
      },
    });

    let sequence = 1;
    if (lastOrder && lastOrder.orderNumber) {
      const lastSequence = parseInt(lastOrder.orderNumber.split('-').pop() || '0');
      sequence = lastSequence + 1;
    }

    return `ORD-${dateStr}-${sequence.toString().padStart(4, '0')}`;
  }
}
