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
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { PaymentStatus, OrderStatus } from '../../../common/constants/order-status.enum';
import { TableStatus } from '../../tables/dto/create-table.dto';
import { OrdersService } from './orders.service';
import { StockDeductionService } from '../../stock-management/services/stock-deduction.service';
import { withTransaction, addBreadcrumb } from '../../../common/utils/tracing';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private ordersService: OrdersService,
    @Optional()
    @Inject(forwardRef(() => StockDeductionService))
    private stockDeductionService?: StockDeductionService,
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
        data: { amount: createPaymentDto.amount },
      },
      async () => {
        addBreadcrumb('Starting payment creation', 'payment', { orderId, amount: createPaymentDto.amount });

        const order = await this.ordersService.findOne(orderId, tenantId);

        if (order.status === OrderStatus.PAID) {
          throw new BadRequestException('Order is already paid');
        }
        if (order.status === OrderStatus.CANCELLED) {
          throw new BadRequestException('Cannot pay for a cancelled order');
        }
        if (order.requiresApproval && order.status === OrderStatus.PENDING_APPROVAL) {
          throw new BadRequestException(
            'Order requires approval before payment can be processed. Please approve the order first.',
          );
        }

        if (createPaymentDto.idempotencyKey) {
          const existing = await this.prisma.payment.findFirst({
            where: {
              orderId,
              tenantId,
              idempotencyKey: createPaymentDto.idempotencyKey,
            },
          });
          if (existing) {
            return existing;
          }
        }

        const amount = new Prisma.Decimal(createPaymentDto.amount);
        const finalAmount = new Prisma.Decimal(order.finalAmount);

        const completedSum = await this.prisma.payment.aggregate({
          where: { orderId, tenantId, status: PaymentStatus.COMPLETED },
          _sum: { amount: true },
        });
        const totalPaidSoFar = new Prisma.Decimal(completedSum._sum.amount ?? 0);
        const remaining = finalAmount.sub(totalPaidSoFar);

        if (amount.greaterThan(remaining)) {
          throw new BadRequestException(
            `Payment amount ${amount.toString()} exceeds remaining balance ${remaining.toString()}`,
          );
        }

        addBreadcrumb('Payment validation passed', 'payment', { orderId });

        const { payment, shouldClose, customerId } = await this.prisma.$transaction(async (tx) => {
          let payment;
          try {
            payment = await tx.payment.create({
              data: {
                amount,
                method: createPaymentDto.method,
                status: PaymentStatus.COMPLETED,
                notes: createPaymentDto.notes,
                transactionId: createPaymentDto.transactionId,
                idempotencyKey: createPaymentDto.idempotencyKey,
                tenantId,
                orderId,
                paidAt: new Date(),
              },
            });
          } catch (err) {
            // If a concurrent retry collided on (orderId, idempotencyKey), fall through
            // to the prior row so the caller sees the same outcome on both requests.
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === 'P2002' &&
              createPaymentDto.idempotencyKey
            ) {
              const existing = await tx.payment.findFirst({
                where: {
                  orderId,
                  tenantId,
                  idempotencyKey: createPaymentDto.idempotencyKey,
                },
              });
              if (existing) {
                return { payment: existing, shouldClose: false, customerId: null as string | null };
              }
            }
            throw err;
          }

          const totalPaid = await tx.payment.aggregate({
            where: { orderId, tenantId, status: PaymentStatus.COMPLETED },
            _sum: { amount: true },
          });
          const totalPaidAmount = new Prisma.Decimal(totalPaid._sum.amount ?? 0);
          const shouldClose = totalPaidAmount.greaterThanOrEqualTo(finalAmount);

          let customerId: string | null = null;
          if (shouldClose) {
            if (createPaymentDto.customerPhone) {
              const existingCustomer = await tx.customer.findFirst({
                where: { phone: createPaymentDto.customerPhone, tenantId },
              });
              const customer =
                existingCustomer ??
                (await tx.customer.create({
                  data: {
                    phone: createPaymentDto.customerPhone,
                    name: `Customer ${createPaymentDto.customerPhone}`,
                    tenantId,
                  },
                }));
              customerId = customer.id;
            }

            await tx.order.updateMany({
              where: { id: orderId, tenantId, status: { not: OrderStatus.PAID } },
              data: {
                status: OrderStatus.PAID,
                paidAt: new Date(),
                ...(customerId && { customerId }),
                ...(createPaymentDto.customerPhone && {
                  customerPhone: createPaymentDto.customerPhone,
                }),
              },
            });

            if (order.tableId) {
              const stillActive = await tx.order.count({
                where: {
                  tenantId,
                  tableId: order.tableId,
                  id: { not: orderId },
                  status: {
                    in: [
                      OrderStatus.PENDING,
                      OrderStatus.PREPARING,
                      OrderStatus.READY,
                      OrderStatus.SERVED,
                    ],
                  },
                },
              });
              if (stillActive === 0) {
                await tx.table.updateMany({
                  where: { id: order.tableId, tenantId, status: { not: TableStatus.RESERVED } },
                  data: { status: TableStatus.AVAILABLE },
                });
              }
            }

            if (customerId) {
              const customer = await tx.customer.findUnique({ where: { id: customerId } });
              if (customer) {
                const orderAmount = new Prisma.Decimal(order.finalAmount);
                const newTotalOrders = customer.totalOrders + 1;
                const newTotalSpent = new Prisma.Decimal(customer.totalSpent).add(orderAmount);
                const newAverageOrder = newTotalSpent.div(newTotalOrders);
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

          return { payment, shouldClose, customerId };
        });

        // Route final stock deduction through the idempotent StockDeductionService
        // (honours tenant settings, handles recipe vs product stock, uses stockDeducted flag).
        // Kept outside the payment transaction because StockDeductionService runs its own
        // Serializable transaction; nesting would risk transaction conflicts.
        if (shouldClose && this.stockDeductionService) {
          try {
            const deductResult = await this.stockDeductionService.deductForOrder(
              orderId,
              tenantId,
              OrderStatus.PAID,
            );
            if (deductResult?.lowStockAlerts?.length) {
              this.logger.warn(
                `Low-stock alerts on payment close for order ${orderId}: ${deductResult.lowStockAlerts.join(', ')}`,
              );
            }
          } catch (err: any) {
            this.logger.error(
              `Stock deduction failed after closing order ${orderId}: ${err.message}`,
              err.stack,
            );
          }
        }

        addBreadcrumb('Payment completed successfully', 'payment', { paymentId: payment.id });
        return payment;
      },
    );
  }

  async findByOrder(orderId: string, tenantId: string) {
    await this.ordersService.findOne(orderId, tenantId);
    return this.prisma.payment.findMany({
      where: { orderId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: string, status: PaymentStatus, tenantId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    // Tenant already enforced; still verify the parent order for consistency.
    await this.ordersService.findOne(payment.orderId, tenantId);

    const result = await this.prisma.payment.updateMany({
      where: { id, tenantId },
      data: {
        status,
        paidAt: status === PaymentStatus.COMPLETED ? new Date() : null,
      },
    });
    if (result.count !== 1) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    return this.prisma.payment.findFirst({ where: { id, tenantId } });
  }
}
