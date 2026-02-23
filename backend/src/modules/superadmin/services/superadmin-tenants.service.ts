import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  TenantFilterDto,
  UpdateTenantStatusDto,
  TenantStatus,
} from '../dto/tenant-filter.dto';
import { UpdateTenantOverridesDto } from '../dto/update-tenant-overrides.dto';
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

  async getOverrides(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { currentPlan: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const plan = tenant.currentPlan;
    const featureOverrides = (tenant.featureOverrides as Record<string, boolean>) || null;
    const limitOverrides = (tenant.limitOverrides as Record<string, number>) || null;

    const planFeatures = plan ? {
      advancedReports: plan.advancedReports,
      multiLocation: plan.multiLocation,
      customBranding: plan.customBranding,
      apiAccess: plan.apiAccess,
      prioritySupport: plan.prioritySupport,
      inventoryTracking: plan.inventoryTracking,
      kdsIntegration: plan.kdsIntegration,
      reservationSystem: plan.reservationSystem,
    } : {};

    const planLimits = plan ? {
      maxUsers: plan.maxUsers,
      maxTables: plan.maxTables,
      maxProducts: plan.maxProducts,
      maxCategories: plan.maxCategories,
      maxMonthlyOrders: plan.maxMonthlyOrders,
    } : {};

    // Merge: override takes precedence, otherwise plan default
    const effectiveFeatures = { ...planFeatures };
    if (featureOverrides) {
      for (const [key, value] of Object.entries(featureOverrides)) {
        if (value !== null && value !== undefined) {
          (effectiveFeatures as any)[key] = value;
        }
      }
    }

    const effectiveLimits = { ...planLimits };
    if (limitOverrides) {
      for (const [key, value] of Object.entries(limitOverrides)) {
        if (value !== null && value !== undefined) {
          (effectiveLimits as any)[key] = value;
        }
      }
    }

    return {
      featureOverrides,
      limitOverrides,
      planDefaults: {
        features: planFeatures,
        limits: planLimits,
      },
      effective: {
        features: effectiveFeatures,
        limits: effectiveLimits,
      },
    };
  }

  async updateOverrides(
    tenantId: string,
    dto: UpdateTenantOverridesDto,
    actorId: string,
    actorEmail: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const previousFeatureOverrides = (tenant.featureOverrides as Record<string, boolean>) || {};
    const previousLimitOverrides = (tenant.limitOverrides as Record<string, number>) || {};

    // Merge feature overrides: null value = remove key (revert to plan default)
    let newFeatureOverrides: Record<string, boolean> | null = { ...previousFeatureOverrides };
    if (dto.featureOverrides) {
      for (const [key, value] of Object.entries(dto.featureOverrides)) {
        if (value === null || value === undefined) {
          delete newFeatureOverrides[key];
        } else {
          newFeatureOverrides[key] = value;
        }
      }
    }
    if (Object.keys(newFeatureOverrides).length === 0) {
      newFeatureOverrides = null;
    }

    // Merge limit overrides: null value = remove key (revert to plan default)
    let newLimitOverrides: Record<string, number> | null = { ...previousLimitOverrides };
    if (dto.limitOverrides) {
      for (const [key, value] of Object.entries(dto.limitOverrides)) {
        if (value === null || value === undefined) {
          delete newLimitOverrides[key];
        } else {
          newLimitOverrides[key] = value;
        }
      }
    }
    if (Object.keys(newLimitOverrides).length === 0) {
      newLimitOverrides = null;
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        featureOverrides: newFeatureOverrides ?? Prisma.JsonNull,
        limitOverrides: newLimitOverrides ?? Prisma.JsonNull,
      },
    });

    await this.auditService.log({
      action: AuditAction.UPDATE,
      entityType: EntityType.TENANT,
      entityId: tenantId,
      actorId,
      actorEmail,
      previousData: {
        featureOverrides: previousFeatureOverrides,
        limitOverrides: previousLimitOverrides,
      },
      newData: {
        featureOverrides: newFeatureOverrides,
        limitOverrides: newLimitOverrides,
      },
      targetTenantId: tenantId,
      targetTenantName: tenant.name,
    });

    return { featureOverrides: newFeatureOverrides, limitOverrides: newLimitOverrides };
  }

  async resetOverrides(
    tenantId: string,
    actorId: string,
    actorEmail: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const previousFeatureOverrides = tenant.featureOverrides;
    const previousLimitOverrides = tenant.limitOverrides;

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        featureOverrides: Prisma.JsonNull,
        limitOverrides: Prisma.JsonNull,
      },
    });

    await this.auditService.log({
      action: AuditAction.UPDATE,
      entityType: EntityType.TENANT,
      entityId: tenantId,
      actorId,
      actorEmail,
      previousData: {
        featureOverrides: previousFeatureOverrides,
        limitOverrides: previousLimitOverrides,
      },
      newData: {
        featureOverrides: null,
        limitOverrides: null,
      },
      targetTenantId: tenantId,
      targetTenantName: tenant.name,
    });

    return { featureOverrides: null, limitOverrides: null };
  }
}
