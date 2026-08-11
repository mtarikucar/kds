import { Reflector } from "@nestjs/core";
import { RequiresFeature } from "./requires-feature.decorator";
import { RequiresIntegration } from "./requires-integration.decorator";
import { REQUIRE_ENTITLEMENT_KEY } from "../../entitlements/require-entitlement.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";

/**
 * The gating decorators are SetMetadata factories read by EntitlementGuard.
 * The load-bearing contract is the metadata KEY + VALUE on the handler — a
 * wrong key silently disables the gate and the route becomes open.
 *
 * v3.3.0 made both decorators thin aliases over `@RequireEntitlement`, which
 * is how 85 call sites across ~40 controllers migrated without being edited.
 * These tests pin the translation, because it is the thing standing between
 * "the decorator still compiles" and "the decorator still gates".
 *
 * `@RequiresPlan`, `@RequiresActiveSubscription` and `@CheckLimit` are gone:
 * the first two had zero call sites, and numeric limits (except branches, now
 * enforced inside the branch-creation transaction) no longer exist.
 */
describe("subscription gating decorators", () => {
  const reflector = new Reflector();

  it("RequiresFeature emits prefixed feature requirements", () => {
    class C {
      @RequiresFeature(PlanFeature.ADVANCED_REPORTS, PlanFeature.API_ACCESS)
      m() {}
    }
    expect(reflector.get(REQUIRE_ENTITLEMENT_KEY, C.prototype.m)).toEqual([
      { feature: "feature.advancedReports" },
      { feature: "feature.apiAccess" },
    ]);
  });

  it("maps every PlanFeature value to its engine key verbatim", () => {
    // The identity that makes the alias safe. If an enum value and its
    // entitlement key ever diverge, the decorator resolves to a key nothing
    // grants and the route 403s for everybody.
    for (const feature of Object.values(PlanFeature)) {
      class C {
        @RequiresFeature(feature)
        m() {}
      }
      expect(reflector.get(REQUIRE_ENTITLEMENT_KEY, C.prototype.m)).toEqual([
        { feature: `feature.${feature}` },
      ]);
    }
  });

  it("RequiresIntegration emits a requirement with NO provider", () => {
    // Deliberate: an integration route means "the tenant owns at least one
    // vendor in this domain". Emitting a provider here would 403 a tenant who
    // owns a different vendor in the same domain — e.g. an e-Fatura customer
    // hitting a fiscal route gated on Hugin.
    class C {
      @RequiresIntegration("fiscal", "delivery")
      m() {}
    }
    expect(reflector.get(REQUIRE_ENTITLEMENT_KEY, C.prototype.m)).toEqual([
      { integration: "integration.fiscal" },
      { integration: "integration.delivery" },
    ]);
  });

  it("attaches nothing when the decorator is absent (gates are opt-in)", () => {
    class C {
      m() {}
    }
    expect(
      reflector.get(REQUIRE_ENTITLEMENT_KEY, C.prototype.m),
    ).toBeUndefined();
  });
});
