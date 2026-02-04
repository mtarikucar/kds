import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserFilterDto, UserActivityFilterDto } from '../dto/user-filter.dto';

@Injectable()
export class SuperAdminUsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: UserFilterDto) {
    const { search, role, tenantId, status, page = 1, limit = 20 } = filters;

    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) {
      where.role = role;
    }

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (status) {
      where.status = status;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          lastLogin: true,
          createdAt: true,
          tenant: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        phone: true,
        avatar: true,
        emailVerified: true,
        authProvider: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            subdomain: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get user's order statistics
    const [ordersCreated, ordersTotal] = await Promise.all([
      this.prisma.order.count({
        where: { userId: id },
      }),
      this.prisma.order.aggregate({
        where: { userId: id, status: 'PAID' },
        _sum: { finalAmount: true },
      }),
    ]);

    return {
      ...user,
      stats: {
        ordersCreated,
        totalRevenue: Number(ordersTotal._sum.finalAmount) || 0,
      },
    };
  }

  async getActivity(filters: UserActivityFilterDto) {
    const { userId, tenantId, action, page = 1, limit = 50 } = filters;

    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (action) {
      where.action = action;
    }

    const [activities, total] = await Promise.all([
      this.prisma.userActivity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.userActivity.count({ where }),
    ]);

    // Get user and tenant info for the activities
    const userIds = [...new Set(activities.map((a) => a.userId))];
    const tenantIds = [...new Set(activities.map((a) => a.tenantId))];

    const [users, tenants] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
      this.prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true },
      }),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const tenantMap = new Map(tenants.map((t) => [t.id, t]));

    const enrichedActivities = activities.map((activity) => ({
      ...activity,
      user: userMap.get(activity.userId),
      tenant: tenantMap.get(activity.tenantId),
    }));

    return {
      data: enrichedActivities,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async logActivity(
    userId: string,
    tenantId: string,
    action: string,
    ip?: string,
    userAgent?: string,
    metadata?: any,
  ) {
    return this.prisma.userActivity.create({
      data: {
        userId,
        tenantId,
        action,
        ip,
        userAgent,
        metadata,
      },
    });
  }
}
