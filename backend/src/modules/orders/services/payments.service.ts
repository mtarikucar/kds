import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
  Logger,
} from '@nestjs/common';
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

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private ordersService: OrdersService,
    private customersService: CustomersService,
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

        // Create payment and update order status in a transaction
        const result = await this.prisma.$transaction(async (tx) => {
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

          // Validate payment amount
          if (createPaymentDto.amount > Number(order.finalAmount)) {
            throw new BadRequestException('Payment amount exceeds order total');
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
