import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../../modules/entitlements/entitlement.service';

export interface LimitCheck {
  resource: 'users' | 'tables' | 'products' | 'categories' | 'monthlyOrders';
  action: 'create' | 'count';
}

// Maps the legacy `resource` enum to the engine's dotted limit keys.
// Engine writes `limit.maxUsers`, `limit.maxTables`, etc.
const ENGINE_LIMIT_KEY: Record<LimitCheck['resource'], string> = {
  users: 'limit.maxUsers',
  tables: 'limit.maxTables',
  products: 'limit.maxProducts',
  categories: 'limit.maxCategories',
  monthlyOrders: 'limit.maxMonthlyOrders',
};

const PLAN_FIELD: Record<LimitCheck['resource'], string> = {
  users: 'maxUsers',
  tables: 'maxTables',
  products: 'maxProducts',
  categories: 'maxCategories',
  monthlyOrders: 'maxMonthlyOrders',
};

@Injectable()
export class SubscriptionLimitsGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionLimitsGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    // v2.8.90 — engine routing. Pre-v2.8.90 this guard read
    // `plan.maxUsers` etc. directly, bypassing BOTH override
    // (admin force-grant) AND add-on capacity grants (extra_branch,
    // extra_kds_screen, etc.). A tenant who purchased 3× extra_branch
    // (engine: `limit.maxBranches=4`) still got rejected at the 2nd
    // because plan.maxBranches=1. Same gap PlanFeatureGuard.checkLimit
    // closed in v2.8.90 — this guard's twin sister applied to
    // UsersController.
    private entitlements: EntitlementService,
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

    // Get current subscription. PAST_DUE counts as live here — it's
    // the 7-day grace window where `PlanFeatureGuard` still grants
    // feature access. Limiting CRUD during grace would be punitive and
    // inconsistent with the feature guard.
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      },
      include: { plan: true },
    });

    if (!subscription || !subscription.plan) {
      throw new ForbiddenException('No active subscription found');
    }

    const plan = subscription.plan;

    // v2.8.90 — resolve the limit via the engine. Falls back to plan-
    // only if engine empty (projector race, new tenant).
    const engineSet = await this.entitlements.getForTenant(tenantId, null);
    const engineKey = ENGINE_LIMIT_KEY[limitCheck.resource];
    const planField = PLAN_FIELD[limitCheck.resource];
    const engineLimit = engineSet.limits[engineKey];
    const limit: number =
      typeof engineLimit === 'number'
        ? engineLimit
        : (plan as any)[planField];

    if (limit === -1) return true; // Unlimited

    let currentCount = 0;
    switch (limitCheck.resource) {
      case 'users':
        // Only count ACTIVE users (not INACTIVE or PENDING_APPROVAL)
        currentCount = await this.prisma.user.count({
          where: { tenantId, status: 'ACTIVE' },
        });
        break;
      case 'tables':
        currentCount = await this.prisma.table.count({ where: { tenantId } });
        break;
      case 'products':
        currentCount = await this.prisma.product.count({ where: { tenantId } });
        break;
      case 'categories':
        currentCount = await this.prisma.category.count({ where: { tenantId } });
        break;
      case 'monthlyOrders': {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        currentCount = await this.prisma.order.count({
          where: { tenantId, createdAt: { gte: startOfMonth } },
        });
        break;
      }
    }

    if (currentCount >= limit) {
      throw new ForbiddenException(
        `${limitCheck.resource} limit reached (${currentCount}/${limit}). Upgrade your plan or buy a capacity add-on.`,
      );
    }

    return true;
  }
}
