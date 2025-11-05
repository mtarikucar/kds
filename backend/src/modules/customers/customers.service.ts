import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async create(data: any, tenantId: string) {
    return this.prisma.customer.create({ data: { ...data, tenantId } });
  }

  async findAll(tenantId: string) {
    return this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: { orders: { take: 10, orderBy: { createdAt: 'desc' } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(id: string, data: any, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.customer.update({ where: { id }, data });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.customer.delete({ where: { id } });
  }

  // ========================================
  // CUSTOMER IDENTIFICATION & MANAGEMENT
  // ========================================

  async findOrCreateByPhone(phone: string, tenantId: string, additionalData?: { name?: string; email?: string }) {
    // Try to find existing customer
    let customer = await this.prisma.customer.findFirst({
      where: { phone, tenantId },
    });

    // Create new customer if not found
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          phone,
          name: additionalData?.name || `Customer ${phone}`,
          email: additionalData?.email,
          tenantId,
        },
      });
    }

    return customer;
  }

  async findByPhone(phone: string, tenantId: string) {
    return this.prisma.customer.findFirst({
      where: { phone, tenantId },
      include: {
        orders: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        loyaltyTransactions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async updateStatistics(customerId: string, orderAmount: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const newTotalOrders = customer.totalOrders + 1;
    const newTotalSpent = customer.totalSpent.toNumber() + orderAmount;
    const newAverageOrder = newTotalSpent / newTotalOrders;

    return this.prisma.customer.update({
      where: { id: customerId },
      data: {
        totalOrders: newTotalOrders,
        totalSpent: newTotalSpent,
        averageOrder: newAverageOrder,
        lastVisit: new Date(),
      },
    });
  }

  // ========================================
  // CUSTOMER ANALYTICS
  // ========================================

  async getAnalytics(tenantId: string, options?: { startDate?: Date; endDate?: Date }) {
    const whereClause: Prisma.CustomerWhereInput = {
      tenantId,
    };

    if (options?.startDate || options?.endDate) {
      whereClause.createdAt = {};
      if (options.startDate) whereClause.createdAt.gte = options.startDate;
      if (options.endDate) whereClause.createdAt.lte = options.endDate;
    }

    const [totalCustomers, newCustomers, topCustomers] = await Promise.all([
      // Total customers
      this.prisma.customer.count({ where: { tenantId } }),

      // New customers in period
      this.prisma.customer.count({ where: whereClause }),

      // Top customers by spending
      this.prisma.customer.findMany({
        where: { tenantId },
        orderBy: { totalSpent: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          totalOrders: true,
          totalSpent: true,
          averageOrder: true,
          loyaltyPoints: true,
        },
      }),
    ]);

    // Calculate average customer lifetime value
    const avgLifetimeValue = await this.prisma.customer.aggregate({
      where: { tenantId },
      _avg: { totalSpent: true },
    });

    return {
      totalCustomers,
      newCustomers,
      topCustomers,
      averageLifetimeValue: avgLifetimeValue._avg.totalSpent || 0,
    };
  }

  async getCustomerProfile(customerId: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            orderItems: {
              include: {
                product: true,
              },
            },
          },
        },
        loyaltyTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }
}
