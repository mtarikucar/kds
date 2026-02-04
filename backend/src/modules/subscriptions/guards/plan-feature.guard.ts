import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { REQUIRED_PLANS_KEY } from '../decorators/requires-plan.decorator';
import { REQUIRED_FEATURES_KEY } from '../decorators/requires-feature.decorator';
import { CHECK_LIMIT_KEY, LimitType } from '../decorators/check-limit.decorator';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { SubscriptionPlanType, PlanFeature } from '../../../common/constants/subscription.enum';
import { isUnlimited } from '../../../common/constants/subscription-plans.const';

@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.tenantId) {
      throw new ForbiddenException('User not authenticated or tenant not found');
    }

    // Get required plans
    const requiredPlans = this.reflector.getAllAndOverride<SubscriptionPlanType[]>(REQUIRED_PLANS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Get required features
    const requiredFeatures = this.reflector.getAllAndOverride<PlanFeature[]>(REQUIRED_FEATURES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Get limit to check
    const limitToCheck = this.reflector.getAllAndOverride<LimitType>(CHECK_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no requirements, allow access
    if (!requiredPlans && !requiredFeatures && !limitToCheck) {
      return true;
    }

    // Get tenant's current plan
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      include: { currentPlan: true },
    });

    if (!tenant || !tenant.currentPlan) {
      throw new ForbiddenException('No active subscription plan found');
    }

    const currentPlan = tenant.currentPlan;

    // Check if plan tier is sufficient
    if (requiredPlans && requiredPlans.length > 0) {
      const hasPlanAccess = requiredPlans.includes(currentPlan.name as SubscriptionPlanType);

      if (!hasPlanAccess) {
        throw new ForbiddenException(
          `This feature requires one of the following plans: ${requiredPlans.join(', ')}. Your current plan is ${currentPlan.displayName}.`,
        );
      }
    }

    // Check if required features are enabled
    if (requiredFeatures && requiredFeatures.length > 0) {
      for (const feature of requiredFeatures) {
        const featureEnabled = currentPlan[feature];

        if (!featureEnabled) {
          throw new ForbiddenException(
            `This feature is not available in your current plan (${currentPlan.displayName}). Please upgrade to access this feature.`,
          );
        }
      }
    }

    // Check usage limits
    if (limitToCheck) {
      await this.checkLimit(user.tenantId, currentPlan, limitToCheck);
    }

    return true;
  }

  /**
   * Check if usage limit has been reached
   */
  private async checkLimit(tenantId: string, plan: any, limitType: LimitType): Promise<void> {
    const limit = plan[limitType];

    // If unlimited, allow
    if (isUnlimited(limit)) {
      return;
    }

    let currentCount = 0;

    switch (limitType) {
      case LimitType.USERS:
        // Only count ACTIVE users (not INACTIVE or PENDING_APPROVAL)
        currentCount = await this.prisma.user.count({ where: { tenantId, status: 'ACTIVE' } });
        break;

      case LimitType.TABLES:
        currentCount = await this.prisma.table.count({ where: { tenantId } });
        break;

      case LimitType.PRODUCTS:
        currentCount = await this.prisma.product.count({ where: { tenantId } });
        break;

      case LimitType.CATEGORIES:
        currentCount = await this.prisma.category.count({ where: { tenantId } });
        break;

      case LimitType.MONTHLY_ORDERS:
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        currentCount = await this.prisma.order.count({
          where: {
            tenantId,
            createdAt: { gte: startOfMonth },
          },
        });
        break;
    }

    if (currentCount >= limit) {
      throw new ForbiddenException(
        `You have reached the limit for ${limitType} in your current plan (${plan.displayName}). Current: ${currentCount}, Limit: ${limit}. Please upgrade your plan to increase this limit.`,
      );
    }
  }
}
