import { describe, it, expect } from "vitest";
import { PLANS, fmtTRY } from "./plans";

// These assertions pin the marketing prices/matrix to the real backend values
// (subscription-plans.const.ts). If the backend plans change, this test should
// fail so the landing page is updated deliberately, not left stale.
describe("marketing plans", () => {
  const byKey = Object.fromEntries(PLANS.map((p) => [p.key, p]));

  it("has the four real tiers", () => {
    expect(PLANS.map((p) => p.key)).toEqual([
      "TRIAL",
      "BASIC",
      "PRO",
      "BUSINESS",
    ]);
  });

  it("uses the real code-verified monthly prices", () => {
    expect(byKey.TRIAL.monthly).toBeNull();
    expect(byKey.BASIC.monthly).toBe(499);
    expect(byKey.PRO.monthly).toBe(1299);
    expect(byKey.BUSINESS.monthly).toBe(2999);
  });

  it("uses the real yearly prices", () => {
    expect(byKey.BASIC.yearly).toBe(4490);
    expect(byKey.PRO.yearly).toBe(12990);
    expect(byKey.BUSINESS.yearly).toBe(29990);
  });

  it("gates the advanced band and API/external correctly", () => {
    expect(byKey.BASIC.features.advancedReports).toBe(false);
    expect(byKey.PRO.features.advancedReports).toBe(true);
    expect(byKey.PRO.features.apiAccess).toBe(false); // PRO has no API
    expect(byKey.BUSINESS.features.apiAccess).toBe(true);
    expect(byKey.TRIAL.features.externalDisplay).toBe(true);
    expect(byKey.BASIC.features.externalDisplay).toBe(false);
  });

  it("marks PRO as the highlighted plan", () => {
    expect(byKey.PRO.highlight).toBe(true);
  });

  it("formats TRY with tr-TR grouping", () => {
    expect(fmtTRY(1299)).toBe("1.299 ₺");
    expect(fmtTRY(29990)).toBe("29.990 ₺");
  });
});
