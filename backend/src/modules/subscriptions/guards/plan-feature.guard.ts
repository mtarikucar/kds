import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../../prisma/prisma.service";
import { REQUIRED_PLANS_KEY } from "../decorators/requires-plan.decorator";
import { REQUIRED_FEATURES_KEY } from "../decorators/requires-feature.decorator";
import { REQUIRED_INTEGRATIONS_KEY } from "../decorators/requires-integration.decorator";
import {
  CHECK_LIMIT_KEY,
  LimitType,
} from "../decorators/check-limit.decorator";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import {
  SubscriptionPlanType,
  PlanFeature,
} from "../../../common/constants/subscription.enum";
import { isUnlimited } from "../../../common/constants/subscription-plans.const";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { INTEGRATION_COVERED_BY_FEATURE } from "../../entitlements/integration-coverage";

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
      throw new ForbiddenException(
        "User not authenticated or tenant not found",
      );
    }

    // Get required plans
    const requiredPlans = this.reflector.getAllAndOverride<
      SubscriptionPlanType[]
    >(REQUIRED_PLANS_KEY, [context.getHandler(), context.getClass()]);

    // Get required features
    const requiredFeatures = this.reflector.getAllAndOverride<PlanFeature[]>(
      REQUIRED_FEATURES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Get required integrations (v2.8.88)
    const requiredIntegrations = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_INTEGRATIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Get limit to check
    const limitToCheck = this.reflector.getAllAndOverride<LimitType>(
      CHECK_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no requirements, allow access
    if (
      !requiredPlans &&
      !requiredFeatures &&
      !requiredIntegrations &&
      !limitToCheck
    ) {
      return true;
    }

    // Get tenant's current plan
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      include: { currentPlan: true },
    });

    if (!tenant || !tenant.currentPlan) {
      throw new ForbiddenException("No active subscription plan found");
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
        status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      },
    });

    // Onboarding-trial redesign: FREE is retired, so there is no "always-live"
    // plan — a tenant with no live (ACTIVE/TRIALING/PAST_DUE) subscription is
    // gated. (The global SubscriptionStatusGuard already locks TRIAL_ENDED /
    // EXPIRED tenants to the plan-selection flow; this is defence in depth.)
    if (!activeSubscription) {
      throw new ForbiddenException(
        "Your subscription has expired or been cancelled. Please renew to access this feature.",
      );
    }

    // Check if plan tier is sufficient
    if (requiredPlans && requiredPlans.length > 0) {
      const hasPlanAccess = requiredPlans.includes(
        currentPlan.name as SubscriptionPlanType,
      );

      if (!hasPlanAccess) {
        throw new ForbiddenException(
          `This feature requires one of the following plans: ${requiredPlans.join(", ")}. Your current plan is ${currentPlan.displayName}.`,
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
    let engineSet: Awaited<
      ReturnType<EntitlementService["getForTenant"]>
    > | null = null;
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
      const featureOverrides = tenant.featureOverrides as Record<
        string,
        boolean
      > | null;

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
          featureEnabled =
            featureOverrides?.[feature] !== undefined
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
    //
    // DEF-3: that vendor-list check alone misses a tenant whose PLAN
    // already includes the domain — PlanProjectorService only ever
    // projects `feature.<name>` for plan-sourced access, never
    // `integration.<domain>` (see plan-projector.service.ts's
    // FEATURE_COLUMNS loop), so a plan-delivery tenant had
    // integrations['integration.delivery'] permanently empty and every
    // `@RequiresIntegration('delivery')` route 403'd despite the plan
    // covering it. INTEGRATION_COVERED_BY_FEATURE cross-checks the
    // covering plan feature (delivery only — fiscal/caller have no
    // covering feature and stay purely vendor-list based) as a second,
    // OR'd way to pass.
    if (requiredIntegrations && requiredIntegrations.length > 0) {
      const set = await loadEngineSet();
      for (const domain of requiredIntegrations) {
        const vendors = set.integrations[`integration.${domain}`];
        const hasVendorGrant = Array.isArray(vendors) && vendors.length > 0;
        const coveringFeature = INTEGRATION_COVERED_BY_FEATURE[domain];
        const hasCoveringFeature =
          coveringFeature != null &&
          set.features[`feature.${coveringFeature}`] === true;
        if (!hasVendorGrant && !hasCoveringFeature) {
          throw new ForbiddenException(
            `No active ${domain} integration. Buy one from the marketplace to unlock this feature.`,
          );
        }
      }
    }

    // Check usage limits (override takes precedence over plan)
    if (limitToCheck) {
      const set = await loadEngineSet();
      await this.checkLimit(
        user.tenantId,
        currentPlan,
        limitToCheck,
        tenant.limitOverrides as Record<string, number> | null,
        set,
      );
    }

    return true;
  }

  /**
   * Check if usage limit has been reached.
   *
   * v2.8.90 — engine-routed. Pre-v2.8.90 the limit branch read
   * `plan[limitType]` directly, so capacity add-ons (extra_branch,
   * extra_kds_screen, kds_extra_station, extra_tablet) were ignored:
   * a tenant who bought 3× extra_branch (₺399/mo each, granting
   * `limit.maxBranches += 1` per unit) saw the engine project
   * `limit.maxBranches=4` but the guard still rejected the 4th branch
   * because plan.maxBranches=1. Now the guard reads the engine's
   * folded view (plan + add-on SUM + admin override REPLACE) when
   * populated, falling back to the legacy plan-only path only when
   * the engine has no grants for this tenant (mid-projector race).
   */
  private async checkLimit(
    tenantId: string,
    plan: any,
    limitType: LimitType,
    limitOverrides: Record<string, number> | null | undefined,
    engineSet: Awaited<ReturnType<EntitlementService["getForTenant"]>>,
  ): Promise<void> {
    const engineLimit = engineSet.limits[`limit.${limitType}`];
    let limit: number;
    if (typeof engineLimit === "number") {
      // Engine wins. The engine has already applied override REPLACE
      // semantics and add-on SUM, so the legacy override-then-plan
      // fallback would just re-do work the engine has finished.
      limit = engineLimit;
    } else if (limitOverrides?.[limitType] !== undefined) {
      limit = limitOverrides[limitType];
      this.logger.debug(
        `PlanFeatureGuard.checkLimit fell back to plan-only for tenant=${tenantId} limit=${limitType}`,
      );
    } else if (typeof plan[limitType] === "number") {
      // Engine empty for this key — fall back to plan-only. Same
      // safety-net as PlanFeatureGuard.canActivate's feature branch.
      limit = plan[limitType];
      this.logger.debug(
        `PlanFeatureGuard.checkLimit fell back to plan-only for tenant=${tenantId} limit=${limitType}`,
      );
    } else {
      // KDS_SCREENS/TABLETS have no SubscriptionPlan column at all
      // (100% add-on-sourced — see the LimitType enum doc): every OTHER
      // LimitType always has a real numeric plan column, so this branch
      // is unreachable for them. For these two, "no add-on purchased
      // yet and no admin override" means there is nothing to cap
      // against, not "cap at zero" — an unprovisioned device slot costs
      // the platform nothing, unlike MenuAiQuotaService's per-generation
      // quotas (real vendor charge per unit → deny-by-default is
      // correct there, not here). Enforcement activates the moment the
      // engine or an override produces a real number above. DeviceService.
      // enforceDeviceCapacity encodes this identical rule for the actual
      // production enforcement path (see that file).
      return;
    }

    // If unlimited, allow
    if (isUnlimited(limit)) {
      return;
    }

    let currentCount = 0;

    switch (limitType) {
      case LimitType.USERS:
        // Only count ACTIVE users (not INACTIVE or PENDING_APPROVAL)
        currentCount = await this.prisma.user.count({
          where: { tenantId, status: "ACTIVE" },
        });
        break;

      case LimitType.TABLES:
        currentCount = await this.prisma.table.count({ where: { tenantId } });
        break;

      case LimitType.BRANCHES:
        // v3.0.0 — count only `status: 'active'` branches; archived rows
        // are soft-deleted via BranchesService.archive() and must not
        // re-block creation. Matches the projector's "implicit 1"
        // semantics: the implicit main branch is always status=active.
        currentCount = await this.prisma.branch.count({
          where: { tenantId, status: "active" },
        });
        break;

      case LimitType.PRODUCTS:
        currentCount = await this.prisma.product.count({ where: { tenantId } });
        break;

      case LimitType.CATEGORIES:
        currentCount = await this.prisma.category.count({
          where: { tenantId },
        });
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

      // AI menu-studio caps. The authoritative gate is the atomic claim in
      // MenuAiQuotaService (advisory-locked check+insert); these cases exist
      // so a @CheckLimit pre-check on some future route counts the same
      // ledger instead of silently passing with currentCount=0.
      case LimitType.AI_PHOTOS:
      case LimitType.AI_VIDEOS:
      case LimitType.AI_3D_MODELS: {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const agg = await this.prisma.aiGenerationUsage.aggregate({
          _sum: { units: true },
          where: {
            tenantId,
            kind:
              limitType === LimitType.AI_PHOTOS
                ? "PHOTO"
                : limitType === LimitType.AI_VIDEOS
                  ? "VIDEO"
                  : "MODEL3D",
            voided: false,
            createdAt: { gte: monthStart },
          },
        });
        currentCount = agg._sum.units ?? 0;
        break;
      }

      // Device-mesh capacity add-ons (DEF-7 / Task 6). Counts tenant-scoped
      // Device rows of the matching kind, excluding `retired` — a retired
      // slot frees its capacity back, same convention as BRANCHES'
      // `status: 'active'` filter above. NOT wired to a route via
      // @CheckLimit — POST /v1/devices creates every DeviceKind through one
      // endpoint, so a fixed-per-route decorator can't gate only these two
      // kinds. The real production enforcement is
      // DeviceService.enforceDeviceCapacity; these cases exist so the
      // switch stays the canonical, directly-testable definition of "how do
      // we count usage for this LimitType" (mirrors the AI_PHOTOS/VIDEOS/
      // 3D_MODELS cases above, whose real enforcement is likewise
      // in-service).
      case LimitType.KDS_SCREENS:
        currentCount = await this.prisma.device.count({
          where: { tenantId, kind: "kds_screen", status: { not: "retired" } },
        });
        break;

      case LimitType.TABLETS:
        currentCount = await this.prisma.device.count({
          where: {
            tenantId,
            kind: "tablet_waiter",
            status: { not: "retired" },
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
