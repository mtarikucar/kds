import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
import { ReceiptSnapshotBuilder } from './receipt-snapshot.builder';
import { ReservationStatus } from '../../reservations/constants/reservation-status.enum';
import { OutboxService } from '../../outbox/outbox.service';

/**
 * Walk-in (POST /orders) guard window: refuse to open a new order on
 * a table whose next CONFIRMED reservation starts within this many
 * minutes. Matches the reservation-scheduler's auto-RESERVED window so
 * the two systems agree on "what counts as imminent".
 */
const RESERVATION_HOLD_WINDOW_MINUTES = 30;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private receiptSnapshotBuilder: ReceiptSnapshotBuilder,
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
    // OutboxModule is @Global — Optional() because tests construct the
    // service directly without an outbox mock. When absent, emits silently
    // no-op (kds-routing falls back to the existing kdsGateway broadcast).
    @Optional()
    private outbox?: OutboxService,
  ) {}

  /**
   * Best-effort outbox emit so the new device-mesh KDS routing (and any
   * future consumer) sees the order lifecycle. Failures are swallowed so a
   * misconfigured outbox never breaks order creation — the existing
   * kdsGateway Socket.IO path continues to power the live KDS UI.
   */
  private emitOrderEvent(type: 'order.created.v1' | 'order.updated.v1' | 'order.completed.v1' | 'order.cancelled.v1', order: any): void {
    if (!this.outbox) return;
    this.outbox
      .append({
        type,
        tenantId: order?.tenantId,
        payload: {
          orderId: order?.id,
          tenantId: order?.tenantId,
          branchId: (order as any)?.branchId ?? null,
          tableId: order?.tableId ?? null,
          status: order?.status,
          // finalAmount lands here as a Prisma.Decimal (DB type) almost
          // always, so the previous `typeof === 'number'` check was always
          // false and `totalCents` came out undefined. Normalise via
          // String() → integer cents to dodge the IEEE-754 conversion that
          // would otherwise lose precision on large orders.
          totalCents: this.toIntCents(order?.finalAmount),
        },
      })
      .catch((e) => this.logger.warn(`outbox emit ${type} failed: ${(e as Error).message}`));
  }

  /**
   * Convert any of {number, Prisma.Decimal, string} → integer cents.
   *
   * Why this exists: Prisma.Decimal columns deserialise to Decimal objects
   * whose `*100 → Math.round` path goes through IEEE-754, dropping precision
   * for large amounts and quietly losing the kuruş on edge values. The
   * Decimal API exposes `.toFixed(2)` which renders the canonical 2-dp
   * string; we then strip the decimal point and parse, never crossing the
   * float boundary.
   */
  private toIntCents(v: unknown): number | undefined {
    if (v == null) return undefined;
    // Decimal has a toFixed; number doesn't. Detect by feature instead of
    // by `instanceof Decimal` so the helper works in test fixtures that
    // pass plain numbers.
    const asDecimal = (v as { toFixed?: (n: number) => string });
    if (typeof asDecimal.toFixed === 'function' && typeof v !== 'number') {
      const fixed = asDecimal.toFixed!(2);                 // "123.45"
      const cents = Number(fixed.replace('.', ''));         // 12345
      return Number.isFinite(cents) ? cents : undefined;
    }
    if (typeof v === 'number') return Math.round(v * 100);
    if (typeof v === 'string') {
      const cents = Math.round(parseFloat(v) * 100);
      return Number.isFinite(cents) ? cents : undefined;
    }
    return undefined;
  }

  /**
   * Block a destructive operation (item-set rewrite, item delete,
   * order cancel) while a customer is mid-PayTR on this order. The
   * customer's intent.itemsByOrder JSON snapshot is keyed on the
   * current OrderItem ids; deleting them would orphan the intent
   * and the webhook would fail post-charge — PayTR took the money,
   * we couldn't book it, manual refund required.
   *
   * If `targetOrderItemId` is given, only blocks when THAT item
   * appears in any pending intent's itemsByOrder. Otherwise any
   * pending intent on the order blocks.
   */
  private async ensureNoInFlightSelfPayIntent(
    tx: Prisma.TransactionClient,
    orderId: string,
    tenantId: string,
    targetOrderItemId?: string,
  ): Promise<void> {
    const pendingIntents = await tx.pendingSelfPayment.findMany({
      where: {
        tenantId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      select: { itemsByOrder: true },
    });
    const conflicts = pendingIntents.some((intent) => {
      const buckets = intent.itemsByOrder as Array<{
        orderId: string;
        items?: Array<{ orderItemId: string; quantity: number }>;
      }>;
      if (!Array.isArray(buckets)) return false;
      return buckets.some((b) => {
        if (b?.orderId !== orderId) return false;
        if (!targetOrderItemId) return true;
        return (b.items ?? []).some((i) => i.orderItemId === targetOrderItemId);
      });
    });
    if (conflicts) {
      throw new ConflictException(
        'A customer is currently paying for this order via PayTR. ' +
          'Wait until their payment finalizes (or expires) before modifying.',
      );
    }
  }

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
    const created = await this.createInner(createOrderDto, userId, tenantId);
    // Outbox emit happens AFTER the transaction commits so consumers don't
    // see an order that later rolled back. Best-effort: a failed emit logs
    // a warning but never undoes a committed order.
    this.emitOrderEvent('order.created.v1', created);
    return created;
  }

  private async createInner(createOrderDto: CreateOrderDto, userId: string, tenantId: string) {
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

        // Idempotency fast-path: if the client supplied a key and we've
        // already recorded an order for this (tenantId, key), return the
        // existing row instead of creating a duplicate. The DB has a
        // partial unique index on (tenantId, idempotencyKey) WHERE key
        // IS NOT NULL — this pre-check is the responsiveness path; the
        // P2002 catch in createWithOrderNumberRetry handles concurrent
        // retries authoritatively.
        if (createOrderDto.idempotencyKey) {
          const existing = await this.prisma.order.findFirst({
            where: { tenantId, idempotencyKey: createOrderDto.idempotencyKey },
            include: {
              orderItems: {
                include: {
                  product: { select: { id: true, name: true, price: true, image: true } },
                  modifiers: {
                    include: {
                      modifier: { select: { id: true, name: true, priceAdjustment: true } },
                    },
                  },
                },
              },
              table: { select: { id: true, number: true, section: true } },
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          });
          if (existing) {
            addBreadcrumb('Idempotency hit — returning existing order', 'order', {
              orderId: existing.id,
              orderNumber: existing.orderNumber,
            });
            return existing;
          }
        }

        // Validate table if provided
        let tableBranchId: string | null = null;
        if (createOrderDto.tableId) {
          const table = await this.prisma.table.findFirst({
            where: {
              id: createOrderDto.tableId,
              tenantId,
            },
            select: { id: true, branchId: true },
          });

          if (!table) {
            throw new BadRequestException('Invalid table or table does not belong to your tenant');
          }

          // HummyTummy Phase 3: capture the table's branch so the order
          // inherits it for branch-scoped reports and KDS routing.
          tableBranchId = table.branchId;

          // Reservation-overlap guard: refuse a walk-in if there's an
          // active CONFIRMED reservation on this table that either
          //   (a) is currently in-window (start <= now <= end), or
          //   (b) starts within the next 30 minutes.
          // Without this check a waiter could open an order on a table
          // that a customer reserved weeks ago; later when they arrive,
          // the reservation seat-flow would overwrite the order's table
          // and orphan the items. SEATED reservations also block —
          // those mean the rezervationist already physically seated the
          // guest, walk-in on the same table is nonsense.
          await this.assertNoReservationOverlap(tenantId, createOrderDto.tableId);
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
          select: { id: true, name: true, priceAdjustment: true, groupId: true },
        })
      : [];

    const modifierMap = new Map(modifiers.map((m) => [m.id, m]));

    // Validate all modifiers exist
    for (const modifierId of allModifierIds) {
      if (!modifierMap.has(modifierId)) {
        throw new BadRequestException(`Modifier ${modifierId} not found or unavailable`);
      }
    }

    // Validate each modifier is allowed on the product the client attached
    // it to. Without this check, a malicious client could attach a $100
    // "add caviar" modifier (defined for a steak) to a $2 drink, since the
    // modifier exists somewhere in the tenant and passes isAvailable. The
    // ProductModifierGroup junction is the source of truth for "which
    // groups apply to which product"; cross-reference each modifier's
    // groupId against that mapping.
    if (allModifierIds.length > 0) {
      const productGroupLinks = await this.prisma.productModifierGroup.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, groupId: true },
      });
      // Map productId → Set<groupId> for O(1) lookup per modifier.
      const allowedGroupsByProduct = new Map<string, Set<string>>();
      for (const link of productGroupLinks) {
        const s = allowedGroupsByProduct.get(link.productId) ?? new Set<string>();
        s.add(link.groupId);
        allowedGroupsByProduct.set(link.productId, s);
      }
      for (const item of createOrderDto.items) {
        const allowed = allowedGroupsByProduct.get(item.productId) ?? new Set<string>();
        for (const m of item.modifiers ?? []) {
          const modifier = modifierMap.get(m.modifierId);
          if (!modifier) continue;   // already caught above
          if (!allowed.has(modifier.groupId)) {
            throw new BadRequestException(
              `Modifier "${modifier.name}" is not allowed on this product`,
            );
          }
        }
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

    // Cap the discount at the order total — discount > total would mint a
    // negative finalAmount and effectively pay the customer. DTO `@Min(0)`
    // blocks negative discounts but not over-discounts, and a free-form
    // admin field can hit this even on legit flows (typo, copy/paste).
    const requestedDiscount = createOrderDto.discount || 0;
    if (requestedDiscount > totalAmount) {
      throw new BadRequestException(
        `Discount (${requestedDiscount}) cannot exceed order total (${totalAmount}).`,
      );
    }
    const discount = requestedDiscount;
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
        idempotencyKey: createOrderDto.idempotencyKey,
        orderItems: {
          create: orderItems,
        },
      };

      if (createOrderDto.tableId) {
        createData.tableId = createOrderDto.tableId;
      }
      // Inherit the table's branch onto the order so the new branch-scoped
      // reports (and KDS routing) pick it up. Null is fine — pre-Branch
      // tables keep null which falls into tenant-wide queries.
      if (tableBranchId) {
        createData.branchId = tableBranchId;
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

        // Keep table.status in sync with order presence. updateStatus
        // already flips OCCUPIED on transitions into active states; the
        // create path used to skip this, leaving freshly-created PENDING
        // orders on AVAILABLE tables — a violation of the invariant
        // "table is OCCUPIED iff any active order references it".
        if (createdOrder.tableId) {
          await this.prisma.table.update({
            where: { id: createdOrder.tableId },
            data: { status: TableStatus.OCCUPIED },
          });
        }

        // Build the kitchen ticket snapshot now that the order has its
        // generated orderNumber. The snapshot is written via a separate
        // order.update call because the orderNumber is allocated by the
        // retry helper inside order.create — we can't include the snapshot
        // in the create payload without a chicken-and-egg problem.
        //
        // Note: this is a second query, not atomic with order.create. That
        // matches the existing pattern in this method (stockDeduction, sms
        // notifications also run as separate post-create operations).
        // Fail-soft: a builder error logs and leaves the snapshot null —
        // reprintability is a convenience, not source of truth.
        try {
          const kitchenTicketSnapshot =
            this.receiptSnapshotBuilder.buildKitchenTicketSnapshot({
              order: ReceiptSnapshotBuilder.toBuilderOrder(createdOrder),
            }) as unknown as Prisma.InputJsonValue;
          await this.prisma.order.update({
            where: { id: createdOrder.id },
            data: { kitchenTicketSnapshot },
          });
          (createdOrder as any).kitchenTicketSnapshot = kitchenTicketSnapshot;
        } catch (snapErr) {
          this.logger.warn(
            `Failed to build kitchen ticket snapshot for order ${createdOrder.orderNumber}: ${(snapErr as Error).message}`,
          );
          (createdOrder as any).kitchenTicketSnapshot = null;
        }

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

      const rawDiscount = updateOrderDto.discount !== undefined ? updateOrderDto.discount : Number(order.discount);
      // Cap discount at totalAmount — same protection as the
      // create() path. Shrinking the item set during update could
      // leave a stored discount > new totalAmount, which would mint
      // a negative finalAmount (we'd be paying the customer).
      const discount = Math.min(rawDiscount, totalAmount);
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
      // Discount-only update: cap the value here (cheap), but defer
      // the allocation + self-pay-intent guards to INSIDE the tx —
      // outside-tx reads can miss a webhook that lands between the
      // check and the write. The tx-scoped guards are in the
      // transaction body below.
      const totalAmountDec = new Prisma.Decimal(order.totalAmount);
      const rawDiscount = new Prisma.Decimal(updateOrderDto.discount);
      const cappedDiscount = rawDiscount.gt(totalAmountDec)
        ? totalAmountDec
        : rawDiscount;
      updateData.discount = cappedDiscount;
      updateData.finalAmount = totalAmountDec.sub(cappedDiscount);
    }

    // Atomic replace of the item set: a crash between the deleteMany
    // and the nested create previously produced empty orders. Same tx
    // covers the order.update so a validation failure doesn't leave
    // the order without its items.
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Re-verify status inside the transaction: a concurrent cancel /
      // pay between the findOne above and this write could otherwise let
      // us layer new items onto a PAID/CANCELLED order (corrupting the
      // audit trail). The terminal statuses are guarded at line 468 but
      // only against the stale snapshot.
      const stillEditable = await tx.order.count({
        where: {
          id,
          tenantId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
      });
      if (stillEditable === 0) {
        throw new BadRequestException('Cannot update paid or cancelled orders');
      }
      // Discount-only updates: both the allocation and self-pay
      // guards run INSIDE the tx so a webhook landing between the
      // pre-tx read and the order.update can't slip past. Mirrors
      // the items-rewrite branch below.
      if (
        updateOrderDto.discount !== undefined &&
        !updateData.orderItems
      ) {
        const allocCount = await tx.orderItemPayment.count({
          where: { tenantId, orderItem: { orderId: id } },
        });
        if (allocCount > 0) {
          throw new ConflictException(
            'Cannot change the order discount once any per-item payment has been collected. ' +
              'Refund the existing payment(s) first, then re-apply the discount.',
          );
        }
        await this.ensureNoInFlightSelfPayIntent(tx, id, tenantId);
      }
      if (updateData.orderItems) {
        // The whole-order rewrite path drops every existing OrderItem
        // and recreates the requested set. If any of the items being
        // dropped has an OrderItemPayment row, the FK Restrict would
        // fire on the deleteMany — and even if the cascade allowed it,
        // a customer who already paid for their share would lose the
        // audit trail of what they bought.
        //
        // For surgical changes (waiter wants to remove ONE unpaid item
        // from a table where other customers already paid) use the
        // dedicated `DELETE /orders/:orderId/items/:itemId` endpoint
        // which preserves untouched allocations.
        const paidItemCount = await tx.orderItemPayment.count({
          where: { tenantId, orderItem: { orderId: id } },
        });
        if (paidItemCount > 0) {
          throw new ConflictException(
            'Cannot rewrite the full item set when partial per-item payments exist. ' +
              'Use DELETE /orders/:orderId/items/:itemId to drop a single unpaid item, ' +
              'or refund the payment(s) first.',
          );
        }
        // Block when a customer is mid-PayTR on this order — the
        // intent's itemsByOrder JSON snapshot references the
        // current OrderItem ids; deleteMany would orphan them and
        // the webhook would fail with "item no longer exists" AFTER
        // PayTR already charged the card.
        await this.ensureNoInFlightSelfPayIntent(tx, id, tenantId);
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

    // Mesh-side consumers (kds-routing, webhooks-outbound) see the change via
    // the outbox. Distinct event type so consumers can opt into "any update"
    // vs. "completion" vs. "cancellation" without parsing payload bodies.
    this.emitOrderEvent('order.updated.v1', updatedOrder);

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

      // Block CANCELLED if there are any per-item payments. A CANCELLED
      // order with active OrderItemPayment rows leaves the customer who
      // already paid for their share without a refund trail — refund
      // the payment(s) explicitly instead, which also frees the items.
      if (updateStatusDto.status === OrderStatus.CANCELLED) {
        const paidItemCount = await tx.orderItemPayment.count({
          where: { tenantId, orderItem: { orderId: id } },
        });
        if (paidItemCount > 0) {
          throw new ConflictException(
            'Cannot cancel an order with partial per-item payments. Refund the corresponding payment(s) first.',
          );
        }
      }

      // Build update data with status timestamps
      const statusUpdateData: any = { status: updateStatusDto.status };
      if (updateStatusDto.status === OrderStatus.PREPARING) statusUpdateData.preparingAt = new Date();
      if (updateStatusDto.status === OrderStatus.READY) statusUpdateData.readyAt = new Date();
      if (updateStatusDto.status === OrderStatus.CANCELLED) statusUpdateData.cancelledAt = new Date();

      // Conditional write: include the observed `order.status` in the
      // where filter so two concurrent transitions can't both pass the
      // (stale) validateTransition above and both write. Mirrors the
      // race-safe pattern in customers/loyalty.service.ts:50-107.
      const writeResult = await tx.order.updateMany({
        where: { id, status: order.status },
        data: statusUpdateData,
      });
      if (writeResult.count === 0) {
        throw new BadRequestException(
          `Order state changed mid-flight; please retry. Expected ${order.status}, found something else.`,
        );
      }
      const updated = await tx.order.findUniqueOrThrow({
        where: { id },
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

    // Outbox emit with the matching event type so kds-routing can clear the
    // KDS screen on completion / cancellation. The mesh consumer subscribes
    // to all three (created/updated/completed/cancelled) and dispatches a
    // `clear_order` command on the terminal transitions.
    // PAID and SERVED are the two "terminal" non-cancel statuses: PAID is
    // cashier-side closure, SERVED is kitchen-side. Both translate to
    // "completed" on the mesh because that's when the KDS clear_order
    // command should fire.
    const status = updateStatusDto.status as OrderStatus;
    const eventType =
      status === OrderStatus.PAID || status === OrderStatus.SERVED
        ? 'order.completed.v1'
        : status === OrderStatus.CANCELLED
          ? 'order.cancelled.v1'
          : 'order.updated.v1';
    this.emitOrderEvent(eventType as any, updatedOrder);

    return updatedOrder;
  }

  async remove(id: string, tenantId: string) {
    // Check if order exists and belongs to tenant
    const order = await this.findOne(id, tenantId);

    // Only allow deletion of pending or cancelled orders
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.CANCELLED) {
      throw new BadRequestException('Can only delete pending or cancelled orders');
    }

    // Compound WHERE: tenantId IDOR guard + status still in the
    // delete-eligible set. If a concurrent state change (a waiter
    // moves the order to PREPARING between our findOne and this
    // delete) the count=0 result tells us to refuse the delete
    // rather than dropping a now-active kitchen order on the floor.
    const result = await this.prisma.order.deleteMany({
      where: {
        id,
        tenantId,
        status: { in: [OrderStatus.PENDING, OrderStatus.CANCELLED] },
      },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        'Order status changed concurrently — cannot delete.',
      );
    }
    return { id };
  }

  /**
   * Remove a single OrderItem from an open order — used when a waiter
   * needs to cancel ONE customer's unpaid line without touching the
   * other customers' already-recorded per-item payments.
   *
   * Rules:
   *  - Order must be open (not PAID / CANCELLED / requiresApproval pending).
   *  - The target item must have zero COMPLETED OrderItemPayment rows. If
   *    even one unit has been paid for, refund first.
   *  - On success, order totals (totalAmount / finalAmount / taxAmount)
   *    are recomputed from the surviving items so the rest of the bill
   *    settles cleanly. Discount stays put.
   */
  async removeItem(orderId: string, itemId: string, tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        include: { orderItems: true },
      });
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }
      if (order.status === OrderStatus.PAID || order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Cannot modify a paid or cancelled order');
      }
      if (order.requiresApproval && order.status === OrderStatus.PENDING_APPROVAL) {
        throw new BadRequestException(
          'Order requires approval before items can be modified.',
        );
      }

      const item = order.orderItems.find((i) => i.id === itemId);
      if (!item) {
        throw new NotFoundException(`Item ${itemId} not found on this order`);
      }
      if (order.orderItems.length === 1) {
        throw new BadRequestException(
          'Cannot remove the last item from an order; cancel the order instead.',
        );
      }

      const allocations = await tx.orderItemPayment.count({
        where: { orderItemId: itemId },
      });
      if (allocations > 0) {
        throw new ConflictException(
          'This item has been partially paid for. Refund the corresponding payment(s) first.',
        );
      }

      // Also block when this specific item is reserved by a PENDING
      // self-pay intent — deleting it would orphan the intent's
      // itemsByOrder snapshot and the webhook would fail post-charge.
      await this.ensureNoInFlightSelfPayIntent(tx, orderId, tenantId, itemId);

      await tx.orderItem.delete({ where: { id: itemId } });

      // Recompute totals from the surviving items so the order math
      // stays self-consistent. taxAmount mirrors the order-create
      // pattern: pro-rata discount applied to the gross tax sum.
      const remaining = order.orderItems.filter((i) => i.id !== itemId);
      const newTotal = remaining.reduce<Prisma.Decimal>(
        (s, i) => s.add(new Prisma.Decimal(i.subtotal)),
        new Prisma.Decimal(0),
      );
      const grossTax = remaining.reduce<Prisma.Decimal>(
        (s, i) => s.add(new Prisma.Decimal(i.taxAmount)),
        new Prisma.Decimal(0),
      );
      const discount = new Prisma.Decimal(order.discount);
      const cappedDiscount = discount.gt(newTotal) ? newTotal : discount;
      const newFinal = newTotal.sub(cappedDiscount);
      const discountRatio = newTotal.gt(0) ? cappedDiscount.div(newTotal) : new Prisma.Decimal(0);
      const adjustedTax = grossTax
        .mul(new Prisma.Decimal(1).sub(discountRatio))
        .toDecimalPlaces(2);

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          totalAmount: newTotal,
          discount: cappedDiscount,
          finalAmount: newFinal,
          taxAmount: adjustedTax,
        },
        include: { orderItems: { include: { product: true } } },
      });

      return updated;
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

    // Compound WHERE on the original PENDING_APPROVAL status + tenantId.
    // Without it, two waiters racing Approve vs Reject from two tablets
    // could each pass the status check above against PENDING_APPROVAL,
    // then the loser (say, Reject which sets CANCELLED) writes first and
    // the winner's Approve overwrites — landing the order at PENDING
    // with cancelledAt set from the reject path. Corrupt state.
    const claim = await this.prisma.order.updateMany({
      where: { id: orderId, tenantId, status: OrderStatus.PENDING_APPROVAL },
      data: {
        status: OrderStatus.PENDING,
        requiresApproval: false,
        approvedAt: new Date(),
        approvedById: userId,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        'Order status changed concurrently — refresh and retry.',
      );
    }
    const updatedOrder = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
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

  /**
   * Refuses to open a walk-in order on a table whose next reservation
   * (CONFIRMED or SEATED) is either active right now or starts within
   * the next {@link RESERVATION_HOLD_WINDOW_MINUTES} minutes.
   *
   * Date math note: reservations store `date` as a Postgres DATE and
   * `startTime`/`endTime` as HH:mm strings. We can't filter the
   * combined timestamp at the DB layer without a join+cast, so the
   * query pulls today's + tomorrow's CONFIRMED/SEATED rows for the
   * table and the comparison happens in JS. The result set is tiny
   * (one table × at most a handful of bookings per day) so this stays
   * O(small) regardless of overall reservation volume.
   */
  private async assertNoReservationOverlap(
    tenantId: string,
    tableId: string,
  ): Promise<void> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const candidates = await this.prisma.reservation.findMany({
      where: {
        tenantId,
        tableId,
        date: { in: [today, tomorrow] },
        status: { in: [ReservationStatus.CONFIRMED, ReservationStatus.SEATED] },
      },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        customerName: true,
      },
    });

    const windowEnd = new Date(now.getTime() + RESERVATION_HOLD_WINDOW_MINUTES * 60_000);
    for (const r of candidates) {
      const [sh, sm] = r.startTime.split(':').map(Number);
      const [eh, em] = r.endTime.split(':').map(Number);
      const start = new Date(r.date);
      start.setHours(sh, sm, 0, 0);
      const end = new Date(r.date);
      end.setHours(eh, em, 0, 0);

      // Currently in-window OR starts soon. The "ends after now" guard
      // skips reservations whose window has already closed but the
      // status hasn't been bumped to NO_SHOW yet — a stale CONFIRMED
      // shouldn't block service for the next sitting.
      if (end > now && start <= windowEnd) {
        throw new BadRequestException(
          `Bu masa için ${r.startTime} saatinde ${r.customerName} adına rezervasyon var. ` +
            `Sipariş açmadan önce rezervasyonu "seat" edin ya da iptal edin.`,
        );
      }
    }
  }
}
