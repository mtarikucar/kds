import {
  SubscriptionPlanType,
  SubscriptionStatus,
  BillingCycle,
  PaymentProvider,
  InvoiceStatus,
  PlanFeature,
} from "./subscription.enum";

/**
 * Long-tail drift-guard for billing-domain enums. SubscriptionStatus and
 * the plan types feed partial-unique DB indexes + feature gating, so we
 * pin the load-bearing members: PENDING (pre-activation, no feature grant),
 * TRIALING/ACTIVE (the access-granting states), and that PlanFeature values
 * are camelCase feature flags (they key into the JSON feature column).
 */
describe("subscription enums", () => {
  it("uses value===name for the status-ish billing enums", () => {
    const valueEqualsName = (e: Record<string, string>) =>
      Object.entries(e).forEach(([name, value]) => expect(value).toBe(name));
    valueEqualsName(SubscriptionPlanType);
    valueEqualsName(SubscriptionStatus);
    valueEqualsName(BillingCycle);
    valueEqualsName(InvoiceStatus);
  });

  it("keeps the access-granting and pre-activation statuses", () => {
    expect(SubscriptionStatus.ACTIVE).toBe("ACTIVE");
    expect(SubscriptionStatus.TRIALING).toBe("TRIALING");
    expect(SubscriptionStatus.PENDING).toBe("PENDING");
  });

  it("PlanFeature values are camelCase feature-flag keys (JSON column keys)", () => {
    for (const v of Object.values(PlanFeature)) {
      expect(v).toMatch(/^[a-z][a-zA-Z]+$/);
    }
    expect(PlanFeature.POS_ACCESS).toBe("posAccess");
  });

  it("exposes PAYTR as a payment provider (dispatch key)", () => {
    expect(PaymentProvider.PAYTR).toBe("PAYTR");
  });
});
