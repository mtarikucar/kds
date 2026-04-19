import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { normalizePhone } from './customers.helpers';

const WAITER_CUSTOMER_SELECT = {
  id: true,
  name: true,
  phone: true,
  loyaltyPoints: true,
  loyaltyTier: true,
  totalOrders: true,
  createdAt: true,
} as const;

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateCustomerDto, tenantId: string) {
    return this.prisma.customer.create({
      data: {
        name: data.name,
        phone: normalizePhone(data.phone),
        email: data.email,
        notes: data.notes,
        birthday: data.birthday ? new Date(data.birthday) : undefined,
        tenantId,
      },
    });
  }

  async findAll(
    tenantId: string,
    role: string | undefined,
    opts: { page?: number; limit?: number; search?: string } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = { tenantId };
    if (opts.search) {
      const term = opts.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        { email: { contains: term, mode: 'insensitive' } },
      ];
    }

    // Front-of-house roles get a trimmed projection — WAITER doesn't need
    // totalSpent, birthday, preferences or notes on the POS customer list.
    const isPrivileged = role === 'ADMIN' || role === 'MANAGER';
    const select = isPrivileged ? undefined : WAITER_CUSTOMER_SELECT;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        ...(select ? { select } : {}),
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { data, total, page, pageSize: limit };
  }

  async findOne(id: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: { orders: { take: 10, orderBy: { createdAt: 'desc' } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(id: string, data: UpdateCustomerDto, tenantId: string) {
    // Tenant-scoped updateMany avoids TOCTOU between findFirst and update.
    const result = await this.prisma.customer.updateMany({
      where: { id, tenantId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phone !== undefined && { phone: normalizePhone(data.phone) }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.birthday !== undefined && {
          birthday: data.birthday ? new Date(data.birthday) : null,
        }),
      },
    });
    if (result.count !== 1) throw new NotFoundException('Customer not found');
    return this.prisma.customer.findFirst({ where: { id, tenantId } });
  }

  async remove(id: string, tenantId: string) {
    const result = await this.prisma.customer.deleteMany({ where: { id, tenantId } });
    if (result.count !== 1) throw new NotFoundException('Customer not found');
    return { id, deleted: true };
  }

  /**
   * Mark a customer as phone-verified. This is deliberately NOT exposed via
   * the UpdateCustomerDto so staff cannot flip the flag manually — only the
   * server-validated OTP flow in PhoneVerificationService reaches this path.
   */
  async markPhoneVerified(customerId: string, tenantId: string) {
    await this.prisma.customer.updateMany({
      where: { id: customerId, tenantId },
      data: { phoneVerified: true },
    });
  }

  /**
   * Privileged internal admission path used by POS/order flows to bind a
   * phone-entered customer to an existing tenant record.
   */
  async findOrCreateByPhone(
    phone: string,
    tenantId: string,
    additional?: { name?: string; email?: string },
  ) {
    const canonical = normalizePhone(phone);
    const existing = await this.prisma.customer.findFirst({
      where: { phone: canonical, tenantId },
    });
    if (existing) return existing;

    try {
      return await this.prisma.customer.create({
        data: {
          phone: canonical,
          name: additional?.name || `Customer ${canonical}`,
          email: additional?.email,
          tenantId,
        },
      });
    } catch (err) {
      // Concurrent first-identify race: another request created the row
      // between the findFirst and create. Return the existing row instead
      // of surfacing a 500 to the caller.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const recovered = await this.prisma.customer.findFirst({
          where: { phone: canonical, tenantId },
        });
        if (recovered) return recovered;
      }
      throw err;
    }
  }

  async findByPhone(phone: string, tenantId: string) {
    return this.prisma.customer.findFirst({
      where: { phone: normalizePhone(phone), tenantId },
      include: {
        orders: { take: 10, orderBy: { createdAt: 'desc' } },
        loyaltyTransactions: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async updateStatistics(customerId: string, tenantId: string, orderAmount: number | Prisma.Decimal) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId },
      });
      if (!customer) throw new NotFoundException('Customer not found');

      const amount = new Prisma.Decimal(orderAmount);
      const newTotalOrders = customer.totalOrders + 1;
      const newTotalSpent = new Prisma.Decimal(customer.totalSpent).add(amount);
      const newAverageOrder = newTotalSpent.div(newTotalOrders);

      const result = await tx.customer.updateMany({
        where: { id: customerId, tenantId },
        data: {
          totalOrders: newTotalOrders,
          totalSpent: newTotalSpent,
          averageOrder: newAverageOrder,
          lastVisit: new Date(),
        },
      });
      if (result.count !== 1) throw new BadRequestException('Customer update race');
      return tx.customer.findFirstOrThrow({ where: { id: customerId, tenantId } });
    });
  }

  async getAnalytics(tenantId: string, options?: { startDate?: Date; endDate?: Date }) {
    const whereNew: Prisma.CustomerWhereInput = { tenantId };
    if (options?.startDate || options?.endDate) {
      whereNew.createdAt = {};
      if (options.startDate) whereNew.createdAt.gte = options.startDate;
      if (options.endDate) whereNew.createdAt.lte = options.endDate;
    }

    const [totalCustomers, newCustomers, topCustomers, avg] = await Promise.all([
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.customer.count({ where: whereNew }),
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
      this.prisma.customer.aggregate({
        where: { tenantId },
        _avg: { totalSpent: true },
      }),
    ]);

    return {
      totalCustomers,
      newCustomers,
      topCustomers,
      averageLifetimeValue: avg._avg.totalSpent ?? 0,
    };
  }

  async getCustomerProfile(customerId: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            finalAmount: true,
            createdAt: true,
          },
        },
        loyaltyTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
