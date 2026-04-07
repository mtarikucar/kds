import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
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
        return this.prisma.$transaction(async (tx) => {
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

            // Deduct stock for tracked products
            for (const item of payment.order.orderItems) {
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
                    reason: `Order ${payment.order.orderNumber}`,
                    productId: product.id,
                    userId: order.userId,
                    tenantId: order.tenantId,
                  },
                });
              }
            }

            // Update table status if applicable
            if (order.tableId) {
              await tx.table.update({
                where: { id: order.tableId },
                data: { status: TableStatus.AVAILABLE },
              });
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

            // Auto-generate invoice if enabled
            if (this.salesInvoiceService && this.accountingSettingsService) {
              try {
                const accSettings = await this.accountingSettingsService.findByTenant(tenantId);
                if (accSettings.autoGenerateInvoice) {
                  await this.salesInvoiceService.createFromOrder(orderId, tenantId);
                }
              } catch (err) {
                console.error('Auto-invoice generation failed:', err.message);
              }
            }
          }

          addBreadcrumb('Payment completed successfully', 'payment', { paymentId: payment.id });
          return payment;
        });
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
    const order = await this.ordersService.findOne(payment.orderId, tenantId);

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

  async splitBill(dto: SplitBillDto, tenantId: string) {
    // Pre-validate order exists and is in valid state
    const preCheck = await this.prisma.order.findFirst({
      where: { id: dto.orderId, tenantId },
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
        where: { id: dto.orderId, tenantId },
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

      // Allow small rounding tolerance (1 cent)
      if (totalSplitAmount > remaining + 0.01) {
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
            orderId: dto.orderId,
            paidAt: new Date(),
          },
        });
        payments.push(payment);
      }

      // Check if order is fully paid now
      const totalPaid = await tx.payment.aggregate({
        where: { orderId: dto.orderId, status: PaymentStatus.COMPLETED },
        _sum: { amount: true },
      });

      const totalPaidAmount = Number(totalPaid._sum.amount || 0);
      const isFullyPaid = totalPaidAmount >= orderAmount;

      if (isFullyPaid) {
        // Mark order as paid
        await tx.order.update({
          where: { id: dto.orderId },
          data: { status: OrderStatus.PAID, paidAt: new Date() },
        });

        // Deduct stock
        for (const item of order.orderItems) {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (product && product.stockTracked) {
            const newStock = product.currentStock - item.quantity;
            await tx.product.update({
              where: { id: product.id },
              data: { currentStock: Math.max(0, newStock), isAvailable: newStock > 0 },
            });
            await tx.stockMovement.create({
              data: {
                type: StockMovementType.OUT,
                quantity: item.quantity,
                reason: `Order ${order.orderNumber} (split bill)`,
                productId: product.id,
                userId: order.userId,
                tenantId: order.tenantId,
              },
            });
          }
        }

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

        // Auto-generate invoice if enabled
        if (this.salesInvoiceService && this.accountingSettingsService) {
          try {
            const accSettings = await this.accountingSettingsService.findByTenant(tenantId);
            if (accSettings.autoGenerateInvoice) {
              await this.salesInvoiceService.createFromOrder(dto.orderId, tenantId);
            }
          } catch (err) {
            console.error('Auto-invoice generation failed:', err.message);
          }
        }
      }

      return { payments, isFullyPaid };
    });

    return {
      orderId: dto.orderId,
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
