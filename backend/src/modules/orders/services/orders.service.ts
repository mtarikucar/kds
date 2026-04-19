import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Optional,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderDto } from '../dto/update-order.dto';
import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';
import { TransferTableOrdersDto } from '../dto/transfer-table.dto';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import { validateTransition } from '../../../common/utils/order-state-machine';
import { TableStatus } from '../../tables/dto/create-table.dto';
import { KdsGateway } from '../../kds/kds.gateway';
import { DeliveryStatusSyncService } from '../../delivery-platforms/services/delivery-status-sync.service';
import { StockDeductionService } from '../../stock-management/services/stock-deduction.service';
import { withTransaction, addBreadcrumb } from '../../../common/utils/tracing';

const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.SERVED,
];

const ORDER_WITH_RELATIONS = {
  orderItems: {
    include: {
      product: {
        select: { id: true, name: true, price: true, image: true },
      },
      modifiers: {
        include: {
          modifier: {
            select: { id: true, name: true, priceAdjustment: true },
          },
        },
      },
    },
  },
  table: {
    select: { id: true, number: true, section: true },
  },
  user: {
    select: { id: true, firstName: true, lastName: true },
  },
} as const;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => KdsGateway))
    private kdsGateway: KdsGateway,
    @Optional()
    @Inject(forwardRef(() => DeliveryStatusSyncService))
    private deliveryStatusSync?: DeliveryStatusSyncService,
    @Optional()
    @Inject(forwardRef(() => StockDeductionService))
    private stockDeductionService?: StockDeductionService,
  ) {}

  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = randomBytes(4).toString('hex').toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }

  private async createWithOrderNumberRetry<T>(
    op: (orderNumber: string) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await op(this.generateOrderNumber());
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
    throw lastErr;
  }

  async create(createOrderDto: CreateOrderDto, userId: string, tenantId: string) {
    return withTransaction(
      {
        name: 'order.create',
        op: 'order',
        tags: {
          'order.type': createOrderDto.type,
          'tenant.id': tenantId,
          'user.id': userId,
          'has_table': String(!!createOrderDto.tableId),
        },
        data: { itemCount: createOrderDto.items.length },
      },
      async () => {
        addBreadcrumb('Starting order creation', 'order', {
          type: createOrderDto.type,
          itemCount: createOrderDto.items.length,
        });

        if (createOrderDto.tableId) {
          const table = await this.prisma.table.findFirst({
            where: { id: createOrderDto.tableId, tenantId },
            select: { id: true },
          });
          if (!table) {
            throw new BadRequestException('Invalid table or table does not belong to your tenant');
          }
        }

        const productIds = createOrderDto.items.map((i) => i.productId);
        const products = await this.prisma.product.findMany({
          where: { id: { in: productIds }, tenantId },
          select: { id: true, name: true, price: true, isAvailable: true },
        });
        if (products.length !== new Set(productIds).size) {
          throw new BadRequestException('One or more products are invalid or do not belong to your tenant');
        }
        const productMap = new Map(products.map((p) => [p.id, p]));
        const unavailable = products.filter((p) => !p.isAvailable);
        if (unavailable.length > 0) {
          throw new BadRequestException(
            `Products not available: ${unavailable.map((p) => p.name).join(', ')}`,
          );
        }

        const allModifierIds = createOrderDto.items.flatMap((i) =>
          (i.modifiers || []).map((m) => m.modifierId),
        );
        const modifiers = allModifierIds.length > 0
          ? await this.prisma.modifier.findMany({
              where: { id: { in: allModifierIds }, tenantId, isAvailable: true },
              select: { id: true, priceAdjustment: true },
            })
          : [];
        const modifierMap = new Map(modifiers.map((m) => [m.id, m]));
        for (const modifierId of allModifierIds) {
          if (!modifierMap.has(modifierId)) {
            throw new BadRequestException(`Modifier ${modifierId} not found or unavailable`);
          }
        }

        let totalAmount = new Prisma.Decimal(0);
        const orderItems: Prisma.OrderItemCreateWithoutOrderInput[] = createOrderDto.items.map((item) => {
          const product = productMap.get(item.productId)!;
          const unitPrice = new Prisma.Decimal(product.price);
          const quantity = new Prisma.Decimal(item.quantity);

          let modifierTotal = new Prisma.Decimal(0);
          const itemModifiers = (item.modifiers || []).map((mod) => {
            const modifier = modifierMap.get(mod.modifierId)!;
            const priceAdjustment = new Prisma.Decimal(modifier.priceAdjustment);
            modifierTotal = modifierTotal.add(priceAdjustment.mul(mod.quantity));
            return {
              quantity: mod.quantity,
              priceAdjustment,
              modifier: { connect: { id: mod.modifierId } },
            };
          });

          const subtotal = unitPrice.add(modifierTotal).mul(quantity);
          totalAmount = totalAmount.add(subtotal);

          return {
            quantity: item.quantity,
            unitPrice,
            subtotal,
            modifierTotal,
            notes: item.notes,
            product: { connect: { id: item.productId } },
            modifiers: itemModifiers.length > 0 ? { create: itemModifiers } : undefined,
          };
        });

        const discount = new Prisma.Decimal(createOrderDto.discount ?? 0);
        const finalAmount = totalAmount.sub(discount);
        if (finalAmount.isNegative()) {
          throw new BadRequestException('Discount cannot exceed order total');
        }

        const createdOrder = await this.createWithOrderNumberRetry((orderNumber) =>
          this.prisma.$transaction(async (tx) => {
            const base: Prisma.OrderCreateInput = {
              orderNumber,
              type: createOrderDto.type,
              status: OrderStatus.PENDING,
              requiresApproval: false,
              totalAmount,
              discount,
              finalAmount,
              notes: createOrderDto.notes,
              customerName: createOrderDto.customerName,
              user: { connect: { id: userId } },
              tenant: { connect: { id: tenantId } },
              orderItems: { create: orderItems },
              ...(createOrderDto.tableId
                ? { table: { connect: { id: createOrderDto.tableId } } }
                : {}),
            };

            return tx.order.create({
              data: base,
              include: ORDER_WITH_RELATIONS,
            });
          }),
        );

        this.kdsGateway.emitNewOrder(tenantId, createdOrder);

        if (this.stockDeductionService) {
          try {
            const deductResult = await this.stockDeductionService.deductForOrder(
              createdOrder.id,
              tenantId,
              OrderStatus.PENDING,
            );
            if (deductResult?.lowStockAlerts?.length) {
              this.kdsGateway.emitLowStockAlert(tenantId, deductResult.lowStockAlerts);
            }
          } catch (error: any) {
            this.logger.error(
              `Ingredient deduction failed for order ${createdOrder.orderNumber}: ${error.message}`,
              error.stack,
            );
          }
        }

        addBreadcrumb('Order created successfully', 'order', {
          orderId: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
        });
        return createdOrder;
      },
    );
  }

  async findAll(
    tenantId: string,
    tableId?: string,
    statuses?: OrderStatus[],
    startDate?: Date,
    endDate?: Date,
    page = 1,
    limit = 100,
  ) {
    const where: Prisma.OrderWhereInput = { tenantId };
    if (tableId) where.tableId = tableId;
    if (statuses && statuses.length > 0) {
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }

    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const safePage = Math.max(page, 1);

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: { ...ORDER_WITH_RELATIONS, payments: true },
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data: orders, total, page: safePage, pageSize: safeLimit };
  }

  async findOne(id: string, tenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: { ...ORDER_WITH_RELATIONS, payments: true },
    });
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }
    return order;
  }

  async update(id: string, updateOrderDto: UpdateOrderDto, tenantId: string) {
    const order = await this.findOne(id, tenantId);
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot update paid or cancelled orders');
    }

    const wantsItems = updateOrderDto.items && updateOrderDto.items.length > 0;
    let productMap = new Map<string, { id: string; price: Prisma.Decimal; isAvailable: boolean; name: string }>();
    let modifierMap = new Map<string, { id: string; priceAdjustment: Prisma.Decimal }>();

    if (wantsItems) {
      const productIds = updateOrderDto.items!.map((i) => i.productId);
      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds }, tenantId },
        select: { id: true, name: true, price: true, isAvailable: true },
      });
      if (products.length !== new Set(productIds).size) {
        throw new BadRequestException('One or more products are invalid or do not belong to your tenant');
      }
      const unavailable = products.filter((p) => !p.isAvailable);
      if (unavailable.length > 0) {
        throw new BadRequestException(
          `Products not available: ${unavailable.map((p) => p.name).join(', ')}`,
        );
      }
      productMap = new Map(
        products.map((p) => [p.id, { ...p, price: new Prisma.Decimal(p.price) }]),
      );

      const allModifierIds = updateOrderDto.items!.flatMap((i) =>
        (i.modifiers || []).map((m) => m.modifierId),
      );
      const modifiers = allModifierIds.length > 0
        ? await this.prisma.modifier.findMany({
            where: { id: { in: allModifierIds }, tenantId, isAvailable: true },
            select: { id: true, priceAdjustment: true },
          })
        : [];
      modifierMap = new Map(
        modifiers.map((m) => [m.id, { ...m, priceAdjustment: new Prisma.Decimal(m.priceAdjustment) }]),
      );
      for (const modId of allModifierIds) {
        if (!modifierMap.has(modId)) {
          throw new BadRequestException(`Modifier ${modId} not found or unavailable`);
        }
      }
    }

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.OrderUpdateInput = {
        notes: updateOrderDto.notes,
        customerName: updateOrderDto.customerName,
      };

      if (wantsItems) {
        let totalAmount = new Prisma.Decimal(0);
        const orderItems: Prisma.OrderItemCreateWithoutOrderInput[] = updateOrderDto.items!.map((item) => {
          const product = productMap.get(item.productId)!;
          const quantity = new Prisma.Decimal(item.quantity);
          let modifierTotal = new Prisma.Decimal(0);
          const itemModifiers = (item.modifiers || []).map((mod) => {
            const modifier = modifierMap.get(mod.modifierId)!;
            const priceAdjustment = modifier.priceAdjustment;
            modifierTotal = modifierTotal.add(priceAdjustment.mul(mod.quantity));
            return {
              quantity: mod.quantity,
              priceAdjustment,
              modifier: { connect: { id: mod.modifierId } },
            };
          });
          const subtotal = product.price.add(modifierTotal).mul(quantity);
          totalAmount = totalAmount.add(subtotal);
          return {
            quantity: item.quantity,
            unitPrice: product.price,
            subtotal,
            modifierTotal,
            notes: item.notes,
            product: { connect: { id: item.productId } },
            modifiers: itemModifiers.length > 0 ? { create: itemModifiers } : undefined,
          };
        });

        const discount =
          updateOrderDto.discount !== undefined
            ? new Prisma.Decimal(updateOrderDto.discount)
            : new Prisma.Decimal(order.discount);
        const finalAmount = totalAmount.sub(discount);
        if (finalAmount.isNegative()) {
          throw new BadRequestException('Discount cannot exceed order total');
        }

        await tx.orderItem.deleteMany({ where: { orderId: id } });
        data.orderItems = { create: orderItems };
        data.totalAmount = totalAmount;
        data.discount = discount;
        data.finalAmount = finalAmount;
      } else if (updateOrderDto.discount !== undefined) {
        const discount = new Prisma.Decimal(updateOrderDto.discount);
        const finalAmount = new Prisma.Decimal(order.totalAmount).sub(discount);
        if (finalAmount.isNegative()) {
          throw new BadRequestException('Discount cannot exceed order total');
        }
        data.discount = discount;
        data.finalAmount = finalAmount;
      }

      const result = await tx.order.updateMany({
        where: { id, tenantId },
        data: data as Prisma.OrderUpdateManyMutationInput,
      });
      if (result.count !== 1) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      if (wantsItems) {
        // updateMany skips nested writes, so re-run the nested-create path
        // via a scoped update after tenant has been asserted above.
        await tx.order.update({
          where: { id },
          data: { orderItems: { create: data.orderItems!['create'] } },
        });
      }

      return tx.order.findFirst({
        where: { id, tenantId },
        include: ORDER_WITH_RELATIONS,
      });
    });

    this.kdsGateway.emitOrderUpdated(tenantId, updatedOrder);
    return updatedOrder;
  }

  async updateStatus(id: string, updateStatusDto: UpdateOrderStatusDto, tenantId: string) {
    const order = await this.findOne(id, tenantId);

    if (order.requiresApproval && order.status === OrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Order requires approval before status can be changed. Please approve the order first.',
      );
    }

    validateTransition(order.status as OrderStatus, updateStatusDto.status);

    const statusUpdateData: Prisma.OrderUpdateManyMutationInput = { status: updateStatusDto.status };
    if (updateStatusDto.status === OrderStatus.PREPARING) statusUpdateData.preparingAt = new Date();
    if (updateStatusDto.status === OrderStatus.READY) statusUpdateData.readyAt = new Date();

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id, tenantId },
        data: statusUpdateData,
      });
      if (result.count !== 1) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      const fresh = await tx.order.findFirstOrThrow({
        where: { id, tenantId },
        include: { orderItems: { include: { product: true } }, table: true },
      });

      if (fresh.tableId) {
        const isActive = ACTIVE_ORDER_STATUSES.includes(updateStatusDto.status);
        const isClosing =
          updateStatusDto.status === OrderStatus.PAID ||
          updateStatusDto.status === OrderStatus.CANCELLED;

        if (isActive) {
          await tx.table.updateMany({
            where: { id: fresh.tableId, tenantId },
            data: { status: TableStatus.OCCUPIED },
          });
        } else if (isClosing) {
          const stillActive = await tx.order.count({
            where: {
              tenantId,
              tableId: fresh.tableId,
              id: { not: id },
              status: { in: ACTIVE_ORDER_STATUSES },
            },
          });
          if (stillActive === 0) {
            await tx.table.updateMany({
              where: { id: fresh.tableId, tenantId, status: { not: TableStatus.RESERVED } },
              data: { status: TableStatus.AVAILABLE },
            });
          }
        }
      }

      return fresh;
    });

    if (updateStatusDto.status === OrderStatus.CANCELLED && this.stockDeductionService) {
      try {
        await this.stockDeductionService.reverseForOrder(id, tenantId);
      } catch (error: any) {
        this.logger.error(
          `CRITICAL: Stock reversal failed for cancelled order ${id}. Manual stock adjustment may be needed. Error: ${error.message}`,
          error.stack,
        );
        this.kdsGateway.emitLowStockAlert(tenantId, [
          `Stock reversal failed for order ${updatedOrder.orderNumber}. Please verify inventory.`,
        ]);
      }
    }

    if (this.stockDeductionService && updateStatusDto.status !== OrderStatus.CANCELLED) {
      try {
        const deductResult = await this.stockDeductionService.deductForOrder(
          id,
          tenantId,
          updateStatusDto.status,
        );
        if (deductResult?.lowStockAlerts?.length) {
          this.kdsGateway.emitLowStockAlert(tenantId, deductResult.lowStockAlerts);
        }
      } catch (error: any) {
        this.logger.error(
          `Ingredient deduction failed for order ${id} on status ${updateStatusDto.status}: ${error.message}`,
          error.stack,
        );
      }
    }

    this.kdsGateway.emitOrderStatusChange(tenantId, id, updateStatusDto.status);

    this.deliveryStatusSync?.syncStatusToPlatform(id, updateStatusDto.status).catch((err) => {
      this.logger.error(`Delivery platform sync failed for order ${id}: ${err.message}`);
    });

    return updatedOrder;
  }

  async remove(id: string, tenantId: string) {
    const order = await this.findOne(id, tenantId);
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.CANCELLED) {
      throw new BadRequestException('Can only delete pending or cancelled orders');
    }
    const result = await this.prisma.order.deleteMany({ where: { id, tenantId } });
    if (result.count !== 1) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }
    return { id, deleted: true };
  }

  async approveOrder(orderId: string, userId: string, tenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Order is not pending approval');
    }

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: orderId, tenantId, status: OrderStatus.PENDING_APPROVAL },
        data: {
          status: OrderStatus.PENDING,
          requiresApproval: false,
          approvedAt: new Date(),
          approvedById: userId,
        },
      });
      if (result.count !== 1) {
        throw new BadRequestException('Order is not pending approval');
      }

      const fresh = await tx.order.findFirstOrThrow({
        where: { id: orderId, tenantId },
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

      if (fresh.tableId) {
        await tx.table.updateMany({
          where: { id: fresh.tableId, tenantId },
          data: { status: TableStatus.OCCUPIED },
        });
      }

      return fresh;
    });

    this.kdsGateway.emitNewOrder(tenantId, updatedOrder);
    this.kdsGateway.emitOrderUpdated(tenantId, updatedOrder);
    if (updatedOrder.sessionId) {
      this.kdsGateway.emitCustomerOrderApproved(updatedOrder.sessionId, updatedOrder);
    }
    this.deliveryStatusSync?.syncStatusToPlatform(orderId, OrderStatus.PENDING).catch((err) => {
      this.logger.error(`Delivery platform sync failed for order ${orderId}: ${err.message}`);
    });

    return updatedOrder;
  }

  async transferTableOrders(dto: TransferTableOrdersDto, tenantId: string) {
    const { sourceTableId, targetTableId, allowMerge = true } = dto;

    if (sourceTableId === targetTableId) {
      throw new BadRequestException('Source and target tables cannot be the same');
    }

    const [sourceTable, targetTable] = await Promise.all([
      this.prisma.table.findFirst({ where: { id: sourceTableId, tenantId } }),
      this.prisma.table.findFirst({ where: { id: targetTableId, tenantId } }),
    ]);

    if (!sourceTable) throw new NotFoundException('Source table not found');
    if (!targetTable) throw new NotFoundException('Target table not found');

    if (targetTable.status === TableStatus.RESERVED) {
      throw new BadRequestException('Cannot transfer orders to a reserved table');
    }
    if (targetTable.status === TableStatus.OCCUPIED && !allowMerge) {
      throw new BadRequestException(
        'Target table has active orders. Set allowMerge to true to merge orders.',
      );
    }

    const activeOrders = await this.prisma.order.findMany({
      where: {
        tableId: sourceTableId,
        tenantId,
        status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.PENDING_APPROVAL] },
      },
      include: ORDER_WITH_RELATIONS,
    });

    if (activeOrders.length === 0) {
      throw new BadRequestException('No active orders found on source table');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const orderIds = activeOrders.map((o) => o.id);

      await tx.order.updateMany({
        where: { id: { in: orderIds }, tenantId },
        data: { tableId: targetTableId },
      });
      await tx.table.updateMany({
        where: { id: sourceTableId, tenantId },
        data: { status: TableStatus.AVAILABLE },
      });
      await tx.table.updateMany({
        where: { id: targetTableId, tenantId },
        data: { status: TableStatus.OCCUPIED },
      });

      return tx.order.findMany({
        where: { id: { in: orderIds }, tenantId },
        include: ORDER_WITH_RELATIONS,
      });
    });

    this.kdsGateway.emitTableTransfer(tenantId, {
      sourceTableId,
      targetTableId,
      sourceTableNumber: sourceTable.number,
      targetTableNumber: targetTable.number,
      orders: result,
      transferredCount: result.length,
    });

    return {
      message: `Successfully transferred ${result.length} order(s) from table ${sourceTable.number} to table ${targetTable.number}`,
      transferredOrders: result,
      sourceTable: { id: sourceTableId, number: sourceTable.number, newStatus: TableStatus.AVAILABLE },
      targetTable: { id: targetTableId, number: targetTable.number, newStatus: TableStatus.OCCUPIED },
    };
  }

  /**
   * Sync all table statuses based on their active orders.
   * Tables with active orders should be OCCUPIED; tables with no active
   * orders should be AVAILABLE (unless RESERVED). Runs two bulk updates
   * per tenant instead of one query per table.
   */
  async syncTableStatuses(tenantId: string) {
    const grouped = await this.prisma.order.groupBy({
      by: ['tableId'],
      where: {
        tenantId,
        tableId: { not: null },
        status: { in: ACTIVE_ORDER_STATUSES },
      },
      _count: { _all: true },
    });

    const occupiedTableIds = grouped
      .map((g) => g.tableId)
      .filter((id): id is string => !!id);

    const [toOccupied, toAvailable] = await this.prisma.$transaction([
      this.prisma.table.updateMany({
        where: {
          tenantId,
          id: { in: occupiedTableIds },
          status: { notIn: [TableStatus.OCCUPIED, TableStatus.RESERVED] },
        },
        data: { status: TableStatus.OCCUPIED },
      }),
      this.prisma.table.updateMany({
        where: {
          tenantId,
          id: { notIn: occupiedTableIds.length > 0 ? occupiedTableIds : ['__none__'] },
          status: TableStatus.OCCUPIED,
        },
        data: { status: TableStatus.AVAILABLE },
      }),
    ]);

    const total = toOccupied.count + toAvailable.count;
    return {
      message: `Synced ${total} table(s)`,
      occupied: toOccupied.count,
      freed: toAvailable.count,
    };
  }
}
