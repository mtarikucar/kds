import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  TenantFilterDto,
  UpdateTenantStatusDto,
  TenantStatus,
} from '../dto/tenant-filter.dto';
import { SuperAdminAuditService } from './superadmin-audit.service';
import { AuditAction, EntityType } from '../dto/audit-filter.dto';

@Injectable()
export class SuperAdminTenantsService {
  constructor(
    private prisma: PrismaService,
    private auditService: SuperAdminAuditService,
  ) {}

  async findAll(filters: TenantFilterDto) {
    const {
      search,
      status,
      planId,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filters;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { subdomain: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (planId) {
      where.currentPlanId = planId;
    }

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          currentPlan: {
            select: { id: true, name: true, displayName: true },
          },
          _count: {
            select: {
              users: true,
              orders: true,
              tables: true,
              products: true,
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data: tenants,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        currentPlan: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            plan: {
              select: { id: true, name: true, displayName: true },
            },
          },
        },
        _count: {
          select: {
            users: true,
            orders: true,
            tables: true,
            products: true,
            categories: true,
            customers: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Get additional statistics
    const [totalRevenue, ordersToday, ordersThisMonth] = await Promise.all([
      this.prisma.order.aggregate({
        where: { tenantId: id, status: 'PAID' },
        _sum: { finalAmount: true },
      }),
      this.prisma.order.count({
        where: {
          tenantId: id,
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
      this.prisma.order.count({
        where: {
          tenantId: id,
          createdAt: {
            gte: new Date(new Date().setDate(1)),
          },
        },
      }),
    ]);

    return {
      ...tenant,
      stats: {
        totalRevenue: Number(totalRevenue._sum.finalAmount) || 0,
        ordersToday,
        ordersThisMonth,
      },
    };
  }

  async updateStatus(
    id: string,
    updateDto: UpdateTenantStatusDto,
    actorId: string,
    actorEmail: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const previousStatus = tenant.status;

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        status: updateDto.status,
      },
      include: {
        currentPlan: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    // Determine audit action
    let action: AuditAction;
    switch (updateDto.status) {
      case TenantStatus.SUSPENDED:
        action = AuditAction.SUSPEND;
        break;
      case TenantStatus.ACTIVE:
        action = AuditAction.ACTIVATE;
        break;
      case TenantStatus.DELETED:
        action = AuditAction.DELETE;
        break;
      default:
        action = AuditAction.UPDATE;
    }

    // Log the action
    await this.auditService.log({
      action,
      entityType: EntityType.TENANT,
      entityId: id,
      actorId,
      actorEmail,
      previousData: { status: previousStatus },
      newData: { status: updateDto.status, reason: updateDto.reason },
      targetTenantId: id,
      targetTenantName: tenant.name,
    });

    return updated;
  }

  async getTenantUsers(tenantId: string, page: number = 1, limit: number = 20) {
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId },
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
        },
      }),
      this.prisma.user.count({ where: { tenantId } }),
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

  async getTenantOrders(
    tenantId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          type: true,
          status: true,
          totalAmount: true,
          finalAmount: true,
          createdAt: true,
          table: {
            select: { number: true },
          },
        },
      }),
      this.prisma.order.count({ where: { tenantId } }),
    ]);

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTenantStats(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [
      totalOrders,
      ordersToday,
      ordersThisMonth,
      totalRevenue,
      revenueToday,
      revenueThisMonth,
      totalUsers,
      totalProducts,
      totalTables,
      totalCustomers,
    ] = await Promise.all([
      this.prisma.order.count({ where: { tenantId } }),
      this.prisma.order.count({
        where: { tenantId, createdAt: { gte: startOfDay } },
      }),
      this.prisma.order.count({
        where: { tenantId, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.order.aggregate({
        where: { tenantId, status: 'PAID' },
        _sum: { finalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: { tenantId, status: 'PAID', createdAt: { gte: startOfDay } },
        _sum: { finalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: { tenantId, status: 'PAID', createdAt: { gte: startOfMonth } },
        _sum: { finalAmount: true },
      }),
      this.prisma.user.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.table.count({ where: { tenantId } }),
      this.prisma.customer.count({ where: { tenantId } }),
    ]);

    return {
      orders: {
        total: totalOrders,
        today: ordersToday,
        thisMonth: ordersThisMonth,
      },
      revenue: {
        total: Number(totalRevenue._sum.finalAmount) || 0,
        today: Number(revenueToday._sum.finalAmount) || 0,
        thisMonth: Number(revenueThisMonth._sum.finalAmount) || 0,
      },
      resources: {
        users: totalUsers,
        products: totalProducts,
        tables: totalTables,
        customers: totalCustomers,
      },
    };
  }
}
