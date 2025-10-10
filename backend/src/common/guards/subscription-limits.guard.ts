import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

export interface LimitCheck {
  resource: 'users' | 'tables' | 'products' | 'categories' | 'monthlyOrders';
  action: 'create' | 'count';
}

@Injectable()
export class SubscriptionLimitsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limitCheck = this.reflector.get<LimitCheck>('limitCheck', context.getHandler());

    if (!limitCheck) {
      return true; // No limit check required
    }

    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId;

    if (!tenantId) {
      throw new ForbiddenException('Tenant not found');
    }

    // Get current subscription
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      include: { plan: true },
    });

    if (!subscription || !subscription.plan) {
      throw new ForbiddenException('No active subscription found');
    }

    const plan = subscription.plan;

    // Check limits based on resource type
    switch (limitCheck.resource) {
      case 'users': {
        const maxUsers = plan.maxUsers;
        if (maxUsers === -1) return true; // Unlimited

        const currentCount = await this.prisma.user.count({
          where: { tenantId },
        });

        if (currentCount >= maxUsers) {
          throw new ForbiddenException(
            `User limit reached (${maxUsers}). Upgrade your plan to add more users.`
          );
        }
        break;
      }

      case 'tables': {
        const maxTables = plan.maxTables;
        if (maxTables === -1) return true;

        const currentCount = await this.prisma.table.count({
          where: { tenantId },
        });

        if (currentCount >= maxTables) {
          throw new ForbiddenException(
            `Table limit reached (${maxTables}). Upgrade your plan to add more tables.`
          );
        }
        break;
      }

      case 'products': {
        const maxProducts = plan.maxProducts;
        if (maxProducts === -1) return true;

        const currentCount = await this.prisma.product.count({
          where: { tenantId },
        });

        if (currentCount >= maxProducts) {
          throw new ForbiddenException(
            `Product limit reached (${maxProducts}). Upgrade your plan to add more products.`
          );
        }
        break;
      }

      case 'categories': {
        const maxCategories = plan.maxCategories;
        if (maxCategories === -1) return true;

        const currentCount = await this.prisma.category.count({
          where: { tenantId },
        });

        if (currentCount >= maxCategories) {
          throw new ForbiddenException(
            `Category limit reached (${maxCategories}). Upgrade your plan to add more categories.`
          );
        }
        break;
      }

      case 'monthlyOrders': {
        const maxMonthlyOrders = plan.maxMonthlyOrders;
        if (maxMonthlyOrders === -1) return true;

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const currentCount = await this.prisma.order.count({
          where: {
            tenantId,
            createdAt: { gte: startOfMonth },
          },
        });

        if (currentCount >= maxMonthlyOrders) {
          throw new ForbiddenException(
            `Monthly order limit reached (${maxMonthlyOrders}). Upgrade your plan to process more orders.`
          );
        }
        break;
      }
    }

    return true;
  }
}
