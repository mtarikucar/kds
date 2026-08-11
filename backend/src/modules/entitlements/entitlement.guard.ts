import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { EntitlementService } from "./entitlement.service";
import {
  allowsIntegration,
  hasFeature,
  isUnlimitedLimit,
  limitOf,
} from "./entitlement-engine";
import {
  EntitlementRequirement,
  REQUIRE_ENTITLEMENT_KEY,
} from "./require-entitlement.decorator";
import {
  EntitlementRequiredException,
  EntitlementRequirementDetail,
  OfferSummary,
} from "./entitlement-required.exception";
import { EntitlementOfferResolver } from "./entitlement-offer.resolver";
import { featureKey } from "./entitlement-keys.const";

/**
 * Guard backing @RequireEntitlement — and, since v3.3.0, the ONLY entitlement
 * guard. `@RequiresFeature` / `@RequiresIntegration` are thin aliases over
 * `@RequireEntitlement`, so all 85 legacy call sites resolve here without a
 * single controller edit.
 *
 * Public routes pass through; non-public routes without the decorator pass
 * through too — entitlement gates are opt-in per route, not blanket like the
 * auth guard.
 *
 * A denial carries the RESOLVED OFFER (product, prorated price, period) rather
 * than a bare "feature not enabled". That is what let the frontend delete its
 * hardcoded feature→plan table, which was a second source of pricing truth
 * nothing kept in sync with the catalog.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementService,
    // Optional so a bare-constructed unit test still compiles; when absent the
    // guard still DENIES, it just cannot name a product to buy.
    @Optional() private readonly offers?: EntitlementOfferResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const reqs = this.reflector.getAllAndOverride<EntitlementRequirement[]>(
      REQUIRE_ENTITLEMENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!reqs || reqs.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const tenantId: string | undefined = req.user?.tenantId;
    if (!tenantId) {
      // SUPERADMIN ESCAPE. The superadmin realm authenticates without a
      // tenant, and several superadmin controllers sit behind decorated
      // routes. The guard this replaced let them through; throwing here would
      // 403 every superadmin request the moment the guard went global.
      // JwtAuthGuard has already rejected genuinely unauthenticated calls.
      return true;
    }

    // BranchGuard resolves the active branch onto req.scope; req.user carries
    // only primary/active/allowed branch ids, never a single `branchId`.
    const branchId: string | null = req.scope?.branchId ?? null;
    const set = await this.entitlements.getForTenant(tenantId, branchId);

    for (const r of reqs) {
      const requirement = typeof r === "string" ? { feature: r } : r;

      if ("feature" in requirement) {
        if (!hasFeature(set, requirement.feature)) {
          throw await this.deny(tenantId, set, {
            type: "feature",
            key: requirement.feature,
          });
        }
      } else if ("limit" in requirement) {
        if (isUnlimitedLimit(set, requirement.limit)) continue;
        const usage =
          typeof requirement.usage === "function"
            ? await requirement.usage(req)
            : requirement.usage;
        const cap = limitOf(set, requirement.limit, 0);
        if (cap > 0 && usage >= cap) {
          throw await this.deny(tenantId, set, {
            type: "limit",
            key: requirement.limit,
            usage,
            cap,
          });
        }
      } else if ("integration" in requirement) {
        // A requirement with NO provider means "this domain must have at
        // least one vendor". `@RequiresIntegration('fiscal')` has always
        // meant that, so the alias must preserve it — `allowsIntegration`
        // alone demands a specific provider and would 403 every existing
        // integration route.
        const ok = requirement.provider
          ? allowsIntegration(
              set,
              requirement.integration,
              requirement.provider,
            )
          : (set.integrations?.[requirement.integration]?.length ?? 0) > 0;
        if (!ok) {
          throw await this.deny(tenantId, set, {
            type: "integration",
            key: requirement.integration,
          });
        }
      }
    }
    return true;
  }

  /**
   * Build the denial. Resolving the offer costs one cached catalog read and
   * one indexed ownership lookup, and only on the failure path.
   */
  private async deny(
    tenantId: string,
    set: { features?: Record<string, boolean> },
    requirement: EntitlementRequirementDetail,
  ): Promise<ForbiddenException> {
    const licensed = set.features?.[featureKey("license")] === true;
    let offer: OfferSummary | null = null;
    let reason: "not_owned" | "lapsed" = "not_owned";
    try {
      offer = (await this.offers?.forKey(tenantId, requirement.key)) ?? null;
      // With no licence, the product is unusable even once bought, so the
      // actionable next step is the licence itself.
      if (!licensed && offer?.kind !== "license") {
        offer = (await this.offers?.licenceOffer(tenantId)) ?? offer;
      }
      reason = (await this.offers?.reasonFor(tenantId, offer)) ?? "not_owned";
    } catch {
      // Never let offer resolution turn a clean 403 into a 500.
    }
    return new EntitlementRequiredException({
      requirement,
      offer,
      licenseRequired: !licensed,
      reason,
    });
  }
}
