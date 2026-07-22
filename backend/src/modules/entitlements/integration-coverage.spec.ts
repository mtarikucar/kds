import { INTEGRATION_COVERED_BY_FEATURE } from "./integration-coverage";

/**
 * Pins the domain↔plan-feature coverage map (DEF-3). See
 * integration-coverage.ts for the full rationale; this spec just locks the
 * contract both consumers (TenantMarketplaceService.isIncludedInEntitlements
 * and PlanFeatureGuard's @RequiresIntegration branch) rely on.
 */
describe("INTEGRATION_COVERED_BY_FEATURE", () => {
  it("maps the delivery domain to the deliveryIntegration plan feature", () => {
    expect(INTEGRATION_COVERED_BY_FEATURE.delivery).toBe("deliveryIntegration");
  });

  it("has no covering feature for fiscal — add-on-only, vendor-list based", () => {
    expect(INTEGRATION_COVERED_BY_FEATURE.fiscal).toBeUndefined();
  });

  it("has no covering feature for caller — add-on-only, vendor-list based", () => {
    expect(INTEGRATION_COVERED_BY_FEATURE.caller).toBeUndefined();
  });

  it("is frozen so a future edit can't accidentally mutate it at runtime", () => {
    expect(Object.isFrozen(INTEGRATION_COVERED_BY_FEATURE)).toBe(true);
  });
});
