import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SubscriptionFilterDto,
  CreatePlanDto,
  UpdatePlanDto,
  ExtendSubscriptionDto,
  UpdateSubscriptionDto,
} from '../dto/subscription-filter.dto';
import { SuperAdminAuditService } from './superadmin-audit.service';
import { AuditAction, EntityType } from '../dto/audit-filter.dto';

@Injectable()
export class SuperAdminSubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private auditService: SuperAdminAuditService,
  ) {}

  // Plans
  async findAllPlans() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: { monthlyPrice: 'asc' },
      include: {
        _count: {
          select: { subscriptions: true },
        },
      },
    });
  }

  async createPlan(createDto: CreatePlanDto, actorId: string, actorEmail: string) {
    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name: createDto.name,
        displayName: createDto.displayName,
        description: createDto.description,
        monthlyPrice: createDto.monthlyPrice,
        yearlyPrice: createDto.yearlyPrice,
        currency: createDto.currency || 'TRY',
        trialDays: createDto.trialDays || 0,
        maxUsers: createDto.maxUsers || 1,
        maxTables: createDto.maxTables || 5,
        maxProducts: createDto.maxProducts || 50,
        maxCategories: createDto.maxCategories || 10,
        maxMonthlyOrders: createDto.maxMonthlyOrders || 100,
        advancedReports: createDto.advancedReports || false,
        multiLocation: createDto.multiLocation || false,
        customBranding: createDto.customBranding || false,
        apiAccess: createDto.apiAccess || false,
        prioritySupport: createDto.prioritySupport || false,
        inventoryTracking: createDto.inventoryTracking || false,
        kdsIntegration: createDto.kdsIntegration ?? true,
        reservationSystem: createDto.reservationSystem || false,
        personnelManagement: createDto.personnelManagement || false,
        isActive: createDto.isActive ?? true,
      },
    });

    await this.auditService.log({
      action: AuditAction.CREATE,
      entityType: EntityType.PLAN,
      entityId: plan.id,
      actorId,
      actorEmail,
      newData: plan,
    });

    return plan;
  }

  async updatePlan(
    id: string,
    updateDto: UpdatePlanDto,
    actorId: string,
    actorEmail: string,
  ) {
    const existingPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
    });

    if (!existingPlan) {
      throw new NotFoundException('Plan not found');
    }

    const plan = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        name: updateDto.name,
        displayName: updateDto.displayName,
        description: updateDto.description,
        monthlyPrice: updateDto.monthlyPrice,
        yearlyPrice: updateDto.yearlyPrice,
        currency: updateDto.currency,
        trialDays: updateDto.trialDays,
        maxUsers: updateDto.maxUsers,
        maxTables: updateDto.maxTables,
        maxProducts: updateDto.maxProducts,
        maxCategories: updateDto.maxCategories,
        maxMonthlyOrders: updateDto.maxMonthlyOrders,
        advancedReports: updateDto.advancedReports,
        multiLocation: updateDto.multiLocation,
        customBranding: updateDto.customBranding,
        apiAccess: updateDto.apiAccess,
        prioritySupport: updateDto.prioritySupport,
        inventoryTracking: updateDto.inventoryTracking,
        kdsIntegration: updateDto.kdsIntegration,
        reservationSystem: updateDto.reservationSystem,
        personnelManagement: updateDto.personnelManagement,
        isActive: updateDto.isActive,
      },
    });

    await this.auditService.log({
      action: AuditAction.UPDATE,
      entityType: EntityType.PLAN,
      entityId: plan.id,
      actorId,
      actorEmail,
      previousData: existingPlan,
      newData: plan,
    });

    return plan;
  }

  async deletePlan(id: string, actorId: string, actorEmail: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
      include: {
        _count: { select: { subscriptions: true } },
      },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    if (plan._count.subscriptions > 0) {
      throw new BadRequestException(
        'Cannot delete plan with active subscriptions',
      );
    }

    await this.prisma.subscriptionPlan.delete({ where: { id } });

    await this.auditService.log({
      action: AuditAction.DELETE,
      entityType: EntityType.PLAN,
      entityId: id,
      actorId,
      actorEmail,
      previousData: plan,
    });

    return { message: 'Plan deleted successfully' };
  }

  // Subscriptions
  async findAllSubscriptions(filters: SubscriptionFilterDto) {
    const { status, planId, tenantId, page = 1, limit = 20 } = filters;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (planId) {
      where.planId = planId;
    }

    if (tenantId) {
      where.tenantId = tenantId;
    }

    const [subscriptions, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          tenant: {
            select: { id: true, name: true, subdomain: true },
          },
          plan: {
            select: { id: true, name: true, displayName: true },
          },
        },
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return {
      data: subscriptions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOneSubscription(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        tenant: {
          select: { id: true, name: true, subdomain: true, status: true },
        },
        plan: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    return subscription;
  }

  async updateSubscription(
    id: string,
    updateDto: UpdateSubscriptionDto,
    actorId: string,
    actorEmail: string,
  ) {
    const existing = await this.prisma.subscription.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!existing) {
      throw new NotFoundException('Subscription not found');
    }

    const updateData: any = {};

    if (updateDto.planId) {
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: updateDto.planId },
      });
      if (!plan) {
        throw new NotFoundException('Plan not found');
      }
      updateData.planId = updateDto.planId;

      // Also update tenant's current plan
      await this.prisma.tenant.update({
        where: { id: existing.tenantId },
        data: { currentPlanId: updateDto.planId },
      });
    }

    if (updateDto.status) {
      updateData.status = updateDto.status;
    }

    const subscription = await this.prisma.subscription.update({
      where: { id },
      data: updateData,
      include: {
        tenant: {
          select: { id: true, name: true },
        },
        plan: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    await this.auditService.log({
      action: AuditAction.UPDATE,
      entityType: EntityType.SUBSCRIPTION,
      entityId: id,
      actorId,
      actorEmail,
      previousData: {
        planId: existing.planId,
        status: existing.status,
      },
      newData: updateDto,
      targetTenantId: existing.tenant.id,
      targetTenantName: existing.tenant.name,
    });

    return subscription;
  }

  async extendSubscription(
    id: string,
    extendDto: ExtendSubscriptionDto,
    actorId: string,
    actorEmail: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    const newEndDate = new Date(subscription.currentPeriodEnd);
    newEndDate.setDate(newEndDate.getDate() + extendDto.days);

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        currentPeriodEnd: newEndDate,
      },
      include: {
        tenant: {
          select: { id: true, name: true },
        },
        plan: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    await this.auditService.log({
      action: AuditAction.EXTEND,
      entityType: EntityType.SUBSCRIPTION,
      entityId: id,
      actorId,
      actorEmail,
      previousData: {
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
      newData: {
        currentPeriodEnd: newEndDate,
        daysExtended: extendDto.days,
        reason: extendDto.reason,
      },
      targetTenantId: subscription.tenant.id,
      targetTenantName: subscription.tenant.name,
    });

    return updated;
  }

  async cancelSubscription(
    id: string,
    actorId: string,
    actorEmail: string,
    reason?: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason,
        cancelAtPeriodEnd: true,
      },
      include: {
        tenant: {
          select: { id: true, name: true },
        },
        plan: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    await this.auditService.log({
      action: AuditAction.CANCEL,
      entityType: EntityType.SUBSCRIPTION,
      entityId: id,
      actorId,
      actorEmail,
      previousData: { status: subscription.status },
      newData: { status: 'CANCELLED', reason },
      targetTenantId: subscription.tenant.id,
      targetTenantName: subscription.tenant.name,
    });

    return updated;
  }
}
