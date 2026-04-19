import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommissionFilterDto } from '../dto/commission-filter.dto';

@Injectable()
export class MarketingCommissionsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter: CommissionFilterDto, userId: string, userRole: string) {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (userRole === 'SALES_REP') {
      where.marketingUserId = userId;
    } else if (filter.marketingUserId) {
      where.marketingUserId = filter.marketingUserId;
    }

    if (filter.status) where.status = filter.status;
    if (filter.period) where.period = filter.period;
    if (filter.type) where.type = filter.type;

    const [commissions, total] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          marketingUser: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.commission.count({ where }),
    ]);

    return {
      data: commissions,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getSummary(userId: string, userRole: string, period?: string) {
    const where: any = {};

    if (userRole === 'SALES_REP') {
      where.marketingUserId = userId;
    }

    if (period) {
      where.period = period;
    }

    const [pending, approved, paid] = await Promise.all([
      this.prisma.commission.aggregate({
        where: { ...where, status: 'PENDING' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.commission.aggregate({
        where: { ...where, status: 'APPROVED' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.commission.aggregate({
        where: { ...where, status: 'PAID' },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      pending: {
        count: pending._count,
        total: pending._sum.amount || 0,
      },
      approved: {
        count: approved._count,
        total: approved._sum.amount || 0,
      },
      paid: {
        count: paid._count,
        total: paid._sum.amount || 0,
      },
    };
  }

  async approve(id: string) {
    const commission = await this.prisma.commission.findUnique({ where: { id } });
    if (!commission) throw new NotFoundException('Commission not found');
    if (commission.status !== 'PENDING') {
      throw new BadRequestException('Only pending commissions can be approved');
    }

    return this.prisma.commission.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
  }

  async markPaid(id: string) {
    const commission = await this.prisma.commission.findUnique({ where: { id } });
    if (!commission) throw new NotFoundException('Commission not found');
    if (commission.status !== 'APPROVED') {
      throw new BadRequestException('Only approved commissions can be marked as paid');
    }

    return this.prisma.commission.update({
      where: { id },
      data: { status: 'PAID', paidAt: new Date() },
    });
  }
}
