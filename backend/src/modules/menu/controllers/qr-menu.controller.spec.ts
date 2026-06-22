import { NotFoundException } from "@nestjs/common";
import { QrMenuController } from "./qr-menu.controller";

/**
 * Spec for the @Public QrMenuController. The menu query body now lives in
 * MenuQueryService (see menu-query.service.spec.ts); the controller keeps only:
 *  - by-subdomain only resolves ACTIVE tenants (suspended → 404, no leak)
 *  - delegation to MenuQueryService.getPublicMenu with the resolved tenant id
 *    + the tableId option.
 */
function makePrisma(overrides: Record<string, any> = {}) {
  return {
    tenant: { findFirst: jest.fn() },
    ...overrides,
  };
}

function makeMenuQuery() {
  return {
    getPublicMenu: jest
      .fn()
      .mockResolvedValue({ tenant: { id: "tenant-9", name: "Acme" } }),
  };
}

describe("QrMenuController", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getPublicMenuBySubdomain", () => {
    it("404s when no ACTIVE tenant matches the subdomain (suspended-tenant leak guard)", async () => {
      const prisma = makePrisma();
      prisma.tenant.findFirst.mockResolvedValueOnce(null);
      const menuQuery = makeMenuQuery();
      const ctrl = new QrMenuController(prisma as any, menuQuery as any);
      await expect(
        ctrl.getPublicMenuBySubdomain("acme"),
      ).rejects.toBeInstanceOf(NotFoundException);
      // queried with the ACTIVE status filter
      expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
        where: { subdomain: "acme", status: "ACTIVE" },
      });
      expect(menuQuery.getPublicMenu).not.toHaveBeenCalled();
    });

    it("delegates to MenuQueryService with the resolved tenant id + tableId", async () => {
      const prisma = makePrisma();
      prisma.tenant.findFirst.mockResolvedValueOnce({ id: "tenant-9" });
      const menuQuery = makeMenuQuery();
      const ctrl = new QrMenuController(prisma as any, menuQuery as any);
      const res = await ctrl.getPublicMenuBySubdomain("acme", "table-1");
      expect(menuQuery.getPublicMenu).toHaveBeenCalledWith("tenant-9", {
        tableId: "table-1",
      });
      expect(res.tenant.id).toBe("tenant-9");
    });
  });

  describe("getPublicMenu", () => {
    it("delegates to MenuQueryService with the tenant id + tableId option", async () => {
      const prisma = makePrisma();
      const menuQuery = makeMenuQuery();
      const ctrl = new QrMenuController(prisma as any, menuQuery as any);

      await ctrl.getPublicMenu("t1");
      expect(menuQuery.getPublicMenu).toHaveBeenCalledWith("t1", {
        tableId: undefined,
      });

      await ctrl.getPublicMenu("t1", "table-7");
      expect(menuQuery.getPublicMenu).toHaveBeenCalledWith("t1", {
        tableId: "table-7",
      });
    });
  });
});
