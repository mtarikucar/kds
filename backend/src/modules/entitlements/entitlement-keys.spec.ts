import { PlanFeature } from "../../common/constants/subscription.enum";
import { classify } from "./entitlement.types";
import {
  CREDIT_KINDS,
  FEATURE_KEYS,
  LIMIT_KEYS,
  allGrantKeys,
  featureKey,
  isCreditKind,
  isKnownGrantKey,
} from "./entitlement-keys.const";

describe("entitlement key vocabulary", () => {
  it("covers every PlanFeature value", () => {
    // TRIPWIRE. P3 re-aliases @RequiresFeature(PlanFeature.X) onto
    // @RequireEntitlement({ feature: `feature.${X}` }) at 82 call sites
    // WITHOUT editing them. That rewrite is only safe while the enum's string
    // values and this vocabulary are identical. If someone adds a PlanFeature
    // without adding it here, the alias silently resolves to a key nothing
    // grants and the endpoint 403s for everyone.
    const missing = Object.values(PlanFeature).filter(
      (v) => !(FEATURE_KEYS as readonly string[]).includes(v),
    );
    expect(missing).toEqual([]);
  });

  it("adds only `license` beyond the legacy PlanFeature set", () => {
    const extra = FEATURE_KEYS.filter(
      (k) => !Object.values(PlanFeature).includes(k as PlanFeature),
    );
    expect(extra).toEqual(["license"]);
  });

  it("carries cardShift on BOTH sides of the pin", () => {
    // The two implicit assertions above already catch a one-sided add, but
    // only as a diff of two lists — which reads as "some key is missing".
    // This one names the key, so the next person to grep `cardShift` finds
    // the contract instead of inferring it.
    expect(PlanFeature.CARD_SHIFT).toBe("cardShift");
    expect(FEATURE_KEYS as readonly string[]).toContain("cardShift");
    expect(isKnownGrantKey("feature.cardShift")).toBe(true);
    expect(featureKey("cardShift")).toBe("feature.cardShift");
  });

  it("has no duplicates in any namespace", () => {
    for (const list of [FEATURE_KEYS, LIMIT_KEYS, CREDIT_KINDS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("keeps credit.* out of the entitlement fold", () => {
    // Credits are prepaid balances, not entitlements: the engine caches a
    // folded set for 30s, and a stale balance during a burst is a real money
    // bug (one 3D generation is a ~₺12 vendor charge). classify() returning
    // null is what guarantees a stray credit.* grant can never become a
    // cached feature/limit.
    for (const kind of CREDIT_KINDS) {
      expect(classify(`credit.${kind}`)).toBeNull();
    }
    expect(isCreditKind("PHOTO")).toBe(true);
    expect(isCreditKind("photo")).toBe(false);
    expect(isCreditKind("BOGUS")).toBe(false);
  });

  it("accepts the keys enforcement actually reads", () => {
    expect(isKnownGrantKey("feature.advancedReports")).toBe(true);
    expect(isKnownGrantKey("feature.license")).toBe(true);
    expect(isKnownGrantKey("limit.maxBranches")).toBe(true);
    expect(isKnownGrantKey("integration.fiscal")).toBe(true);
    expect(isKnownGrantKey("credit.MODEL3D")).toBe(true);
  });

  it("rejects the historically dead catalog keys", () => {
    // These four actually shipped. `limit.branches` was a typo for
    // limit.maxBranches and silently sold a branch-cap increase that was
    // never granted (fixed in 20260722130000_fix_extra_branch_grant); the
    // other three are granted by the catalog to this day and read by nothing.
    expect(isKnownGrantKey("limit.branches")).toBe(false);
    expect(isKnownGrantKey("limit.kdsScreens")).toBe(false);
    expect(isKnownGrantKey("limit.kdsStations")).toBe(false);
    expect(isKnownGrantKey("limit.tablets")).toBe(false);
  });

  it("rejects malformed and near-miss keys", () => {
    expect(isKnownGrantKey("advancedReports")).toBe(false); // no prefix
    expect(isKnownGrantKey(".advancedReports")).toBe(false); // empty prefix
    expect(isKnownGrantKey("feature.")).toBe(false); // empty name
    expect(isKnownGrantKey("feature.advancedReport")).toBe(false); // typo
    expect(isKnownGrantKey("plan.PRO")).toBe(false); // retired namespace
  });

  it("round-trips every advertised key through isKnownGrantKey", () => {
    for (const key of allGrantKeys()) {
      expect(isKnownGrantKey(key)).toBe(true);
    }
  });

  it("builds prefixed keys the engine can classify", () => {
    expect(featureKey("license")).toBe("feature.license");
    expect(classify(featureKey("advancedReports"))).toBe("feature");
  });
});
