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
      listAvailable: jest.fn().mockResolvedValue([]),
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

  it("available forwards the tenantId + kind for the includedInPlan annotation", () => {
    ctrl.available(req, "software");
    expect(tenant.listAvailable).toHaveBeenCalledWith("t1", "software");
  });

  it("does NOT expose a free-grant purchase endpoint (deep-review C2)", () => {
    // The tenant-facing POST /addons/purchase free-grant endpoint was
    // removed — it let any tenant ADMIN activate paid add-ons without
    // payment. All purchases now flow through the PayTR checkout rail.
    expect((ctrl as any).purchase).toBeUndefined();
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
