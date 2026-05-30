import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { REQUIRED_PLANS_KEY } from '../decorators/requires-plan.decorator';
import { REQUIRED_FEATURES_KEY } from '../decorators/requires-feature.decorator';
import { REQUIRED_INTEGRATIONS_KEY } from '../decorators/requires-integration.decorator';
import { CHECK_LIMIT_KEY, LimitType } from '../decorators/check-limit.decorator';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { SubscriptionPlanType, PlanFeature } from '../../../common/constants/subscription.enum';
import { isUnlimited } from '../../../common/constants/subscription-plans.const';
import { EntitlementService } from '../../entitlements/entitlement.service';

@Injectable()
export class PlanFeatureGuard implements CanActivate {
  private readonly logger = new Logger(PlanFeatureGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    // v2.8.88: feature/limit/integration checks now route through the
    // entitlement engine so TenantAddOn grants are honored. Pre-v2.8.88
    // the guard read `tenant.currentPlan + featureOverrides` only — a
    // tenant who bought `advanced_reports` (₺129/mo) was still rejected
    // because the engine row sat next to the plan row, ignored.
    private readonly entitlements: EntitlementService,
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

    // Get required integrations (v2.8.88)
    const requiredIntegrations = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_INTEGRATIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Get limit to check
    const limitToCheck = this.reflector.getAllAndOverride<LimitType>(CHECK_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no requirements, allow access
    if (!requiredPlans && !requiredFeatures && !requiredIntegrations && !limitToCheck) {
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

    // Check if tenant has a live subscription. PAST_DUE is intentionally
    // treated as live — it's the 7-day grace window after a failed
    // renewal or trial expiry, during which the user can still access
    // features while they sort out payment. The `past-due-subscriptions`
    // scheduler promotes PAST_DUE → EXPIRED after 7 days, which is the
    // actual access cutoff.
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId: user.tenantId,
        status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      },
    });

    if (!activeSubscription && currentPlan.name !== 'FREE') {
      throw new ForbiddenException(
        'Your subscription has expired or been cancelled. Please renew to access this feature.',
      );
    }

    // Check if plan tier is sufficient
    if (requiredPlans && requiredPlans.length > 0) {
      const hasPlanAccess = requiredPlans.includes(currentPlan.name as SubscriptionPlanType);

      if (!hasPlanAccess) {
        throw new ForbiddenException(
          `This feature requires one of the following plans: ${requiredPlans.join(', ')}. Your current plan is ${currentPlan.displayName}.`,
        );
      }
    }

    // v2.8.88: feature/integration checks go through the entitlement
    // engine. The engine has already folded plan grants + TenantAddOn
    // grants + admin overrides into one resolved set, so a tenant who
    // bought `advanced_reports` add-on now passes the same gate as one
    // on a plan that bundles it. Engine cache is in-process + Redis-
    // invalidated (~30s convergence after a purchase, typically much
    // sooner).
    let engineSet: Awaited<ReturnType<EntitlementService['getForTenant']>> | null = null;
    const loadEngineSet = async () => {
      if (engineSet === null) {
        engineSet = await this.entitlements.getForTenant(user.tenantId, null);
      }
      return engineSet;
    };

    // Check if required features are enabled
    if (requiredFeatures && requiredFeatures.length > 0) {
      const set = await loadEngineSet();
      const hasAnyEngineGrants = Object.keys(set.features).length > 0;
      const featureOverrides = tenant.featureOverrides as Record<string, boolean> | null;

      for (const feature of requiredFeatures) {
        let featureEnabled: boolean;
        if (hasAnyEngineGrants) {
          // Engine populated — trust it. The engine's fold already
          // applied overrides (`override:admin` source) so the legacy
          // override-then-plan fallback is unnecessary on this path.
          featureEnabled = set.features[`feature.${feature}`] === true;
        } else {
          // Engine empty for this tenant (projector race / new signup).
          // Same plan-only fallback used by getEffectiveFeatures; the
          // nightly reconcile cron catches the miss within 24h.
          featureEnabled = featureOverrides?.[feature] !== undefined
            ? featureOverrides[feature]
            : (currentPlan[feature] as boolean);
          this.logger.debug(
            `PlanFeatureGuard fell back to plan-only for tenant=${user.tenantId} feature=${feature}`,
          );
        }

        if (!featureEnabled) {
          throw new ForbiddenException(
            `This feature is not available in your current plan (${currentPlan.displayName}). Please upgrade to access this feature.`,
          );
        }
      }
    }

    // v2.8.88: integration gating. Domain must have at least one
    // vendor granted (length > 0). For tenant who bought
    // `integration_yemeksepeti`, the engine grants
    // `integration.delivery: ['yemeksepeti']`; the gate
    // `@RequiresIntegration('delivery')` then passes.
    if (requiredIntegrations && requiredIntegrations.length > 0) {
      const set = await loadEngineSet();
      for (const domain of requiredIntegrations) {
        const vendors = set.integrations[`integration.${domain}`];
        if (!Array.isArray(vendors) || vendors.length === 0) {
          throw new ForbiddenException(
            `No active ${domain} integration. Buy one from the marketplace to unlock this feature.`,
          );
        }
      }
    }

    // Check usage limits (override takes precedence over plan)
    if (limitToCheck) {
      await this.checkLimit(user.tenantId, currentPlan, limitToCheck, tenant.limitOverrides as Record<string, number> | null);
    }

    return true;
  }

  /**
   * Check if usage limit has been reached
   */
  private async checkLimit(tenantId: string, plan: any, limitType: LimitType, limitOverrides?: Record<string, number> | null): Promise<void> {
    const limit = limitOverrides?.[limitType] !== undefined
      ? limitOverrides[limitType]
      : plan[limitType];

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
