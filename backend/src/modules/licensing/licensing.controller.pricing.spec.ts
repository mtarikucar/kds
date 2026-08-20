import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { LicensingController } from "./licensing.controller";

/**
 * The public price list is what the storefront builds a basket from. It has
 * always omitted `deps`, which was harmless while the only dependencies in
 * the catalog were credit-pack → module (credits are bought from the module's
 * own screen). `module_personnel_card_shift` is the first MODULE that depends
 * on another module, and the store cannot add a prerequisite it cannot see:
 * the customer ticks one line, checkout's assertDeps 409s the whole cart.
 */
describe("LicensingController.pricing — dependency projection", () => {
  let prisma: MockPrismaClient;
  let ctrl: LicensingController;

  const row = (over: Record<string, unknown> = {}) => ({
    code: "module_personnel_card_shift",
    name: "Kartlı Vardiya",
    description: "RFID kart ile damgalama",
    kind: "module",
    billing: "oneTime",
    priceCents: 400_000,
    currency: "TRY",
    creditKind: null,
    creditUnits: null,
    requiresLicense: true,
    sortOrder: 18,
    deps: ["module_personnel"],
    i18n: null,
    ...over,
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    ctrl = new LicensingController(
      prisma as any,
      { getForTenant: jest.fn() } as any,
      { loadContext: jest.fn(), price: jest.fn() } as any,
      { balances: jest.fn() } as any,
      { openFor: jest.fn() } as any,
      { listForTenant: jest.fn() } as any,
    );
  });

  it("projects deps on the public pricing endpoint", async () => {
    (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([row()]);

    const res = await ctrl.pricing("tr");

    expect(res.products[0].deps).toEqual(["module_personnel"]);
  });

  it("SELECTS deps from the database rather than defaulting it", async () => {
    // A response that hardcodes `deps: []` would pass the assertion above for
    // a dependency-free product and silently drop every real dependency.
    (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([row()]);

    await ctrl.pricing("tr");

    const select = (prisma.marketplaceAddOn.findMany as any).mock.calls[0][0]
      .select;
    expect(select.deps).toBe(true);
  });

  it("returns an empty array — never undefined — for a product with no deps", () => {
    // The storefront walks `product.deps` in a loop; undefined would throw on
    // the first render of a catalog that predates this column being selected.
    (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([
      row({ code: "module_personnel", deps: [] }),
    ]);

    return ctrl.pricing("tr").then((res) => {
      expect(res.products[0].deps).toEqual([]);
    });
  });
});
