import { SuperadminAddOnsController } from "./superadmin-addons.controller";
import { AddOnCatalogService } from "./addon-catalog.service";

/**
 * Long-tail spec for the super-admin catalog controller. Load-bearing
 * contracts: list forwards the status/kind filters; create/update validate
 * declared deps BEFORE persisting (so a dangling dependency string can't be
 * saved) and skip that round-trip when there are no deps; archive forwards
 * the id.
 */
describe("SuperadminAddOnsController", () => {
  let catalog: Record<string, jest.Mock>;
  let ctrl: SuperadminAddOnsController;

  beforeEach(() => {
    catalog = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "a1" }),
      update: jest.fn().mockResolvedValue({ id: "a1" }),
      archive: jest.fn().mockResolvedValue({ id: "a1" }),
      resolveDeps: jest.fn().mockResolvedValue(undefined),
    };
    ctrl = new SuperadminAddOnsController(
      catalog as unknown as AddOnCatalogService,
    );
  });

  it("list forwards the status + kind filters", () => {
    ctrl.list("published", "capacity");
    expect(catalog.list).toHaveBeenCalledWith({
      status: "published",
      kind: "capacity",
    });
  });

  it("create resolves declared deps before persisting", async () => {
    const dto = { code: "x", deps: ["plan:PRO"] } as any;
    await ctrl.create(dto);
    expect(catalog.resolveDeps).toHaveBeenCalledWith(["plan:PRO"]);
    expect(catalog.create).toHaveBeenCalledWith(dto);
  });

  it("create skips dep-resolution when there are no deps", async () => {
    await ctrl.create({ code: "x" } as any);
    expect(catalog.resolveDeps).not.toHaveBeenCalled();
    expect(catalog.create).toHaveBeenCalled();
  });

  it("update resolves deps and forwards the id + patch", async () => {
    const dto = { name: "n", deps: ["addon:base"] } as any;
    await ctrl.update("a1", dto);
    expect(catalog.resolveDeps).toHaveBeenCalledWith(["addon:base"]);
    expect(catalog.update).toHaveBeenCalledWith("a1", dto);
  });

  it("archive forwards the id (soft delete)", () => {
    ctrl.archive("a1");
    expect(catalog.archive).toHaveBeenCalledWith("a1");
  });
});
