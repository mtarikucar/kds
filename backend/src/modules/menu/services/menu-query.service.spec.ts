import { NotFoundException } from "@nestjs/common";
import { MenuQueryService } from "./menu-query.service";

/**
 * Spec for MenuQueryService — the public-menu query body extracted from
 * QrMenuController. Asserts the boundary branches preserved verbatim:
 *  - 404s on a missing/inactive tenant
 *  - QR settings read side-effect-free and null-coalesced to defaults
 *  - enableCustomerSelfPay (truthy number) coerced to boolean
 *  - Decimal prices/modifier adjustments coerced to Number for JSON
 *  - table looked up only when a tableId is supplied
 */
function makePrisma(overrides: Record<string, any> = {}) {
  return {
    tenant: { findFirst: jest.fn() },
    qrMenuSettings: { findFirst: jest.fn().mockResolvedValue(null) },
    table: { findFirst: jest.fn().mockResolvedValue(null) },
    category: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

const posSettings = {
  findByTenant: jest.fn().mockResolvedValue({
    enableCustomerOrdering: true,
    enableTablelessMode: false,
    enableCustomerSelfPay: 1,
  }),
};

// Cache stub — miss by default (getMenu → null) so tests exercise the DB path.
function makeCache(cached: unknown = null) {
  return {
    getMenu: jest.fn().mockResolvedValue(cached),
    setMenu: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
  };
}

describe("MenuQueryService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("404s when the tenant is missing/inactive", async () => {
    const prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValueOnce(null);
    const svc = new MenuQueryService(prisma as any, posSettings as any, makeCache());
    await expect(svc.getPublicMenu("nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("null-coalesces missing QR settings to defaults", async () => {
    const prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValueOnce({ id: "t1", name: "Acme" });
    const svc = new MenuQueryService(prisma as any, posSettings as any, makeCache());
    const res = await svc.getPublicMenu("t1");
    expect(res.settings.primaryColor).toBe("#3B82F6");
    expect(res.settings.layoutStyle).toBe("GRID");
    expect(res.settings.itemsPerRow).toBe(2);
    expect(res.settings.showPrices).toBe(true);
  });

  it("coerces enableCustomerSelfPay (truthy number) to a boolean", async () => {
    const prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValueOnce({ id: "t1", name: "Acme" });
    const svc = new MenuQueryService(prisma as any, posSettings as any, makeCache());
    const res = await svc.getPublicMenu("t1");
    expect(res.enableCustomerSelfPay).toBe(true);
  });

  it("converts Decimal product prices + modifier adjustments to numbers", async () => {
    const prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValueOnce({ id: "t1", name: "Acme" });
    prisma.category.findMany.mockResolvedValueOnce([
      {
        id: "c1",
        products: [
          {
            id: "p1",
            name: "Pizza",
            description: null,
            price: { toString: () => "12.50" }, // Decimal-like; Number() coerces
            image: null,
            categoryId: "c1",
            productImages: [],
            modifierGroups: [
              {
                displayOrder: 0,
                group: {
                  id: "g1",
                  modifiers: [
                    { id: "m1", priceAdjustment: { toString: () => "2.00" } },
                  ],
                },
              },
            ],
          },
        ],
      },
    ]);
    const svc = new MenuQueryService(prisma as any, posSettings as any, makeCache());
    const res = await svc.getPublicMenu("t1");
    const product = res.categories[0].products[0];
    expect(typeof product.price).toBe("number");
    expect(product.price).toBe(12.5);
    expect(typeof product.modifierGroups[0].modifiers[0].priceAdjustment).toBe(
      "number",
    );
    expect(product.modifierGroups[0].modifiers[0].priceAdjustment).toBe(2);
  });

  it("looks up the table only when a tableId is supplied", async () => {
    const prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValue({ id: "t1", name: "Acme" });
    const svc = new MenuQueryService(prisma as any, posSettings as any, makeCache());

    await svc.getPublicMenu("t1");
    expect(prisma.table.findFirst).not.toHaveBeenCalled();

    await svc.getPublicMenu("t1", { tableId: "table-7" });
    expect(prisma.table.findFirst).toHaveBeenCalledWith({
      where: { id: "table-7", tenantId: "t1" },
    });
  });

  it("populates the cache on a miss (writes the tenant-level base, no table)", async () => {
    const prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValueOnce({ id: "t1", name: "Acme" });
    const cache = makeCache(null); // miss
    const svc = new MenuQueryService(prisma as any, posSettings as any, cache as any);

    await svc.getPublicMenu("t1");

    // The heavy category query ran, and the base was written to the cache.
    expect(prisma.category.findMany).toHaveBeenCalledTimes(1);
    expect(cache.setMenu).toHaveBeenCalledTimes(1);
    const [tid, base] = cache.setMenu.mock.calls[0];
    expect(tid).toBe("t1");
    // The cached unit is table-agnostic — `table` is merged per request, not stored.
    expect(base).not.toHaveProperty("table");
    expect(base).toHaveProperty("categories");
  });

  it("serves the cached base and SKIPS the deep category query on a hit", async () => {
    const prisma = makePrisma();
    const cachedBase = {
      tenant: { id: "t1", name: "Acme", wifi: null, socialMedia: {} },
      settings: { primaryColor: "#000" },
      enableCustomerOrdering: true,
      enableTablelessMode: false,
      enableCustomerSelfPay: true,
      categories: [{ id: "c-cached", products: [] }],
    };
    const cache = makeCache(cachedBase); // hit
    const svc = new MenuQueryService(prisma as any, posSettings as any, cache as any);

    const res = await svc.getPublicMenu("t1");

    // Cache hit short-circuits BEFORE the tenant / category / posSettings reads.
    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
    expect(posSettings.findByTenant).not.toHaveBeenCalled();
    expect(cache.setMenu).not.toHaveBeenCalled();
    // The cached payload is returned, with a freshly-merged (null) table.
    expect(res.categories).toEqual([{ id: "c-cached", products: [] }]);
    expect(res.table).toBeNull();
  });

  it("merges the fresh table onto a cache hit (table stays per-request)", async () => {
    const prisma = makePrisma();
    prisma.table.findFirst.mockResolvedValueOnce({ id: "table-7", number: 7 });
    const cache = makeCache({ categories: [], settings: {} });
    const svc = new MenuQueryService(prisma as any, posSettings as any, cache as any);

    const res = await svc.getPublicMenu("t1", { tableId: "table-7" });

    // Table looked up live even on a cache hit, and merged onto the cached base.
    expect(prisma.table.findFirst).toHaveBeenCalledWith({
      where: { id: "table-7", tenantId: "t1" },
    });
    expect(res.table).toEqual({ id: "table-7", number: 7 });
  });
});
