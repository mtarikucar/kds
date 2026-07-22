import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { REQUIRED_INTEGRATIONS_KEY } from "../../subscriptions/decorators/requires-integration.decorator";
import { REQUIRED_FEATURES_KEY } from "../../subscriptions/decorators/requires-feature.decorator";
import { DeliveryPlatformsController } from "./delivery-platforms.controller";
import { DeliveryDlqController } from "./delivery-dlq.controller";

/**
 * DEF-3 regression: the delivery route gate used to read ONLY
 * feature.deliveryIntegration (@RequiresFeature(PlanFeature.DELIVERY_INTEGRATION)),
 * while the delivery_yemeksepeti/getir/trendyol_yemek add-ons grant
 * integration.delivery=[vendor]. A BASIC tenant who bought the add-on had
 * integration.delivery populated but no feature.deliveryIntegration, so
 * every delivery-platforms route still 403'd — paid-but-broken.
 *
 * Fix: the controllers now gate on @RequiresIntegration('delivery'), and
 * PlanFeatureGuard's integration branch accepts EITHER a non-empty vendor
 * list OR the covering plan feature (INTEGRATION_COVERED_BY_FEATURE) being
 * true — so a plan-delivery tenant and an add-on-delivery tenant both pass.
 */
describe("Delivery route gate (DEF-3)", () => {
  let reflector: Reflector;
  let prisma: any;
  let entitlements: any;
  let guard: PlanFeatureGuard;

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
    prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: "t-1",
          currentPlan: { name: "BASIC", displayName: "Basic" },
          featureOverrides: null,
          limitOverrides: null,
        }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ status: "ACTIVE" }),
      },
    };
    entitlements = { getForTenant: jest.fn() };
    guard = new PlanFeatureGuard(reflector, prisma as any, entitlements as any);
  });

  it("both delivery controllers gate on @RequiresIntegration('delivery'), not @RequiresFeature", () => {
    expect(
      Reflect.getMetadata(REQUIRED_INTEGRATIONS_KEY, DeliveryPlatformsController),
    ).toEqual(["delivery"]);
    expect(
      Reflect.getMetadata(REQUIRED_FEATURES_KEY, DeliveryPlatformsController),
    ).toBeUndefined();

    expect(
      Reflect.getMetadata(REQUIRED_INTEGRATIONS_KEY, DeliveryDlqController),
    ).toEqual(["delivery"]);
    expect(
      Reflect.getMetadata(REQUIRED_FEATURES_KEY, DeliveryDlqController),
    ).toBeUndefined();
  });

  it("a plan-delivery BASIC tenant (feature.deliveryIntegration=true, NO integration.delivery grant) passes the gate", async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: { "feature.deliveryIntegration": true },
      limits: {},
      integrations: {},
      computedAt: new Date().toISOString(),
    });
    const c = ctx({ [REQUIRED_INTEGRATIONS_KEY]: ["delivery"] });
    await expect(guard.canActivate(c)).resolves.toBe(true);
  });

  it("an add-on-delivery BASIC tenant (integration.delivery=[yemeksepeti], NO covering feature) passes the gate — the add-on they paid for actually unlocks the route", async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: { "integration.delivery": ["yemeksepeti"] },
      computedAt: new Date().toISOString(),
    });
    const c = ctx({ [REQUIRED_INTEGRATIONS_KEY]: ["delivery"] });
    await expect(guard.canActivate(c)).resolves.toBe(true);
  });

  it("a tenant with neither the feature nor the integration grant is rejected", async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: {},
      computedAt: new Date().toISOString(),
    });
    const c = ctx({ [REQUIRED_INTEGRATIONS_KEY]: ["delivery"] });
    await expect(guard.canActivate(c)).rejects.toThrow(/delivery/);
  });

  it("fiscal is unaffected: feature.deliveryIntegration=true does NOT spuriously cover a fiscal gate", async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: { "feature.deliveryIntegration": true },
      limits: {},
      integrations: {}, // no fiscal vendor grant
      computedAt: new Date().toISOString(),
    });
    const c = ctx({ [REQUIRED_INTEGRATIONS_KEY]: ["fiscal"] });
    await expect(guard.canActivate(c)).rejects.toThrow(/fiscal/);
  });
});
