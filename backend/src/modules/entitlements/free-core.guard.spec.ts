import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { EntitlementGuard } from "./entitlement.guard";
import { REQUIRE_ENTITLEMENT_KEY } from "./require-entitlement.decorator";
import { FREE_BASELINE_GRANTS } from "./free-baseline.const";

/**
 * The free-core flip, from the guard's side.
 *
 * EntitlementGuard is now GLOBAL and is the only entitlement gate: the legacy
 * `@RequiresFeature` / `@RequiresIntegration` decorators are aliases that
 * resolve here. Three properties matter enough to pin, because each of them
 * failing is invisible until a customer hits it:
 *
 *   - an undecorated route is open (otherwise going global locks the product);
 *   - a superadmin request, which carries no tenant, is not 403'd;
 *   - a denial names something the customer can actually buy.
 */
describe("EntitlementGuard — free core", () => {
  let reflector: Reflector;
  let entitlements: { getForTenant: jest.Mock };
  let offers: {
    forKey: jest.Mock;
    licenceOffer: jest.Mock;
    reasonFor: jest.Mock;
  };
  let guard: EntitlementGuard;

  const OFFER = {
    code: "advanced_reports",
    name: "Gelişmiş Rapor & Analitik",
    kind: "module",
    annualPriceCents: 129_000,
    proratedCents: 125_466,
    currency: "TRY",
    periodEnd: "2027-03-10T00:00:00.000Z",
  };

  function ctx(meta: Record<string, unknown>, user: unknown = { tenantId: "t-1" }) {
    return {
      getHandler: () => ({ __meta: meta }),
      getClass: () => ({ __meta: {} }),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  const baseline = () => ({
    features: Object.fromEntries(
      Object.entries(FREE_BASELINE_GRANTS)
        .filter(([, v]) => v === true)
        .map(([k]) => [k, true]),
    ),
    limits: Object.fromEntries(
      Object.entries(FREE_BASELINE_GRANTS).filter(
        ([, v]) => typeof v === "number",
      ),
    ),
    integrations: {},
  });

  beforeEach(() => {
    reflector = new Reflector();
    (reflector.getAllAndOverride as any) = jest.fn(
      (key: string, targets: any[]) => {
        for (const t of targets) if (t?.__meta && key in t.__meta) return t.__meta[key];
        return undefined;
      },
    );
    entitlements = { getForTenant: jest.fn().mockResolvedValue(baseline()) };
    offers = {
      forKey: jest.fn().mockResolvedValue(OFFER),
      licenceOffer: jest.fn().mockResolvedValue({ ...OFFER, kind: "license" }),
      reasonFor: jest.fn().mockResolvedValue("not_owned"),
    };
    guard = new EntitlementGuard(reflector, entitlements as any, offers as any);
  });

  it("lets an UNDECORATED route through — gates are opt-in", async () => {
    // The guard runs on every request now. If it defaulted to deny, going
    // global would lock the entire product.
    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(entitlements.getForTenant).not.toHaveBeenCalled();
  });

  it("lets the free core through with no purchase at all", async () => {
    for (const key of ["feature.posAccess", "feature.kdsIntegration"]) {
      await expect(
        guard.canActivate(ctx({ [REQUIRE_ENTITLEMENT_KEY]: [{ feature: key }] })),
      ).resolves.toBe(true);
    }
  });

  it("lets a SUPERADMIN request through (no tenant to entitle)", async () => {
    // The superadmin realm authenticates without a tenantId and several of
    // its controllers sit behind decorated routes. Throwing here would 403
    // every superadmin request the moment the guard went global.
    await expect(
      guard.canActivate(
        ctx(
          { [REQUIRE_ENTITLEMENT_KEY]: [{ feature: "feature.advancedReports" }] },
          { id: "sa-1" },
        ),
      ),
    ).resolves.toBe(true);
  });

  it("denies a paid feature and names the product plus TODAY's price", async () => {
    entitlements.getForTenant.mockResolvedValue({
      ...baseline(),
      features: { ...baseline().features, "feature.license": true },
    });

    await expect(
      guard.canActivate(
        ctx({
          [REQUIRE_ENTITLEMENT_KEY]: [{ feature: "feature.advancedReports" }],
        }),
      ),
    ).rejects.toMatchObject({
      response: {
        errorCode: "ENTITLEMENT_REQUIRED",
        licenseRequired: false,
        reason: "not_owned",
        offer: expect.objectContaining({
          code: "advanced_reports",
          proratedCents: 125_466,
        }),
      },
    });
  });

  it("points an UNLICENSED tenant at the licence, not at the module", async () => {
    // Buying the module first would be money for access they cannot exercise:
    // the projector suppresses every requiresLicense product while the licence
    // is dark.
    await expect(
      guard.canActivate(
        ctx({
          [REQUIRE_ENTITLEMENT_KEY]: [{ feature: "feature.advancedReports" }],
        }),
      ),
    ).rejects.toMatchObject({
      response: {
        licenseRequired: true,
        offer: expect.objectContaining({ kind: "license" }),
      },
    });
  });

  it("says 'lapsed' when the tenant used to own it", async () => {
    entitlements.getForTenant.mockResolvedValue({
      ...baseline(),
      features: { ...baseline().features, "feature.license": true },
    });
    offers.reasonFor.mockResolvedValue("lapsed");

    await expect(
      guard.canActivate(
        ctx({
          [REQUIRE_ENTITLEMENT_KEY]: [{ feature: "feature.advancedReports" }],
        }),
      ),
    ).rejects.toMatchObject({ response: { reason: "lapsed" } });
  });

  it("still denies cleanly when offer resolution blows up", async () => {
    // A 403 must never become a 500 because the upsell lookup failed.
    offers.forKey.mockRejectedValue(new Error("catalog down"));
    offers.licenceOffer.mockRejectedValue(new Error("catalog down"));

    await expect(
      guard.canActivate(
        ctx({
          [REQUIRE_ENTITLEMENT_KEY]: [{ feature: "feature.advancedReports" }],
        }),
      ),
    ).rejects.toMatchObject({
      response: { errorCode: "ENTITLEMENT_REQUIRED", offer: null },
    });
  });

  it("treats -1 as unlimited on a limit requirement", async () => {
    await expect(
      guard.canActivate(
        ctx({
          [REQUIRE_ENTITLEMENT_KEY]: [
            { limit: "limit.maxTables", usage: 10_000 },
          ],
        }),
      ),
    ).resolves.toBe(true);
  });
});
