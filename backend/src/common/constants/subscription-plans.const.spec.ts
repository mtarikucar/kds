import {
  SUBSCRIPTION_PLANS,
  isUnlimited,
  getPlanConfig,
} from "./subscription-plans.const";
import { SubscriptionPlanType } from "./subscription.enum";

/**
 * Long-tail spec for the static plan catalogue + helpers. Load-bearing
 * contracts: every plan type has a config whose name matches its key;
 * the -1 sentinel means "unlimited"; BUSINESS is fully unlimited while
 * FREE is capped; getPlanConfig is a direct lookup.
 */
describe("subscription-plans.const", () => {
  it("has a config for every plan type with a self-consistent name", () => {
    for (const plan of Object.values(SubscriptionPlanType)) {
      const cfg = SUBSCRIPTION_PLANS[plan];
      expect(cfg).toBeDefined();
      expect(cfg.name).toBe(plan);
    }
  });

  it("isUnlimited treats only the -1 sentinel as unlimited", () => {
    expect(isUnlimited(-1)).toBe(true);
    expect(isUnlimited(0)).toBe(false);
    expect(isUnlimited(100)).toBe(false);
  });

  it("BUSINESS has unlimited core limits and all features on", () => {
    const biz = getPlanConfig(SubscriptionPlanType.BUSINESS);
    expect(isUnlimited(biz.limits.maxUsers)).toBe(true);
    expect(isUnlimited(biz.limits.maxMonthlyOrders)).toBe(true);
    expect(Object.values(biz.features).every((f) => f === true)).toBe(true);
  });

  it("FREE is a capped plan (finite users, no advanced reports)", () => {
    const free = getPlanConfig(SubscriptionPlanType.FREE);
    expect(isUnlimited(free.limits.maxUsers)).toBe(false);
    expect(free.features.advancedReports).toBe(false);
    expect(free.monthlyPrice).toBe(0);
  });

  it("getPlanConfig returns the same object as the catalogue lookup", () => {
    expect(getPlanConfig(SubscriptionPlanType.PRO)).toBe(
      SUBSCRIPTION_PLANS[SubscriptionPlanType.PRO],
    );
  });
});
