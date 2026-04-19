import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PosSettingsService } from '../../pos-settings/pos-settings.service';
import { KdsGateway } from '../../kds/kds.gateway';
import { CustomersService } from '../../customers/customers.service';
import { CustomerSessionService } from '../../customers/customer-session.service';
import { StockDeductionService } from '../../stock-management/services/stock-deduction.service';
import { CreateCustomerOrderDto } from '../dto/create-customer-order.dto';
import {
  CreateBillRequestDto,
  CreateWaiterRequestDto,
} from '../dto/waiter-request.dto';
import {
  OrderStatus,
  OrderType,
} from '../../../common/constants/order-status.enum';
import {
  isLocationWithinRange,
  isValidCoordinates,
} from '../../../common/utils/geolocation.util';

@Injectable()
export class CustomerOrdersService {
  private readonly logger = new Logger(CustomerOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private posSettingsService: PosSettingsService,
    private kdsGateway: KdsGateway,
    private customersService: CustomersService,
    private customerSessionService: CustomerSessionService,
    @Optional()
    @Inject(forwardRef(() => StockDeductionService))
    private stockDeductionService?: StockDeductionService,
  ) {}

  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = randomBytes(4).toString('hex').toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }

  // ========================================
  // CUSTOMER ORDERS
  // ========================================

  async createOrder(dto: CreateCustomerOrderDto) {
    // tenantId is resolved from the server-trusted session record, never
    // from the request body — mirrors the customer-public controller fix.
    const session = await this.customerSessionService.requireSession(dto.sessionId);
    const tenantId = session.tenantId;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, latitude: true, longitude: true, locationRadius: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'ACTIVE') throw new ForbiddenException('Tenant is not active');

    const posSettings = await this.posSettingsService.findByTenant(tenantId);
    if (!posSettings.enableCustomerOrdering) {
      throw new ForbiddenException(
        'Customer ordering is currently disabled. Please contact staff to place your order.',
      );
    }

    if (isValidCoordinates(tenant.latitude, tenant.longitude)) {
      if (!isValidCoordinates(dto.latitude, dto.longitude)) {
        throw new BadRequestException(
          'Konum bilgisi gerekli. Lütfen tarayıcı konum iznini etkinleştirin.',
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
          `Sipariş vermek için restoran konumunda olmanız gerekiyor. Mevcut mesafe: ${locationCheck.distance}m (maksimum: ${tenant.locationRadius}m)`,
        );
      }
    }

    let orderType: OrderType;
    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, tenantId },
        select: { id: true },
      });
      if (!table) throw new NotFoundException('Table not found');
      orderType = dto.type || OrderType.DINE_IN;
    } else {
      if (!posSettings.enableTablelessMode) {
        throw new BadRequestException(
          'Tableless ordering is not enabled. Please scan a table QR code to place your order.',
        );
      }
      orderType = dto.type || OrderType.COUNTER;
    }

    const validatedItems = await this.validateAndCalculateItems(dto.items, tenantId);

    const totalAmount = validatedItems.reduce<Prisma.Decimal>(
      (sum, i) => sum.add(i.itemTotal),
      new Prisma.Decimal(0),
    );
    const discount = new Prisma.Decimal(0);
    const finalAmount = totalAmount.sub(discount);

    let customerId: string | null = null;
    if (dto.customerPhone) {
      const customer = await this.customersService.findOrCreateByPhone(
        dto.customerPhone,
        tenantId,
      );
      customerId = customer.id;
    }

    const maxAttempts = 3;
    let lastErr: unknown;
    let createdOrder;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const orderNumber = this.generateOrderNumber();
      try {
        createdOrder = await this.prisma.order.create({
          data: {
            orderNumber,
            tenantId,
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
                  include: { modifier: { include: { group: true } } },
                },
              },
            },
            table: true,
          },
        });
        break;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          Array.isArray((err.meta as any)?.target) &&
          (err.meta as any).target.includes('orderNumber')
        ) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    if (!createdOrder) {
      this.logger.error(`Order number allocation failed: ${lastErr}`);
      throw new ConflictException('Could not allocate an order number — please retry');
    }

    this.kdsGateway.emitNewOrderWithCustomer(tenantId, createdOrder, dto.sessionId);

    // Customer orders start in PENDING_APPROVAL — stock is not deducted until
    // staff approve via OrdersService.approveOrder. We still emit a low-stock
    // signal if the tenant has configured deduction at an earlier status.
    if (this.stockDeductionService) {
      try {
        const deductResult = await this.stockDeductionService.deductForOrder(
          createdOrder.id,
          tenantId,
          OrderStatus.PENDING_APPROVAL,
        );
        if (deductResult?.lowStockAlerts?.length) {
          this.kdsGateway.emitLowStockAlert(tenantId, deductResult.lowStockAlerts);
        }
      } catch (err: any) {
        this.logger.error(
          `Stock deduction (PENDING_APPROVAL) failed for order ${createdOrder.orderNumber}: ${err.message}`,
          err.stack,
        );
      }
    }

    return createdOrder;
  }

  async getSessionOrders(sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);
    return this.prisma.order.findMany({
      where: { sessionId, tenantId: session.tenantId },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: { include: { modifier: { include: { group: true } } } },
          },
        },
        table: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getOrderById(orderId: string, sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, sessionId, tenantId: session.tenantId },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: { include: { modifier: { include: { group: true } } } },
          },
        },
        table: true,
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ========================================
  // WAITER REQUESTS
  // ========================================

  async createWaiterRequest(dto: CreateWaiterRequestDto) {
    const session = await this.customerSessionService.requireSession(dto.sessionId);
    const tenantId = session.tenantId;

    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, tenantId },
        select: { id: true },
      });
      if (!table) throw new NotFoundException('Table not found');
    }

    // Per-session 60s dedupe — matches the existing bill-request pattern and
    // prevents a customer tapping "Call waiter" 10× in 3s from creating 10 rows.
    const oneMinAgo = new Date(Date.now() - 60_000);
    const existing = await this.prisma.waiterRequest.findFirst({
      where: {
        sessionId: dto.sessionId,
        tenantId,
        status: { in: ['PENDING', 'ACKNOWLEDGED'] },
        createdAt: { gte: oneMinAgo },
      },
      include: { table: true },
    });
    if (existing) return existing;

    const waiterRequest = await this.prisma.waiterRequest.create({
      data: {
        tenantId,
        tableId: dto.tableId || null,
        sessionId: dto.sessionId,
        message: dto.message,
        status: 'PENDING',
      },
      include: { table: true },
    });

    this.kdsGateway.emitWaiterRequest(tenantId, waiterRequest);
    return waiterRequest;
  }

  async getSessionWaiterRequests(sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);
    return this.prisma.waiterRequest.findMany({
      where: { sessionId, tenantId: session.tenantId },
      include: {
        table: true,
        acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getActiveWaiterRequests(tenantId: string) {
    return this.prisma.waiterRequest.findMany({
      where: { tenantId, status: { in: ['PENDING', 'ACKNOWLEDGED'] } },
      include: {
        table: true,
        acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async acknowledgeWaiterRequest(id: string, userId: string, tenantId: string) {
    const result = await this.prisma.waiterRequest.updateMany({
      where: { id, tenantId, status: 'PENDING' },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException('Waiter request not found or already acknowledged');
    }
    const updated = await this.prisma.waiterRequest.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        table: true,
        acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    this.kdsGateway.emitWaiterRequestUpdated(tenantId, updated);
    return updated;
  }

  async completeWaiterRequest(id: string, userId: string, tenantId: string) {
    const request = await this.prisma.waiterRequest.findFirst({
      where: { id, tenantId },
    });
    if (!request) throw new NotFoundException('Waiter request not found');
    if (request.status === 'COMPLETED') {
      throw new BadRequestException('Waiter request is already completed');
    }

    const result = await this.prisma.waiterRequest.updateMany({
      where: { id, tenantId, status: { not: 'COMPLETED' } },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        acknowledgedById: request.acknowledgedById || userId,
        acknowledgedAt: request.acknowledgedAt || new Date(),
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException('Waiter request not found or already completed');
    }

    const updated = await this.prisma.waiterRequest.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        table: true,
        acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    this.kdsGateway.emitWaiterRequestUpdated(tenantId, updated);
    return updated;
  }

  // ========================================
  // BILL REQUESTS
  // ========================================

  async createBillRequest(dto: CreateBillRequestDto) {
    const session = await this.customerSessionService.requireSession(dto.sessionId);
    const tenantId = session.tenantId;

    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, tenantId },
        select: { id: true },
      });
      if (!table) throw new NotFoundException('Table not found');
    }

    const existing = await this.prisma.billRequest.findFirst({
      where: {
        sessionId: dto.sessionId,
        tenantId,
        status: { in: ['PENDING', 'ACKNOWLEDGED'] },
      },
      include: { table: true },
    });
    if (existing) return existing;

    const billRequest = await this.prisma.billRequest.create({
      data: {
        tenantId,
        tableId: dto.tableId || null,
        sessionId: dto.sessionId,
        status: 'PENDING',
      },
      include: { table: true },
    });

    this.kdsGateway.emitBillRequest(tenantId, billRequest);
    return billRequest;
  }

  async getSessionBillRequests(sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);
    return this.prisma.billRequest.findMany({
      where: { sessionId, tenantId: session.tenantId },
      include: {
        table: true,
        acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getActiveBillRequests(tenantId: string) {
    return this.prisma.billRequest.findMany({
      where: { tenantId, status: { in: ['PENDING', 'ACKNOWLEDGED'] } },
      include: {
        table: true,
        acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async acknowledgeBillRequest(id: string, userId: string, tenantId: string) {
    const result = await this.prisma.billRequest.updateMany({
      where: { id, tenantId, status: 'PENDING' },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException('Bill request not found or already acknowledged');
    }
    const updated = await this.prisma.billRequest.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        table: true,
        acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    this.kdsGateway.emitBillRequestUpdated(tenantId, updated);
    return updated;
  }

  async completeBillRequest(id: string, userId: string, tenantId: string) {
    const request = await this.prisma.billRequest.findFirst({
      where: { id, tenantId },
    });
    if (!request) throw new NotFoundException('Bill request not found');
    if (request.status === 'COMPLETED') {
      throw new BadRequestException('Bill request is already completed');
    }
    const result = await this.prisma.billRequest.updateMany({
      where: { id, tenantId, status: { not: 'COMPLETED' } },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        acknowledgedById: request.acknowledgedById || userId,
        acknowledgedAt: request.acknowledgedAt || new Date(),
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException('Bill request not found or already completed');
    }
    const updated = await this.prisma.billRequest.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        table: true,
        acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    this.kdsGateway.emitBillRequestUpdated(tenantId, updated);
    return updated;
  }

  // ========================================
  // HELPERS
  // ========================================

  private async validateAndCalculateItems(
    items: CreateCustomerOrderDto['items'],
    tenantId: string,
  ) {
    const productIds = items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId, isAvailable: true },
      include: {
        modifierGroups: {
          include: {
            group: {
              include: {
                modifiers: { where: { isAvailable: true }, select: { id: true } },
              },
            },
          },
        },
      },
    });

    // Set-based check catches both "unknown product" and "duplicated productId"
    // more correctly than length equality.
    if (products.length !== new Set(productIds).size) {
      throw new BadRequestException('One or more products are invalid or unavailable');
    }
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) continue;

      const itemModifierIds = (item.modifiers || []).map((m) => m.modifierId);
      for (const pmg of product.modifierGroups) {
        const group = pmg.group;
        if (!group.isActive) continue;
        if (group.isRequired || group.minSelections > 0) {
          const groupModifierIds = group.modifiers.map((m) => m.id);
          const selectedCount = itemModifierIds.filter((id) =>
            groupModifierIds.includes(id),
          ).length;
          const minRequired = group.isRequired
            ? Math.max(1, group.minSelections)
            : group.minSelections;
          if (selectedCount < minRequired) {
            throw new BadRequestException(
              `Product "${product.name}" requires at least ${minRequired} selection(s) from "${group.displayName}"`,
            );
          }
        }
      }
    }

    const allModifierIds = items.flatMap((i) =>
      (i.modifiers || []).map((m) => m.modifierId),
    );
    const modifiers =
      allModifierIds.length > 0
        ? await this.prisma.modifier.findMany({
            where: { id: { in: allModifierIds }, tenantId, isAvailable: true },
            select: { id: true, priceAdjustment: true },
          })
        : [];
    const modifierMap = new Map(modifiers.map((m) => [m.id, m]));

    return items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw new BadRequestException(`Product ${item.productId} not found`);

      const unitPrice = new Prisma.Decimal(product.price);
      const quantity = new Prisma.Decimal(item.quantity);
      let modifierTotal = new Prisma.Decimal(0);

      const validatedModifiers = (item.modifiers || []).map((mod) => {
        const modifier = modifierMap.get(mod.modifierId);
        if (!modifier) {
          throw new BadRequestException(`Modifier ${mod.modifierId} not found`);
        }
        const priceAdjustment = new Prisma.Decimal(modifier.priceAdjustment);
        modifierTotal = modifierTotal.add(priceAdjustment.mul(mod.quantity));
        return {
          modifierId: mod.modifierId,
          quantity: mod.quantity,
          priceAdjustment,
        };
      });

      const itemTotal = unitPrice.add(modifierTotal).mul(quantity);
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
}
