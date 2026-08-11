import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRE_ENTITLEMENT_KEY } from "../../entitlements/require-entitlement.decorator";
import { EntitlementGuard } from "../../entitlements/entitlement.guard";
import { DeliveryPlatformsController } from "./delivery-platforms.controller";
import { DeliveryDlqController } from "./delivery-dlq.controller";

/**
 * DEF-3 regression, carried forward to the à-la-carte guard.
 *
 * The delivery routes used to gate on `feature.deliveryIntegration` alone,
 * while the delivery add-ons grant `integration.delivery=[vendor]`. A tenant
 * who BOUGHT a delivery platform therefore still got a 403 on every delivery
 * route — paid and broken. The controllers were moved to
 * `@RequiresIntegration('delivery')`.
 *
 * v3.3.0 kept that contract while replacing the guard beneath it. The subtle
 * part is that `@RequiresIntegration('delivery')` must emit a requirement with
 * NO provider: "the tenant owns at least one delivery vendor". If the alias
 * ever started naming a specific vendor, a Getir customer would 403 on a route
 * a Yemeksepeti customer could reach.
 */
describe("Delivery route gate (DEF-3)", () => {
  let reflector: Reflector;
  let entitlements: any;
  let guard: EntitlementGuard;

  function ctx(handlerMeta: Record<string, unknown>) {
    return {
      getHandler: () => ({ __meta: handlerMeta }),
      getClass: () => ({ __meta: {} }),
      switchToHttp: () => ({
        getRequest: () => ({ user: { tenantId: "t-1" } }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    (reflector.getAllAndOverride as any) = jest.fn(
      (key: string, targets: any[]) => {
        for (const t of targets) {
          if (t?.__meta && key in t.__meta) return t.__meta[key];
        }
        return undefined;
      },
    );
    entitlements = { getForTenant: jest.fn() };
    guard = new EntitlementGuard(reflector, entitlements as any);
  });

  it("both delivery controllers gate on the integration domain, not a feature", () => {
    const real = new Reflector();
    for (const target of [
      DeliveryPlatformsController,
      DeliveryDlqController,
    ]) {
      const reqs = real.get(REQUIRE_ENTITLEMENT_KEY, target);
      expect(reqs).toEqual([{ integration: "integration.delivery" }]);
    }
  });

  it("passes a tenant who owns ANY delivery vendor", async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: { "integration.delivery": ["getir"] },
    });

    await expect(
      guard.canActivate(
        ctx({
          [REQUIRE_ENTITLEMENT_KEY]: [{ integration: "integration.delivery" }],
        }),
      ),
    ).resolves.toBe(true);
  });

  it("passes a tenant who owns a DIFFERENT vendor in the same domain", async () => {
    // The regression this guards: a provider-specific check would 403 here.
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: { "integration.delivery": ["yemeksepeti"] },
    });

    await expect(
      guard.canActivate(
        ctx({
          [REQUIRE_ENTITLEMENT_KEY]: [{ integration: "integration.delivery" }],
        }),
      ),
    ).resolves.toBe(true);
  });

  it("denies a tenant with no delivery vendor at all", async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: {},
    });

    await expect(
      guard.canActivate(
        ctx({
          [REQUIRE_ENTITLEMENT_KEY]: [{ integration: "integration.delivery" }],
        }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "ENTITLEMENT_REQUIRED" }),
    });
  });

  it("denies when the domain key exists but is empty", async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: { "integration.delivery": [] },
    });

    await expect(
      guard.canActivate(
        ctx({
          [REQUIRE_ENTITLEMENT_KEY]: [{ integration: "integration.delivery" }],
        }),
      ),
    ).rejects.toBeDefined();
  });
});
