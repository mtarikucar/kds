import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { SplitBillDto, SplitType } from '../dto/split-bill.dto';
import { PaymentStatus, OrderStatus, StockMovementType } from '../../../common/constants/order-status.enum';
import { TableStatus } from '../../tables/dto/create-table.dto';
import { OrdersService } from './orders.service';
import { CustomersService } from '../../customers/customers.service';
import { withTransaction, addBreadcrumb } from '../../../common/utils/tracing';
import { SalesInvoiceService } from '../../accounting/services/sales-invoice.service';
import { AccountingSettingsService } from '../../accounting/services/accounting-settings.service';
import { ReceiptSnapshotBuilder } from './receipt-snapshot.builder';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private ordersService: OrdersService,
    private customersService: CustomersService,
    private receiptSnapshotBuilder: ReceiptSnapshotBuilder,
    @Optional()
    private salesInvoiceService?: SalesInvoiceService,
    @Optional()
    private accountingSettingsService?: AccountingSettingsService,
  ) {}

  async create(orderId: string, createPaymentDto: CreatePaymentDto, tenantId: string) {
    return withTransaction(
      {
        name: 'payment.create',
        op: 'payment',
        tags: {
          'payment.method': createPaymentDto.method,
          'tenant.id': tenantId,
          'order.id': orderId,
        },
        data: {
          amount: createPaymentDto.amount,
        },
      },
      async () => {
        addBreadcrumb('Starting payment creation', 'payment', { orderId, amount: createPaymentDto.amount });

        // Verify order exists and belongs to tenant (lightweight pre-check for tenant isolation)
        await this.ordersService.findOne(orderId, tenantId);

        addBreadcrumb('Payment validation passed', 'payment', { orderId });

        // Idempotency fast-path: if the client supplied a key and we've already
        // recorded a payment for this (orderId, key), return that row instead of
        // creating a duplicate. The DB has a partial unique index on
        // (orderId, idempotencyKey) WHERE idempotencyKey IS NOT NULL — this
        // pre-check is a responsiveness optimization; P2002 below handles the
        // concurrent-retry race authoritatively.
        if (createPaymentDto.idempotencyKey) {
          const existing = await this.prisma.payment.findFirst({
            where: {
              orderId,
              tenantId,
              idempotencyKey: createPaymentDto.idempotencyKey,
            },
            include: {
              order: {
                include: {
                  orderItems: { include: { product: true } },
                },
              },
            },
          });
          if (existing) return existing;
        }

        // Create payment and update order status in a transaction
        let result;
        try {
          result = await this.prisma.$transaction(async (tx) => {
          // Re-fetch order inside transaction for a consistent view
          const order = await tx.order.findFirst({
            where: { id: orderId, tenantId },
          });

          if (!order) {
            throw new NotFoundException('Order not found');
          }

          // Check if order is already paid (inside transaction to prevent race condition)
          if (order.status === OrderStatus.PAID) {
            throw new BadRequestException('Order is already paid');
          }

          // Check if order is cancelled
          if (order.status === OrderStatus.CANCELLED) {
            throw new BadRequestException('Cannot pay for a cancelled order');
          }

          // Prevent payment for orders awaiting approval (check BEFORE creating payment)
          if (order.requiresApproval && order.status === OrderStatus.PENDING_APPROVAL) {
            throw new BadRequestException(
              'Order requires approval before payment can be processed. Please approve the order first.'
            );
          }

          // Validate payment amount against REMAINING (not total). A partial
          // payment must not be allowed to push the order into overpayment by
          // sending a second full-amount payment.
          const existingPaid = await tx.payment.aggregate({
            where: { orderId, status: PaymentStatus.COMPLETED },
            _sum: { amount: true },
          });
          const alreadyPaid = new Prisma.Decimal(existingPaid._sum.amount ?? 0);
          const remaining = new Prisma.Decimal(order.finalAmount).sub(alreadyPaid);
          // 1-cent rounding tolerance for float-legacy callers.
          if (new Prisma.Decimal(createPaymentDto.amount).gt(remaining.add('0.01'))) {
            throw new BadRequestException(
              `Payment amount exceeds remaining (${remaining.toFixed(2)})`,
            );
          }

          // Build the receipt snapshot before payment.create so it's persisted
          // in the same transaction. Fail-soft: if tenant or order data is
          // unexpectedly missing pieces, fall back to JsonNull rather than
          // crashing the payment — this is a reprint convenience, not the
          // source of truth for accounting.
          let receiptSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull =
            Prisma.JsonNull;
          try {
            const tenantRow = await tx.tenant.findUnique({
              where: { id: tenantId },
              select: { id: true, name: true, currency: true },
            });
            const orderForSnap = await tx.order.findFirst({
              where: { id: orderId, tenantId },
              include: {
                orderItems: {
                  include: {
                    product: true,
                    modifiers: { include: { modifier: true } },
                  },
                },
                table: true,
              },
            });
            if (tenantRow && orderForSnap) {
              // Adapter: schema uses `subtotal` for the line total and
              // OrderItemModifier wraps Modifier — flatten to the builder's
              // simpler input contract.
              const orderForBuilder = {
                ...orderForSnap,
                orderItems: orderForSnap.orderItems.map((oi: any) => ({
                  ...oi,
                  totalPrice: oi.subtotal,
                  modifiers: (oi.modifiers ?? []).map((om: any) => ({
                    name: om.modifier?.name ?? '',
                    additionalPrice: om.priceAdjustment,
                  })),
                })),
              };
              receiptSnapshot = this.receiptSnapshotBuilder.buildReceiptSnapshot({
                tenant: tenantRow,
                order: orderForBuilder as any,
                payment: {
                  method: createPaymentDto.method,
                  transactionId: createPaymentDto.transactionId ?? null,
                  paidAt: new Date(),
                },
              }) as unknown as Prisma.InputJsonValue;
            }
          } catch (snapErr) {
            this.logger.warn(
              `Failed to build receipt snapshot for order ${orderId}: ${(snapErr as Error).message}`,
            );
            receiptSnapshot = Prisma.JsonNull;
          }

          // Create payment
          const payment = await tx.payment.create({
            data: {
              amount: createPaymentDto.amount,
              method: createPaymentDto.method,
              status: PaymentStatus.COMPLETED,
              notes: createPaymentDto.notes,
              orderId,
              tenantId,
              paidAt: new Date(),
              // Persist external gateway reference + client-provided idempotency
              // key so retries of the same request return the same payment row
              // (enforced by the partial unique index on the schema side).
              transactionId: createPaymentDto.transactionId,
              idempotencyKey: createPaymentDto.idempotencyKey,
              receiptSnapshot,
            },
            include: {
              order: {
                include: {
                  orderItems: {
                    include: {
                      product: true,
                    },
                  },
                },
              },
            },
          });

          // Check if total payments equal or exceed order amount
          const totalPaid = await tx.payment.aggregate({
            where: {
              orderId,
              status: PaymentStatus.COMPLETED,
            },
            _sum: {
              amount: true,
            },
          });

          const totalPaidAmount = Number(totalPaid._sum.amount || 0);
          const orderAmount = Number(order.finalAmount);

          // If fully paid, update order status and deduct stock
          if (totalPaidAmount >= orderAmount) {
            // Link customer if phone provided (use tx for transaction consistency)
            let customerId: string | null = null;
            if (createPaymentDto.customerPhone) {
              // Find or create customer within transaction
              let customer = await tx.customer.findFirst({
                where: { phone: createPaymentDto.customerPhone, tenantId },
              });

              if (!customer) {
                customer = await tx.customer.create({
                  data: {
                    phone: createPaymentDto.customerPhone,
                    name: `Customer ${createPaymentDto.customerPhone}`,
                    tenantId,
                  },
                });
              }
              customerId = customer.id;
            }

            await tx.order.update({
              where: { id: orderId },
              data: {
                status: OrderStatus.PAID,
                paidAt: new Date(),
                ...(customerId && { customerId }),
                ...(createPaymentDto.customerPhone && { customerPhone: createPaymentDto.customerPhone }),
              },
            });

            // NOTE: Stock deduction is handled by StockDeductionService (triggered on order
            // status change). Do NOT duplicate stock deduction here.

            // Update table status if applicable
            if (order.tableId) {
              // Check if other active orders exist on this table before marking available
              const otherActiveOrders = await tx.order.count({
                where: {
                  tableId: order.tableId,
                  id: { not: orderId },
                  status: {
                    notIn: [OrderStatus.PAID, OrderStatus.CANCELLED],
                  },
                },
              });

              if (otherActiveOrders === 0) {
                await tx.table.update({
                  where: { id: order.tableId },
                  data: { status: TableStatus.AVAILABLE },
                });
              }
            }

            // Update customer statistics if customer is linked (within transaction)
            if (customerId) {
              const customer = await tx.customer.findUnique({
                where: { id: customerId },
              });

              if (customer) {
                const newTotalOrders = customer.totalOrders + 1;
                const newTotalSpent = Number(customer.totalSpent) + orderAmount;
                const newAverageOrder = newTotalSpent / newTotalOrders;

                await tx.customer.update({
                  where: { id: customerId },
                  data: {
                    totalOrders: newTotalOrders,
                    totalSpent: newTotalSpent,
                    averageOrder: newAverageOrder,
                    lastVisit: new Date(),
                  },
                });
              }
            }

          }

          addBreadcrumb('Payment completed successfully', 'payment', { paymentId: payment.id });
          return payment;
          });
        } catch (err) {
          // Partial unique index on (orderId, idempotencyKey) WHERE key IS NOT
          // NULL — a concurrent retry with the same key races to insert and
          // only one wins. Losers surface the already-stored payment so the
          // client gets an idempotent response.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002' &&
            createPaymentDto.idempotencyKey
          ) {
            const existing = await this.prisma.payment.findFirst({
              where: {
                orderId,
                tenantId,
                idempotencyKey: createPaymentDto.idempotencyKey,
              },
              include: {
                order: {
                  include: {
                    orderItems: { include: { product: true } },
                  },
                },
              },
            });
            if (existing) return existing;
          }
          throw err;
        }

        // Auto-generate invoice AFTER transaction commits
        if (this.salesInvoiceService && this.accountingSettingsService) {
          try {
            const accSettings = await this.accountingSettingsService.findByTenant(tenantId);
            if (accSettings.autoGenerateInvoice) {
              await this.salesInvoiceService.createFromOrder(orderId, tenantId);
            }
          } catch (err) {
            this.logger.error(`Auto-invoice generation failed for order ${orderId}: ${err.message}`, err.stack);
          }
        }

        return result;
      }
    );
  }

  async findByOrder(orderId: string, tenantId: string) {
    // Verify order exists and belongs to tenant
    await this.ordersService.findOne(orderId, tenantId);

    return this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Valid payment status transitions
  private static readonly VALID_PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
    [PaymentStatus.PENDING]: [PaymentStatus.COMPLETED, PaymentStatus.FAILED],
    [PaymentStatus.COMPLETED]: [PaymentStatus.REFUNDED],
    [PaymentStatus.FAILED]: [],
    [PaymentStatus.REFUNDED]: [],
  };

  async updateStatus(id: string, status: PaymentStatus, tenantId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        order: true,
      },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    // Verify payment belongs to tenant
    await this.ordersService.findOne(payment.orderId, tenantId);

    // Validate payment state transition
    const currentStatus = payment.status as PaymentStatus;
    const validTransitions = PaymentsService.VALID_PAYMENT_TRANSITIONS[currentStatus] || [];
    if (!validTransitions.includes(status)) {
      throw new BadRequestException(
        `Invalid payment status transition: ${currentStatus} -> ${status}. Allowed: ${validTransitions.join(', ') || 'none'}`,
      );
    }

    // REFUNDED requires rolling back the order + customer stats atomically.
    // Previously this endpoint flipped payment.status alone, leaving the
    // order as PAID and the customer's lifetime spend inflated — so
    // reports, loyalty, and accounting all drifted.
    if (status === PaymentStatus.REFUNDED) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.payment.update({
          where: { id },
          data: { status: PaymentStatus.REFUNDED, paidAt: null },
        });

        const completedSum = await tx.payment.aggregate({
          where: { orderId: payment.orderId, status: PaymentStatus.COMPLETED },
          _sum: { amount: true },
        });
        const stillPaid = new Prisma.Decimal(completedSum._sum.amount ?? 0);
        const orderAmount = new Prisma.Decimal(payment.order.finalAmount);

        // If the remaining completed payments no longer cover the order,
        // move the order out of PAID. Treat as CANCELLED so table/stock
        // invariants match the existing cancellation flows elsewhere.
        if (stillPaid.lt(orderAmount) && payment.order.status === OrderStatus.PAID) {
          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: OrderStatus.CANCELLED, paidAt: null },
          });

          if (payment.order.customerId) {
            const cust = await tx.customer.findUnique({
              where: { id: payment.order.customerId },
            });
            if (cust && cust.totalOrders > 0) {
              const refundedAmt = new Prisma.Decimal(payment.amount);
              const newTotalOrders = Math.max(0, cust.totalOrders - 1);
              const newTotalSpent = Prisma.Decimal.max(
                new Prisma.Decimal(0),
                new Prisma.Decimal(cust.totalSpent).sub(refundedAmt),
              );
              const newAverage =
                newTotalOrders > 0
                  ? newTotalSpent.div(newTotalOrders)
                  : new Prisma.Decimal(0);
              await tx.customer.update({
                where: { id: cust.id },
                data: {
                  totalOrders: newTotalOrders,
                  totalSpent: newTotalSpent,
                  averageOrder: newAverage,
                },
              });
            }
          }
        }

        return updated;
      });
    }

    return this.prisma.payment.update({
      where: { id },
      data: {
        status,
        paidAt: status === PaymentStatus.COMPLETED ? new Date() : null,
      },
    });
  }

  // ========================================
  // SPLIT BILL
  // ========================================

  async splitBill(orderId: string, dto: SplitBillDto, tenantId: string) {
    // Pre-validate order exists and is in valid state
    const preCheck = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!preCheck) {
      throw new NotFoundException('Order not found');
    }

    if (preCheck.status === OrderStatus.PAID) {
      throw new BadRequestException('Order is already fully paid');
    }

    if (preCheck.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay for a cancelled order');
    }

    // All validation and payment creation inside transaction for race-condition safety
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        include: {
          orderItems: { include: { product: true } },
          payments: { where: { status: PaymentStatus.COMPLETED } },
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      const orderAmount = Number(order.finalAmount);
      const alreadyPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const remaining = orderAmount - alreadyPaid;

      const totalSplitAmount = dto.payments.reduce((sum, p) => sum + p.amount, 0);

      // Allow small rounding tolerance (1 cent) but prevent systematic overpayment
      if (totalSplitAmount > remaining && Math.abs(totalSplitAmount - remaining) > 0.01) {
        throw new BadRequestException(
          `Split total (${totalSplitAmount.toFixed(2)}) exceeds remaining amount (${remaining.toFixed(2)})`
        );
      }

      const payments = [];
      for (const entry of dto.payments) {
        const payment = await tx.payment.create({
          data: {
            amount: entry.amount,
            method: entry.method,
            status: PaymentStatus.COMPLETED,
            notes: entry.label || null,
            orderId: orderId,
            tenantId,
            paidAt: new Date(),
          },
        });
        payments.push(payment);
      }

      // Check if order is fully paid now
      const totalPaid = await tx.payment.aggregate({
        where: { orderId: orderId, status: PaymentStatus.COMPLETED },
        _sum: { amount: true },
      });

      const totalPaidAmount = Number(totalPaid._sum.amount || 0);
      const isFullyPaid = totalPaidAmount >= orderAmount;

      if (isFullyPaid) {
        // Mark order as paid
        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.PAID, paidAt: new Date() },
        });

        // NOTE: Stock deduction is handled by StockDeductionService (triggered on order
        // status change). Do NOT duplicate stock deduction here.

        // Update table status
        if (order.tableId) {
          const otherActiveOrders = await tx.order.count({
            where: {
              tableId: order.tableId,
              id: { not: order.id },
              status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
            },
          });

          if (otherActiveOrders === 0) {
            await tx.table.update({
              where: { id: order.tableId },
              data: { status: TableStatus.AVAILABLE },
            });
          }
        }

      }

      return { payments, isFullyPaid };
    });

    // Auto-generate invoice AFTER transaction commits
    if (result.isFullyPaid && this.salesInvoiceService && this.accountingSettingsService) {
      try {
        const accSettings = await this.accountingSettingsService.findByTenant(tenantId);
        if (accSettings.autoGenerateInvoice) {
          await this.salesInvoiceService.createFromOrder(orderId, tenantId);
        }
      } catch (err) {
        console.error('Auto-invoice generation failed:', err.message);
      }
    }

    return {
      orderId: orderId,
      splitType: dto.splitType,
      payments: result.payments,
      orderFullyPaid: result.isFullyPaid,
    };
  }

  async getGroupBillSummary(groupId: string, tenantId: string) {
    const tables = await this.prisma.table.findMany({
      where: { groupId, tenantId },
      include: {
        orders: {
          where: { status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] } },
          include: {
            orderItems: { include: { product: true, modifiers: { include: { modifier: true } } } },
            payments: { where: { status: PaymentStatus.COMPLETED } },
          },
        },
      },
      orderBy: { number: 'asc' },
    });

    if (tables.length === 0) {
      throw new NotFoundException('Table group not found');
    }

    const allOrders = tables.flatMap(t => t.orders);
    const allItems = allOrders.flatMap(o =>
      o.orderItems.map(item => ({
        id: item.id,
        orderId: o.id,
        orderNumber: o.orderNumber,
        tableNumber: tables.find(t => t.id === o.tableId)?.number,
        productName: item.product?.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        subtotal: Number(item.subtotal),
        modifiers: item.modifiers?.map(m => ({
          name: m.modifier?.displayName || m.modifier?.name,
          price: Number(m.modifier?.priceAdjustment || 0),
        })),
      }))
    );

    const totalAmount = allOrders.reduce((sum, o) => sum + Number(o.finalAmount), 0);
    const totalPaid = allOrders.reduce((sum, o) =>
      sum + o.payments.reduce((ps, p) => ps + Number(p.amount), 0), 0
    );

    return {
      groupId,
      tables: tables.map(t => ({ id: t.id, number: t.number })),
      orders: allOrders.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        tableId: o.tableId,
        finalAmount: Number(o.finalAmount),
        paidAmount: o.payments.reduce((s, p) => s + Number(p.amount), 0),
      })),
      items: allItems,
      summary: {
        totalAmount,
        totalPaid,
        remainingAmount: totalAmount - totalPaid,
      },
    };
  }
}
