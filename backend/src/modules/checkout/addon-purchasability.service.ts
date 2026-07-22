import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AddOnCatalogService } from "../marketplace/addon-catalog.service";
import { TenantMarketplaceService } from "../marketplace/tenant-marketplace.service";
import { EntitlementService } from "../entitlements/entitlement.service";
import { SUBSCRIPTION_PLANS } from "../../common/constants/subscription-plans.const";
import { SubscriptionPlanType } from "../../common/constants/subscription.enum";

export type AddonPurchasabilityErrorCode =
  | "ADDON_INCLUDED_IN_PLAN"
  | "ADDON_ALREADY_OWNED"
  | "ADDON_REQUIRES_PLAN"
  | "ADDON_LIMIT_REDUNDANT";

export interface AssertPurchasableInput {
  addOnCode: string;
  branchId?: string;
  quantity?: number;
}

/**
 * Pre-payment purchasability gate for marketplace add-ons.
 *
 * `TenantMarketplaceService.purchase()` already runs an included-in-plan
 * fold, an active-duplicate guard, and a deps check — but ONLY inside
 * `purchase()` / `confirmAndProvision`, which runs AFTER PayTR has settled
 * the charge. That means a tenant can pay full price for an add-on their
 * plan already includes, one they already actively own, or one whose deps
 * they don't meet: `purchase()` then rejects the grant and there is no
 * refund rail (DEF-1 / DEF-2 / DEF-4).
 *
 * This service lifts the SAME three checks (plus the DEF-8 redundant-limit
 * check) in front of payment. `CheckoutIntentService.createIntent` calls
 * `assertPurchasable()` for every `addon` cart line BEFORE minting a
 * CheckoutIntent row or calling PayTR, so a doomed purchase never reaches
 * the payment gateway. `purchase()`'s own guards are NOT removed — they
 * stay as defence in depth for any caller that bypasses checkout (a direct
 * superadmin-comp path, a future integration, a replayed request).
 */
@Injectable()
export class AddonPurchasabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: AddOnCatalogService,
    private readonly entitlements: EntitlementService,
  ) {}

  async assertPurchasable(
    tenantId: string,
    input: AssertPurchasableInput,
  ): Promise<void> {
    const addOn = await this.catalog.findByCodeOrThrow(input.addOnCode);
    const grants = (addOn.grants as Record<string, unknown> | null) ?? null;
    const ent = await this.entitlements.getForTenant(tenantId);

    // 1) Already covered by the tenant's effective entitlements (plan +
    // existing add-ons + overrides) — paying again buys nothing (DEF-1).
    if (TenantMarketplaceService.isIncludedInEntitlements(grants, ent)) {
      this.reject(
        "ADDON_INCLUDED_IN_PLAN",
        addOn.code,
        `"${addOn.name}" is already included in your current plan.`,
      );
    }

    // 2) Already actively owned for this exact (tenant, addOn, branch)
    // identity — re-buying just gets rejected downstream with no refund
    // rail (DEF-2). Mirrors purchase()'s tenant-scope duplicate guard.
    const activeOwned = await this.prisma.tenantAddOn.findFirst({
      where: {
        tenantId,
        addOnId: addOn.id,
        branchId: input.branchId ?? null,
        status: "active",
      },
    });
    if (activeOwned) {
      this.reject(
        "ADDON_ALREADY_OWNED",
        addOn.code,
        `"${addOn.name}" is already active for this ${
          input.branchId ? "branch" : "tenant"
        }. Cancel the existing subscription or change quantity instead.`,
      );
    }

    // 3) Deps — tenant-tier-aware "plan:X and above" semantics for
    // plan:<NAME> deps, plus active-add-on deps. purchase() checks this
    // too, but with STRICT plan-name equality (`plan:${planName} !== dep`),
    // which incorrectly blocks a BUSINESS tenant from an addon that only
    // requires plan:PRO. Moved here tier-aware (DEF-4).
    if (addOn.deps.length > 0) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { currentPlan: { select: { name: true } } },
      });
      if (!tenant) throw new NotFoundException("Tenant not found");
      const planName = tenant.currentPlan?.name ?? null;

      const activeAddOns = await this.prisma.tenantAddOn.findMany({
        where: { tenantId, status: "active" },
        include: { addOn: { select: { code: true } } },
      });
      const haveAddOnCodes = new Set(activeAddOns.map((ta) => ta.addOn.code));

      for (const dep of addOn.deps) {
        if (dep.startsWith("plan:")) {
          const depPlan = dep.slice("plan:".length);
          if (this.planRank(planName) < this.planRank(depPlan)) {
            this.reject(
              "ADDON_REQUIRES_PLAN",
              addOn.code,
              `"${addOn.name}" requires the ${depPlan} plan or above. Upgrade your plan first.`,
            );
          }
        } else if (!haveAddOnCodes.has(dep)) {
          this.reject(
            "ADDON_REQUIRES_PLAN",
            addOn.code,
            `"${addOn.name}" requires the "${dep}" add-on first.`,
          );
        }
      }
    }

    // 4) Redundant capacity (DEF-8) — a limit.* grant whose corresponding
    // effective limit is already unlimited (-1) buys nothing. Grant keys
    // match the engine's effective-limit namespace 1:1 (Task 5 fixed
    // extra_branch's grant to write `limit.maxBranches`, the same key
    // PlanProjectorService.LIMIT_COLUMNS / PlanFeatureGuard.checkLimit
    // read), so no key-remapping layer is needed here anymore.
    for (const [key] of Object.entries(grants ?? {})) {
      if (!key.startsWith("limit.")) continue;
      if (ent.limits?.[key] === -1) {
        this.reject(
          "ADDON_LIMIT_REDUNDANT",
          addOn.code,
          `"${addOn.name}" adds capacity you already have unlimited.`,
        );
      }
    }
  }

  /**
   * Rank source for "plan:X and above" deps semantics.
   *
   * `SUBSCRIPTION_PLANS[*].monthlyPrice` is monotonically increasing —
   * FREE(0) < BASIC(499) < PRO(1299) < BUSINESS(2999) — which is the exact
   * ordering `subscription.service.ts`'s `changePlan()` already derives
   * `isUpgrade` from (`newAmount.gt(currentAmount)`), and the invariant
   * `feature-plan-matrix.spec.ts` pins as "feature grants are monotonic up
   * the tiers (FREE subset BASIC subset PRO subset BUSINESS)". Reusing this
   * price ordering (instead of a fresh hardcoded rank array) keeps the
   * "and above" semantics from silently drifting out of sync with the rest
   * of the upgrade/downgrade logic if plan pricing is ever restructured.
   *
   * TRIAL and an unrecognised/absent plan both rank at -1 (below every paid
   * tier). This matches purchase()'s PRE-EXISTING strict-equality behaviour
   * for TRIAL — today `plan:TRIAL !== plan:PRO` already blocks the
   * purchase — so routing TRIAL through the tier rank instead of a string
   * compare is not a regression, just the same fail-closed outcome.
   */
  private planRank(planName: string | null | undefined): number {
    if (!planName) return -1;
    const cfg = SUBSCRIPTION_PLANS[planName as SubscriptionPlanType];
    return cfg ? cfg.monthlyPrice : -1;
  }

  private reject(
    code: AddonPurchasabilityErrorCode,
    addOnCode: string,
    message: string,
  ): never {
    throw new ConflictException({ code, message, addOnCode });
  }
}
