import { MarketplaceController } from "./marketplace.controller";
import { AddOnCatalogService } from "./addon-catalog.service";
import { TenantMarketplaceService } from "./tenant-marketplace.service";

/**
 * Long-tail spec for the tenant-facing marketplace controller. Load-bearing
 * contracts: the public catalogue filters by ?kind when provided (and not
 * otherwise); tenant operations thread req.user.tenantId; purchase forwards
 * the destructured DTO; cancel parses the ?immediate=true query into a bool.
 */
describe("MarketplaceController", () => {
  let catalog: { listPublic: jest.Mock };
  let tenant: Record<string, jest.Mock>;
  let ctrl: MarketplaceController;
  const req = { user: { tenantId: "t1" } };

  beforeEach(() => {
    catalog = {
      listPublic: jest.fn().mockResolvedValue([
        { code: "a", kind: "software" },
        { code: "b", kind: "integration" },
      ]),
    };
    tenant = {
      listMine: jest.fn().mockResolvedValue([]),
      purchase: jest.fn().mockResolvedValue({}),
      cancel: jest.fn().mockResolvedValue({}),
    };
    ctrl = new MarketplaceController(
      catalog as unknown as AddOnCatalogService,
      tenant as unknown as TenantMarketplaceService,
    );
  });

  it("list returns the full published catalogue when no kind filter", async () => {
    const rows = await ctrl.list();
    expect(rows).toHaveLength(2);
  });

  it("list filters by kind when provided", async () => {
    const rows = await ctrl.list("integration");
    expect(rows).toEqual([{ code: "b", kind: "integration" }]);
  });

  it("mine forwards the authenticated tenantId", () => {
    ctrl.mine(req);
    expect(tenant.listMine).toHaveBeenCalledWith("t1");
  });

  it("purchase forwards tenantId + the destructured purchase fields", () => {
    ctrl.purchase(req, { addOnCode: "x", quantity: 2, branchId: "b1" } as any);
    expect(tenant.purchase).toHaveBeenCalledWith("t1", {
      addOnCode: "x",
      quantity: 2,
      branchId: "b1",
    });
  });

  it("cancel parses immediate=true into a boolean", () => {
    ctrl.cancel(req, "tao-1", "true");
    expect(tenant.cancel).toHaveBeenCalledWith("t1", "tao-1", true);
  });

  it("cancel defaults to immediate=false for any other query value", () => {
    ctrl.cancel(req, "tao-1", undefined);
    expect(tenant.cancel).toHaveBeenCalledWith("t1", "tao-1", false);
  });
});
