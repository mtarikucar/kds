import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderDto } from '../dto/update-order.dto';
import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';
import { TransferTableOrdersDto } from '../dto/transfer-table.dto';
import { OrderStatus, StockMovementType } from '../../../common/constants/order-status.enum';
import { validateTransition } from '../../../common/utils/order-state-machine';
import { TableStatus } from '../../tables/dto/create-table.dto';
import { Logger } from '@nestjs/common';
import { KdsGateway } from '../../kds/kds.gateway';
import { DeliveryStatusSyncService } from '../../delivery-platforms/services/delivery-status-sync.service';
import { StockDeductionService } from '../../stock-management/services/stock-deduction.service';
import { SmsNotificationService } from '../../sms-settings/sms-notification.service';
import { TaxCalculationService } from '../../accounting/services/tax-calculation.service';
import { withTransaction, addBreadcrumb } from '../../../common/utils/tracing';

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
    @Optional()
    private smsNotificationService?: SmsNotificationService,
    @Optional()
    private taxCalculationService?: TaxCalculationService,
  ) {}

  private generateOrderNumber(): string {
    const timestamp = Date.now();
    const random = randomUUID().substring(0, 8).toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }

  /**
   * Run an order-create call with retries on P2002(orderNumber). Under
   * multi-replica load two sub-ms POSTs can end up with the same Date.now()
   * + random suffix; schema unique catches it and we just roll a new
   * number. Bails with ConflictException after a handful of attempts
   * rather than looping forever.
   */
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
    this.logger.error(`Failed to allocate order number after ${maxAttempts} tries: ${lastErr}`);
    throw new BadRequestException('Could not allocate an order number — please retry');
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
        data: {
          itemCount: createOrderDto.items.length,
        },
      },
      async () => {
        addBreadcrumb('Starting order creation', 'order', {
          type: createOrderDto.type,
          itemCount: createOrderDto.items.length,
        });

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

    // Build product price map from DB (never trust client-supplied prices)
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Calculate totals with tax
    let totalAmount = 0;
    let totalTaxAmount = 0;
    const orderItems = createOrderDto.items.map((item) => {
      const product = productMap.get(item.productId);
      const serverPrice = Number(product?.price ?? 0);
      const taxRate = product?.taxRate ?? 10;

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

      const subtotal = item.quantity * (serverPrice + modifierTotal);
      totalAmount += subtotal;

      // Calculate tax for this line item (prices are KDV-inclusive)
      let itemTaxAmount = 0;
      if (this.taxCalculationService) {
        const tax = this.taxCalculationService.extractTax(subtotal, taxRate);
        itemTaxAmount = tax.taxAmount;
        totalTaxAmount += itemTaxAmount;
      }

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: serverPrice,
        subtotal,
        modifierTotal,
        taxRate,
        taxAmount: itemTaxAmount,
        notes: item.notes,
        modifiers: itemModifiers.length > 0 ? { create: itemModifiers } : undefined,
      };
    });

    const discount = createOrderDto.discount || 0;
    const finalAmount = totalAmount - discount;

    // Recalculate tax after discount (proportional)
    const discountRatio = totalAmount > 0 ? discount / totalAmount : 0;
    const adjustedTaxAmount = Math.round(totalTaxAmount * (1 - discountRatio) * 100) / 100;

    // Create order with items — wrapped in a retry so two near-simultaneous
    // POSTs that happen to mint the same orderNumber don't both 500 out.
    const createdOrder = await this.createWithOrderNumberRetry((orderNumber) => {
      const createData: any = {
        orderNumber,
        type: createOrderDto.type,
        status: OrderStatus.PENDING,
        requiresApproval: false, // POS orders don't require approval
        totalAmount,
        discount,
        finalAmount,
        taxAmount: adjustedTaxAmount,
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

      return this.prisma.order.create({
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
    });

        // Emit new order to kitchen via WebSocket
        this.kdsGateway.emitNewOrder(tenantId, createdOrder);

        // Auto-deduct ingredients if configured (respects deductOnStatus setting)
        if (this.stockDeductionService) {
          try {
            const deductResult = await this.stockDeductionService.deductForOrder(createdOrder.id, tenantId, OrderStatus.PENDING);
            if (deductResult?.lowStockAlerts?.length > 0) {
              this.kdsGateway.emitLowStockAlert(tenantId, deductResult.lowStockAlerts);
            }
          } catch (error: any) {
            this.logger.error(
              `Ingredient deduction failed for order ${createdOrder.orderNumber}: ${error.message}`,
              error.stack,
            );
          }
        }

        addBreadcrumb('Order created successfully', 'order', { orderId: createdOrder.id, orderNumber: createdOrder.orderNumber });

        // Send SMS to customer if phone available
        if (createdOrder.customerPhone && this.smsNotificationService) {
          this.smsNotificationService.notifyOrderCreated(tenantId, {
            customerPhone: createdOrder.customerPhone,
            orderNumber: createdOrder.orderNumber,
          });
        }

        return createdOrder;
      }
    );
  }

  async findAll(
    tenantId: string,
    tableId?: string,
    statuses?: OrderStatus[],
    startDate?: Date,
    endDate?: Date,
    take: number = 100,
    skip: number = 0,
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
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 500),
      skip,
    });


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

      // Fetch modifiers DB-side too — do NOT trust client-sent prices
      // or IDs. Previously modifiers were silently dropped on update(),
      // so a customer tweak that removed or reordered modifiers left the
      // bill wrong.
      const allModifierIds = updateOrderDto.items.flatMap((item) =>
        (item.modifiers || []).map((m) => m.modifierId),
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
      for (const modifierId of allModifierIds) {
        if (!modifierMap.has(modifierId)) {
          throw new BadRequestException(`Modifier ${modifierId} not found or unavailable`);
        }
      }

      // Build product price map from DB (never trust client-supplied prices)
      const productMap = new Map(products.map((p) => [p.id, p]));

      // Calculate new totals using server-side prices
      let totalAmount = 0;
      let totalTaxAmount = 0;
      const orderItems = updateOrderDto.items.map((item) => {
        const product = productMap.get(item.productId);
        const serverPrice = Number(product?.price ?? 0);
        const taxRate = product?.taxRate ?? 10;

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

        const subtotal = item.quantity * (serverPrice + modifierTotal);
        totalAmount += subtotal;

        // Calculate tax for this line item (prices are KDV-inclusive)
        let itemTaxAmount = 0;
        if (this.taxCalculationService) {
          const tax = this.taxCalculationService.extractTax(subtotal, taxRate);
          itemTaxAmount = tax.taxAmount;
          totalTaxAmount += itemTaxAmount;
        }

        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: serverPrice,
          subtotal,
          modifierTotal,
          taxRate,
          taxAmount: itemTaxAmount,
          notes: item.notes,
          modifiers: itemModifiers.length > 0 ? { create: itemModifiers } : undefined,
        };
      });

      const discount = updateOrderDto.discount !== undefined ? updateOrderDto.discount : Number(order.discount);
      const finalAmount = totalAmount - discount;

      // Recalculate tax after discount (proportional)
      const discountRatio = totalAmount > 0 ? discount / totalAmount : 0;
      const adjustedTaxAmount = Math.round(totalTaxAmount * (1 - discountRatio) * 100) / 100;

      updateData.orderItems = {
        create: orderItems,
      };
      updateData.totalAmount = totalAmount;
      updateData.discount = discount;
      updateData.finalAmount = finalAmount;
      updateData.taxAmount = adjustedTaxAmount;
    } else if (updateOrderDto.discount !== undefined) {
      // Only discount is being updated
      updateData.discount = updateOrderDto.discount;
      updateData.finalAmount = Number(order.totalAmount) - updateOrderDto.discount;
    }

    // Atomic replace of the item set: a crash between the deleteMany
    // and the nested create previously produced empty orders. Same tx
    // covers the order.update so a validation failure doesn't leave
    // the order without its items.
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      if (updateData.orderItems) {
        await tx.orderItem.deleteMany({ where: { orderId: id } });
      }
      return tx.order.update({
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
    });

    // Always emit to kitchen via WebSocket when order is updated
    // This ensures KDS updates even when only discount/notes/customerName change
    this.kdsGateway.emitOrderUpdated(tenantId, updatedOrder);

    return updatedOrder;
  }

  async updateStatus(id: string, updateStatusDto: UpdateOrderStatusDto, tenantId: string) {
    // Use transaction to prevent race conditions on status transitions
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Check if order exists and belongs to tenant
      const order = await tx.order.findFirst({
        where: { id, tenantId },
        include: {
          orderItems: { include: { product: true } },
          table: true,
        },
      });

      if (!order) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      // Prevent status updates for orders awaiting approval (must use approve endpoint)
      if (order.requiresApproval && order.status === OrderStatus.PENDING_APPROVAL) {
        throw new BadRequestException(
          'Order requires approval before status can be changed. Please approve the order first.'
        );
      }

      // Validate state transition using state machine (STRICT mode)
      validateTransition(order.status as OrderStatus, updateStatusDto.status);

      // Build update data with status timestamps
      const statusUpdateData: any = { status: updateStatusDto.status };
      if (updateStatusDto.status === OrderStatus.PREPARING) statusUpdateData.preparingAt = new Date();
      if (updateStatusDto.status === OrderStatus.READY) statusUpdateData.readyAt = new Date();

      const updated = await tx.order.update({
        where: { id },
        data: statusUpdateData,
        include: {
          orderItems: { include: { product: true } },
          table: true,
        },
      });

      // Ensure table status is synced with order status
      if (updated.tableId) {
        const activeStatuses = [
          OrderStatus.PENDING,
          OrderStatus.PREPARING,
          OrderStatus.READY,
          OrderStatus.SERVED,
        ];

        if (activeStatuses.includes(updateStatusDto.status as OrderStatus)) {
          await tx.table.update({
            where: { id: updated.tableId },
            data: { status: TableStatus.OCCUPIED },
          });
        } else if (
          updateStatusDto.status === OrderStatus.PAID ||
          updateStatusDto.status === OrderStatus.CANCELLED
        ) {
          const activeOrdersCount = await tx.order.count({
            where: {
              tableId: updated.tableId,
              id: { not: id },
              status: { in: activeStatuses },
            },
          });

          if (activeOrdersCount === 0) {
            await tx.table.update({
              where: { id: updated.tableId },
              data: { status: TableStatus.AVAILABLE },
            });
          }
        }
      }

      return updated;
    });

    // Reverse ingredient deductions on cancellation
    if (updateStatusDto.status === OrderStatus.CANCELLED && this.stockDeductionService) {
      try {
        await this.stockDeductionService.reverseForOrder(id, tenantId);
      } catch (error: any) {
        this.logger.error(
          `CRITICAL: Stock reversal failed for cancelled order ${id}. Manual stock adjustment may be needed. Error: ${error.message}`,
          error.stack,
        );
        this.kdsGateway.emitLowStockAlert(tenantId, [`Stock reversal failed for order ${updatedOrder.orderNumber}. Please verify inventory.`]);
      }
    }

    // Auto-deduct ingredients on status change (respects deductOnStatus setting)
    if (this.stockDeductionService && updateStatusDto.status !== OrderStatus.CANCELLED) {
      try {
        const deductResult = await this.stockDeductionService.deductForOrder(id, tenantId, updateStatusDto.status);
        if (deductResult?.lowStockAlerts?.length > 0) {
          this.kdsGateway.emitLowStockAlert(tenantId, deductResult.lowStockAlerts);
        }
      } catch (error: any) {
        this.logger.error(
          `Ingredient deduction failed for order ${id} on status ${updateStatusDto.status}: ${error.message}`,
          error.stack,
        );
      }
    }

    // Emit status change via WebSocket
    this.kdsGateway.emitOrderStatusChange(tenantId, id, updateStatusDto.status);

    // Sync status to delivery platform (if applicable)
    this.deliveryStatusSync?.syncStatusToPlatform(id, updateStatusDto.status).catch((err) => {
      this.logger.error(`Delivery platform sync failed for order ${id}: ${err.message}`);
    });

    // Send SMS to customer on key status changes
    if (updatedOrder.customerPhone && this.smsNotificationService) {
      if (updateStatusDto.status === OrderStatus.PREPARING) {
        this.smsNotificationService.notifyOrderPreparing(tenantId, {
          customerPhone: updatedOrder.customerPhone,
          orderNumber: updatedOrder.orderNumber,
        });
      } else if (updateStatusDto.status === OrderStatus.READY) {
        this.smsNotificationService.notifyOrderReady(tenantId, {
          customerPhone: updatedOrder.customerPhone,
          orderNumber: updatedOrder.orderNumber,
        });
      } else if (updateStatusDto.status === OrderStatus.CANCELLED) {
        this.smsNotificationService.notifyOrderCancelled(tenantId, {
          customerPhone: updatedOrder.customerPhone,
          orderNumber: updatedOrder.orderNumber,
        });
      }
    }

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

    // Sync approval to delivery platform (accepts the order on the platform)
    this.deliveryStatusSync?.syncStatusToPlatform(orderId, OrderStatus.PENDING).catch((err) => {
      this.logger.error(`Delivery platform sync failed for order ${orderId}: ${err.message}`);
    });

    // Send SMS to customer
    if (updatedOrder.customerPhone && this.smsNotificationService) {
      this.smsNotificationService.notifyOrderApproved(tenantId, {
        customerPhone: updatedOrder.customerPhone,
        orderNumber: updatedOrder.orderNumber,
      });
    }

    return updatedOrder;
  }

  async transferTableOrders(dto: TransferTableOrdersDto, tenantId: string) {
    const { sourceTableId, targetTableId, allowMerge = true } = dto;

    // Validate: source and target cannot be the same
    if (sourceTableId === targetTableId) {
      throw new BadRequestException('Source and target tables cannot be the same');
    }

    // Validate source table exists and belongs to tenant
    const sourceTable = await this.prisma.table.findFirst({
      where: { id: sourceTableId, tenantId },
    });

    if (!sourceTable) {
      throw new NotFoundException('Source table not found');
    }

    // Validate target table exists and belongs to tenant
    const targetTable = await this.prisma.table.findFirst({
      where: { id: targetTableId, tenantId },
    });

    if (!targetTable) {
      throw new NotFoundException('Target table not found');
    }

    // Cannot transfer to a RESERVED table
    if (targetTable.status === TableStatus.RESERVED) {
      throw new BadRequestException('Cannot transfer orders to a reserved table');
    }

    // Check if target table has active orders (occupied)
    if (targetTable.status === TableStatus.OCCUPIED && !allowMerge) {
      throw new BadRequestException('Target table has active orders. Set allowMerge to true to merge orders.');
    }

    // Find active orders on source table (exclude PAID, CANCELLED, PENDING_APPROVAL)
    const activeOrders = await this.prisma.order.findMany({
      where: {
        tableId: sourceTableId,
        tenantId,
        status: {
          notIn: [OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.PENDING_APPROVAL],
        },
      },
      include: {
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
        table: { select: { id: true, number: true, section: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (activeOrders.length === 0) {
      throw new BadRequestException('No active orders found on source table');
    }

    // Perform the transfer in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Update all active orders to the new table
      await tx.order.updateMany({
        where: {
          id: { in: activeOrders.map((o) => o.id) },
        },
        data: {
          tableId: targetTableId,
        },
      });

      // Update source table to AVAILABLE
      await tx.table.update({
        where: { id: sourceTableId },
        data: { status: TableStatus.AVAILABLE },
      });

      // Update target table to OCCUPIED
      await tx.table.update({
        where: { id: targetTableId },
        data: { status: TableStatus.OCCUPIED },
      });

      // Fetch updated orders with new table info
      const updatedOrders = await tx.order.findMany({
        where: {
          id: { in: activeOrders.map((o) => o.id) },
        },
        include: {
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
          table: { select: { id: true, number: true, section: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      return updatedOrders;
    });

    // Emit WebSocket event for table transfer
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
   * Tables with active orders (PENDING, PREPARING, READY, SERVED) should be OCCUPIED.
   * Tables with no active orders should be AVAILABLE (unless RESERVED).
   */
  async syncTableStatuses(tenantId: string) {
    const activeStatuses = [
      OrderStatus.PENDING,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.SERVED,
    ];

    // Get all tables for this tenant
    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      select: { id: true, number: true, status: true },
    });

    // Single aggregation query: count active orders per table (eliminates N+1)
    const activeOrderCounts = await this.prisma.order.groupBy({
      by: ['tableId'],
      where: {
        tenantId,
        status: { in: activeStatuses },
        tableId: { not: null },
      },
      _count: { id: true },
    });

    const activeCountMap = new Map(
      activeOrderCounts.map((r) => [r.tableId, r._count.id]),
    );

    const updates: { tableId: string; tableNumber: string; oldStatus: string; newStatus: string }[] = [];

    for (const table of tables) {
      // Skip reserved tables
      if (table.status === TableStatus.RESERVED) {
        continue;
      }

      const activeCount = activeCountMap.get(table.id) || 0;
      const expectedStatus = activeCount > 0 ? TableStatus.OCCUPIED : TableStatus.AVAILABLE;

      if (table.status !== expectedStatus) {
        await this.prisma.table.update({
          where: { id: table.id },
          data: { status: expectedStatus },
        });

        updates.push({
          tableId: table.id,
          tableNumber: table.number,
          oldStatus: table.status,
          newStatus: expectedStatus,
        });
      }
    }

    return {
      message: `Synced ${updates.length} table(s)`,
      updates,
    };
  }
}
