import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PosSettingsService } from '../../pos-settings/pos-settings.service';
import { KdsGateway } from '../../kds/kds.gateway';
import { CustomersService } from '../../customers/customers.service';
import { LoyaltyService } from '../../customers/loyalty.service';
import { CustomerSessionService } from '../../customers/customer-session.service';
import { CreateCustomerOrderDto } from '../dto/create-customer-order.dto';
import { CreateWaiterRequestDto, CreateBillRequestDto } from '../dto/waiter-request.dto';
import { OrderStatus, OrderType } from '../../../common/constants/order-status.enum';
import {
  isLocationWithinRange,
  isValidCoordinates,
} from '../../../common/utils/geolocation.util';

@Injectable()
export class CustomerOrdersService {
  constructor(
    private prisma: PrismaService,
    private posSettingsService: PosSettingsService,
    private kdsGateway: KdsGateway,
    private customersService: CustomersService,
    private loyaltyService: LoyaltyService,
    private customerSessionService: CustomerSessionService,
  ) {}

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

    // Check if customer ordering is enabled
    const posSettings = await this.posSettingsService.findByTenant(dto.tenantId);
    if (!posSettings.enableCustomerOrdering) {
      throw new ForbiddenException(
        'Customer ordering is currently disabled. Please contact staff to place your order.'
      );
    }

    // SECURITY: Validate customer location if restaurant has location configured
    if (isValidCoordinates(tenant.latitude, tenant.longitude)) {
      // Restaurant has location configured - require customer location
      if (!isValidCoordinates(dto.latitude, dto.longitude)) {
        throw new BadRequestException(
          'Konum bilgisi gerekli. Lütfen tarayıcı konum iznini etkinleştirin.'
        );
      }

      const locationCheck = isLocationWithinRange(
        dto.latitude!,
        dto.longitude!,
        tenant.latitude!,
        tenant.longitude!,
        tenant.locationRadius,
      );

      if (!locationCheck.isWithinRange) {
        throw new BadRequestException(
          `Sipariş vermek için restoran konumunda olmanız gerekiyor. Mevcut mesafe: ${locationCheck.distance}m (maksimum: ${tenant.locationRadius}m)`
        );
      }
    }

    // Determine order type based on tableId and settings
    let table = null;
    let orderType: OrderType;

    if (dto.tableId) {
      // Table-based order (DINE_IN)
      table = await this.prisma.table.findFirst({
        where: {
          id: dto.tableId,
          tenantId: dto.tenantId,
        },
      });

      if (!table) {
        throw new NotFoundException('Table not found');
      }

      orderType = dto.type || OrderType.DINE_IN;
    } else {
      // Tableless order (COUNTER) - check if enabled
      if (!posSettings.enableTablelessMode) {
        throw new BadRequestException(
          'Tableless ordering is not enabled. Please scan a table QR code to place your order.'
        );
      }

      orderType = dto.type || OrderType.COUNTER;
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

    // Link customer if phone provided
    let customerId: string | null = null;
    if (dto.customerPhone) {
      const customer = await this.customersService.findOrCreateByPhone(
        dto.customerPhone,
        dto.tenantId,
      );
      customerId = customer.id;
    }

    // Create order with items and modifiers
    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        tenantId: dto.tenantId,
        tableId: dto.tableId || null,
        sessionId: dto.sessionId,
        customerPhone: dto.customerPhone,
        customerId,
        status: OrderStatus.PENDING_APPROVAL,
        requiresApproval: true,
        type: orderType,
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

    // Emit Socket.IO events to staff (POS & Kitchen) and customer
    this.kdsGateway.emitNewOrderWithCustomer(dto.tenantId, order, dto.sessionId);

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
  // WAITER REQUESTS - STAFF METHODS
  // ========================================

  async getActiveWaiterRequests(tenantId: string) {
    return this.prisma.waiterRequest.findMany({
      where: {
        table: {
          tenantId,
        },
        status: {
          in: ['PENDING', 'ACKNOWLEDGED'],
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
        createdAt: 'asc',
      },
    });
  }

  async acknowledgeWaiterRequest(id: string, userId: string, tenantId: string) {
    const request = await this.prisma.waiterRequest.findFirst({
      where: {
        id,
        table: {
          tenantId,
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Waiter request not found');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Waiter request is not pending');
    }

    return this.prisma.waiterRequest.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
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
    });
  }

  async completeWaiterRequest(id: string, userId: string, tenantId: string) {
    const request = await this.prisma.waiterRequest.findFirst({
      where: {
        id,
        table: {
          tenantId,
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Waiter request not found');
    }

    if (request.status === 'COMPLETED') {
      throw new BadRequestException('Waiter request is already completed');
    }

    return this.prisma.waiterRequest.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        acknowledgedById: request.acknowledgedById || userId,
        acknowledgedAt: request.acknowledgedAt || new Date(),
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
  // BILL REQUESTS - STAFF METHODS
  // ========================================

  async getActiveBillRequests(tenantId: string) {
    return this.prisma.billRequest.findMany({
      where: {
        table: {
          tenantId,
        },
        status: {
          in: ['PENDING', 'ACKNOWLEDGED'],
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
        createdAt: 'asc',
      },
    });
  }

  async acknowledgeBillRequest(id: string, userId: string, tenantId: string) {
    const request = await this.prisma.billRequest.findFirst({
      where: {
        id,
        table: {
          tenantId,
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Bill request not found');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Bill request is not pending');
    }

    return this.prisma.billRequest.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
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
    });
  }

  async completeBillRequest(id: string, userId: string, tenantId: string) {
    const request = await this.prisma.billRequest.findFirst({
      where: {
        id,
        table: {
          tenantId,
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Bill request not found');
    }

    if (request.status === 'COMPLETED') {
      throw new BadRequestException('Bill request is already completed');
    }

    return this.prisma.billRequest.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        acknowledgedById: request.acknowledgedById || userId,
        acknowledgedAt: request.acknowledgedAt || new Date(),
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
      include: {
        modifierGroups: {
          include: {
            group: {
              include: {
                modifiers: {
                  where: { isAvailable: true },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products are invalid or unavailable');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    // Validate required modifier groups for each item
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) continue;

      const itemModifierIds = (item.modifiers || []).map((m) => m.modifierId);

      for (const pmg of product.modifierGroups) {
        const group = pmg.group;
        if (!group.isActive) continue;

        // Check if this group is required
        if (group.isRequired || group.minSelections > 0) {
          // Get modifier IDs that belong to this group
          const groupModifierIds = group.modifiers.map((m) => m.id);

          // Count how many modifiers from this group are selected
          const selectedCount = itemModifierIds.filter((id) =>
            groupModifierIds.includes(id)
          ).length;

          const minRequired = group.isRequired ? Math.max(1, group.minSelections) : group.minSelections;

          if (selectedCount < minRequired) {
            throw new BadRequestException(
              `Product "${product.name}" requires at least ${minRequired} selection(s) from "${group.displayName}"`
            );
          }
        }
      }
    }

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
