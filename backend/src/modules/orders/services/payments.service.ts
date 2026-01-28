import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { PaymentStatus, OrderStatus, StockMovementType } from '../../../common/constants/order-status.enum';
import { TableStatus } from '../../tables/dto/create-table.dto';
import { OrdersService } from './orders.service';
import { CustomersService } from '../../customers/customers.service';
import { withTransaction, addBreadcrumb } from '../../../common/utils/tracing';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private ordersService: OrdersService,
    private customersService: CustomersService,
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

        // Verify order exists and belongs to tenant
        const order = await this.ordersService.findOne(orderId, tenantId);

        // Check if order is already paid
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

        addBreadcrumb('Payment validation passed', 'payment', { orderId });

        // Create payment and update order status in a transaction
        return this.prisma.$transaction(async (tx) => {
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
}
