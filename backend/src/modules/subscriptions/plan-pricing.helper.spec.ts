import { resolvePlanAmount, isPlanDiscountActive } from "./plan-pricing.helper";

/**
 * The advertised discounted price MUST equal the charged price. Every charge
 * rail (createSubscription / startTrial / applyUpgrade / confirmDowngrade,
 * checkout quote, havale, create-intent) routes through resolvePlanAmount, so
 * this pins its behavior.
 */
describe("resolvePlanAmount / isPlanDiscountActive", () => {
  const now = new Date("2026-06-21T00:00:00Z");
  const base = {
    monthlyPrice: "2999.00",
    yearlyPrice: "29990.00",
    discountPercentage: 25,
    discountStartDate: new Date("2026-06-01T00:00:00Z"),
    discountEndDate: new Date("2026-06-30T00:00:00Z"),
    isDiscountActive: true,
  };

  it("applies an active discount to the monthly + yearly amount", () => {
    expect(isPlanDiscountActive(base, now)).toBe(true);
    // 2999 * 0.75 = 2249.25
    expect(resolvePlanAmount(base, "MONTHLY", now).toString()).toBe("2249.25");
    // 29990 * 0.75 = 22492.5
    expect(resolvePlanAmount(base, "YEARLY", now).toString()).toBe("22492.5");
  });

  it("charges full price when isDiscountActive is false", () => {
    const plan = { ...base, isDiscountActive: false };
    expect(isPlanDiscountActive(plan, now)).toBe(false);
    expect(resolvePlanAmount(plan, "MONTHLY", now).toString()).toBe("2999");
  });

  it("charges full price when now is outside the discount window", () => {
    const after = new Date("2026-07-15T00:00:00Z");
    expect(isPlanDiscountActive(base, after)).toBe(false);
    expect(resolvePlanAmount(base, "MONTHLY", after).toString()).toBe("2999");
  });

  it("charges full price when discount fields are absent (no crash)", () => {
    const plan = { monthlyPrice: "100.00", yearlyPrice: "1000.00" };
    expect(isPlanDiscountActive(plan, now)).toBe(false);
    expect(resolvePlanAmount(plan, "MONTHLY", now).toString()).toBe("100");
    expect(resolvePlanAmount(plan, "YEARLY", now).toString()).toBe("1000");
  });
});
