import { TenantMarketplaceService } from "./tenant-marketplace.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { EntitlementSet } from "../entitlements/entitlement.types";

function ent(partial: Partial<EntitlementSet> = {}): EntitlementSet {
  return {
    features: {},
    limits: {},
    integrations: {},
    computedAt: new Date("2026-01-01").toISOString(),
    ...partial,
  } as EntitlementSet;
}

/**
 * The marketplace must not try to sell a tenant a feature their plan already
 * includes. isIncludedInEntitlements folds an add-on's grants against the
 * tenant's effective entitlement set (same prefixed key namespace on both
 * sides) and listAvailable annotates the catalogue with the result.
 */
describe("TenantMarketplaceService.isIncludedInEntitlements", () => {
  const fn = TenantMarketplaceService.isIncludedInEntitlements;

  it("feature add-on: included when the plan already grants the feature", () => {
    expect(
      fn(
        { "feature.reservationSystem": true },
        ent({ features: { "feature.reservationSystem": true } }),
      ),
    ).toBe(true);
  });

  it("feature add-on: NOT included when the plan lacks the feature", () => {
    expect(
      fn(
        { "feature.reservationSystem": true },
        ent({ features: { "feature.reservationSystem": false } }),
      ),
    ).toBe(false);
    expect(fn({ "feature.advancedReports": true }, ent())).toBe(false);
  });

  it("capacity add-on (any limit.* grant) is NEVER included — capacity is additive", () => {
    // Even if some companion feature is already on, a limit grant keeps it buyable.
    expect(
      fn(
        { "limit.kdsScreens": 1 },
        ent({ limits: { "limit.kdsScreens": 5 } }),
      ),
    ).toBe(false);
    expect(
      fn(
        { "limit.branches": 1, "feature.multiLocation": true },
        ent({ features: { "feature.multiLocation": true } }),
      ),
    ).toBe(false);
  });

  it("integration add-on: included only when EVERY vendor is already present", () => {
    expect(
      fn(
        { "integration.delivery": ["yemeksepeti"] },
        ent({ integrations: { "integration.delivery": ["yemeksepeti", "getir"] } }),
      ),
    ).toBe(true);
    expect(
      fn(
        { "integration.delivery": ["yemeksepeti", "trendyol_yemek"] },
        ent({ integrations: { "integration.delivery": ["yemeksepeti"] } }),
      ),
    ).toBe(false);
  });

  it("no-grant add-on (one-time service) is never included", () => {
    expect(fn({}, ent({ features: { "feature.x": true } }))).toBe(false);
    expect(fn(null, ent())).toBe(false);
  });

  it("unknown grant namespace is treated as purchasable (not included)", () => {
    expect(fn({ "mystery.thing": true }, ent())).toBe(false);
  });

  it("multi-grant feature add-on needs ALL features covered", () => {
    expect(
      fn(
        { "feature.a": true, "feature.b": true },
        ent({ features: { "feature.a": true } }),
      ),
    ).toBe(false);
    expect(
      fn(
        { "feature.a": true, "feature.b": true },
        ent({ features: { "feature.a": true, "feature.b": true } }),
      ),
    ).toBe(true);
  });
});

describe("TenantMarketplaceService.listAvailable", () => {
  let prisma: MockPrismaClient;
  let svc: TenantMarketplaceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const entitlements = {
      getForTenant: jest.fn().mockResolvedValue(
        ent({ features: { "feature.reservationSystem": true } }),
      ),
    };
    svc = new TenantMarketplaceService(
      prisma as any,
      { findByCodeOrThrow: jest.fn() } as any,
      { append: jest.fn() } as any,
      entitlements as any,
    );
  });

  it("annotates includedInPlan and never leaks grants", async () => {
    (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([
      {
        code: "reservation_system",
        name: "Reservation system",
        description: "d",
        kind: "software",
        billing: "recurring",
        priceCents: 9900,
        currency: "TRY",
        deps: [],
        grants: { "feature.reservationSystem": true },
        status: "published",
        id: "a1",
      },
      {
        code: "advanced_reports",
        name: "Advanced reports",
        description: "d",
        kind: "software",
        billing: "recurring",
        priceCents: 12900,
        currency: "TRY",
        deps: [],
        grants: { "feature.advancedReports": true },
        status: "published",
        id: "a2",
      },
    ]);

    const res = await svc.listAvailable("t1");

    expect(res[0]).toMatchObject({
      code: "reservation_system",
      includedInPlan: true,
    });
    expect(res[1]).toMatchObject({
      code: "advanced_reports",
      includedInPlan: false,
    });
    // grants and status must not be projected into the response.
    expect(res[0]).not.toHaveProperty("grants");
    expect(res[0]).not.toHaveProperty("status");
    expect(res[0]).not.toHaveProperty("id");
  });
});
