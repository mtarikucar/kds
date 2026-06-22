import { foldPlanGrants, PlanGrantSource } from "./effective-features.fold";

const PLAN: PlanGrantSource = {
  advancedReports: false,
  multiLocation: false,
  customBranding: false,
  apiAccess: false,
  prioritySupport: false,
  inventoryTracking: false,
  kdsIntegration: true,
  reservationSystem: false,
  personnelManagement: false,
  deliveryIntegration: false,
  posAccess: true,
  externalDisplay: false,
  maxUsers: 5,
  maxTables: 10,
  maxBranches: 1,
  maxProducts: 100,
  maxCategories: 20,
  maxMonthlyOrders: 1000,
};

describe("foldPlanGrants", () => {
  it("returns the plan base when there are no add-ons or overrides", () => {
    const r = foldPlanGrants(PLAN, [], null, null);
    expect(r.features.posAccess).toBe(true);
    expect(r.features.advancedReports).toBe(false);
    expect(r.limits.maxUsers).toBe(5);
    expect(r.integrations).toEqual({});
  });

  it("OR-trues add-on features, SUMs add-on limits × qty, unions integrations", () => {
    const r = foldPlanGrants(
      PLAN,
      [
        {
          grants: {
            "feature.advancedReports": true,
            "limit.maxUsers": 3,
            "integration.delivery": ["trendyol", "getir"],
          },
          quantity: 2,
        },
      ],
      null,
      null,
    );
    expect(r.features.advancedReports).toBe(true); // OR-true
    expect(r.limits.maxUsers).toBe(5 + 3 * 2); // SUM × qty = 11
    expect(r.integrations.delivery).toEqual(["trendyol", "getir"]);
  });

  it("preserves -1 (unlimited) when an add-on or base limit is unlimited", () => {
    const r = foldPlanGrants(
      { ...PLAN, maxUsers: -1 },
      [{ grants: { "limit.maxUsers": 50 }, quantity: 1 }],
      null,
      null,
    );
    expect(r.limits.maxUsers).toBe(-1);

    const r2 = foldPlanGrants(
      PLAN,
      [{ grants: { "limit.maxUsers": -1 }, quantity: 1 }],
      null,
      null,
    );
    expect(r2.limits.maxUsers).toBe(-1);
  });

  it("applies tenant overrides last (REPLACE), ignoring unknown keys", () => {
    const r = foldPlanGrants(
      PLAN,
      [{ grants: { "feature.advancedReports": true }, quantity: 1 }],
      { advancedReports: false, posAccess: false, unknownFeature: true },
      { maxUsers: 99, unknownLimit: 7 },
    );
    expect(r.features.advancedReports).toBe(false); // override beats add-on OR-true
    expect(r.features.posAccess).toBe(false);
    expect(r.features.unknownFeature).toBeUndefined(); // unknown key ignored
    expect(r.limits.maxUsers).toBe(99);
    expect(r.limits.unknownLimit).toBeUndefined();
  });

  it("dedupes integration vendors across add-ons", () => {
    const r = foldPlanGrants(
      PLAN,
      [
        { grants: { "integration.delivery": ["trendyol"] }, quantity: 1 },
        { grants: { "integration.delivery": ["trendyol", "getir"] }, quantity: 1 },
      ],
      null,
      null,
    );
    expect(r.integrations.delivery).toEqual(["trendyol", "getir"]);
  });
});
