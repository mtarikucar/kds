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
    menuCollection: { findMany: jest.fn().mockResolvedValue([]) },
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

describe("MenuQueryService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("404s when the tenant is missing/inactive", async () => {
    const prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValueOnce(null);
    const svc = new MenuQueryService(prisma as any, posSettings as any);
    await expect(svc.getPublicMenu("nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("null-coalesces missing QR settings to defaults", async () => {
    const prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValueOnce({ id: "t1", name: "Acme" });
    const svc = new MenuQueryService(prisma as any, posSettings as any);
    const res = await svc.getPublicMenu("t1");
    expect(res.settings.primaryColor).toBe("#3B82F6");
    expect(res.settings.layoutStyle).toBe("GRID");
    expect(res.settings.itemsPerRow).toBe(2);
    expect(res.settings.showPrices).toBe(true);
  });

  it("coerces enableCustomerSelfPay (truthy number) to a boolean", async () => {
    const prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValueOnce({ id: "t1", name: "Acme" });
    const svc = new MenuQueryService(prisma as any, posSettings as any);
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
    const svc = new MenuQueryService(prisma as any, posSettings as any);
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
    const svc = new MenuQueryService(prisma as any, posSettings as any);

    await svc.getPublicMenu("t1");
    expect(prisma.table.findFirst).not.toHaveBeenCalled();

    await svc.getPublicMenu("t1", { tableId: "table-7" });
    expect(prisma.table.findFirst).toHaveBeenCalledWith({
      where: { id: "table-7", tenantId: "t1" },
    });
  });
});
