import { Reflector } from "@nestjs/core";
import {
  RequiresFeature,
  REQUIRED_FEATURES_KEY,
} from "./requires-feature.decorator";
import { RequiresPlan, REQUIRED_PLANS_KEY } from "./requires-plan.decorator";
import {
  RequiresActiveSubscription,
  REQUIRES_ACTIVE_SUBSCRIPTION_KEY,
} from "./requires-active-subscription.decorator";
import { CheckLimit, CHECK_LIMIT_KEY, LimitType } from "./check-limit.decorator";
import {
  PlanFeature,
  SubscriptionPlanType,
} from "../../../common/constants/subscription.enum";

/**
 * Long-tail spec for the subscription gating decorators. These are
 * SetMetadata factories read by SubscriptionGuard/PlanFeatureGuard. The
 * load-bearing contract is the metadata KEY + VALUE attached to the handler
 * — a wrong key would silently disable the gate (route becomes open).
 */
describe("subscription gating decorators", () => {
  const reflector = new Reflector();

  it("RequiresFeature stores the feature list under REQUIRED_FEATURES_KEY", () => {
    class C {
      @RequiresFeature(PlanFeature.ADVANCED_REPORTS, PlanFeature.API_ACCESS)
      m() {}
    }
    const meta = reflector.get(REQUIRED_FEATURES_KEY, C.prototype.m);
    expect(meta).toEqual([
      PlanFeature.ADVANCED_REPORTS,
      PlanFeature.API_ACCESS,
    ]);
  });

  it("RequiresPlan stores the allowed plan list under REQUIRED_PLANS_KEY", () => {
    class C {
      @RequiresPlan(SubscriptionPlanType.PRO, SubscriptionPlanType.BUSINESS)
      m() {}
    }
    const meta = reflector.get(REQUIRED_PLANS_KEY, C.prototype.m);
    expect(meta).toEqual([
      SubscriptionPlanType.PRO,
      SubscriptionPlanType.BUSINESS,
    ]);
  });

  it("RequiresActiveSubscription stores true under its key", () => {
    class C {
      @RequiresActiveSubscription()
      m() {}
    }
    expect(
      reflector.get(REQUIRES_ACTIVE_SUBSCRIPTION_KEY, C.prototype.m),
    ).toBe(true);
  });

  it("CheckLimit stores the limit type under CHECK_LIMIT_KEY", () => {
    class C {
      @CheckLimit(LimitType.PRODUCTS)
      m() {}
    }
    expect(reflector.get(CHECK_LIMIT_KEY, C.prototype.m)).toBe(
      LimitType.PRODUCTS,
    );
    expect(LimitType.PRODUCTS).toBe("maxProducts");
  });
});
