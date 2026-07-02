import { ADDONS } from "../../../prisma/seeds/seed-marketplace";

/**
 * Catalog invariants for marketplace add-on grants.
 *
 * Regression guard for the caller-feed bug: `caller_id_integration` used to
 * grant `feature.callerIntegration`, but the caller feed is gated as an
 * INTEGRATION on every surface — the frontend route + sidebar use
 * `FeatureGate integration={{ domain: 'caller' }}` and the backend endpoint
 * uses `@RequiresIntegration('caller')`, all resolving the entitlement-engine
 * key `integration.caller`. A `feature.*` grant satisfied none of them, so a
 * paying tenant still got a 403 on `GET /caller/recent` and a hidden nav
 * (upsell shown). These tests lock the contract so an integration add-on can
 * never again grant a key that no gate reads.
 */
describe("marketplace add-on grants", () => {
  const byCode = (code: string) => ADDONS.find((a) => a.code === code);

  it("every kind:'integration' add-on grants at least one integration.* key", () => {
    const integrationAddOns = ADDONS.filter((a) => a.kind === "integration");
    expect(integrationAddOns.length).toBeGreaterThan(0);

    const offenders = integrationAddOns.filter((a) => {
      const keys = Object.keys((a.grants as Record<string, unknown>) ?? {});
      return !keys.some((k) => k.startsWith("integration."));
    });

    // Name the offending codes so a failure points straight at the culprit.
    expect(offenders.map((a) => a.code)).toEqual([]);
  });

  it("caller_id_integration grants integration.caller (never a feature.* key)", () => {
    const caller = byCode("caller_id_integration");
    expect(caller).toBeDefined();

    const grants = (caller!.grants as Record<string, unknown>) ?? {};
    expect(grants["integration.caller"]).toEqual(["generic"]);
    expect(grants["feature.callerIntegration"]).toBeUndefined();
  });
});
