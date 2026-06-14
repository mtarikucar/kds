import { SuperAdminTenantsController } from "./superadmin-tenants.controller";
import { SuperAdminTenantsService } from "../services/superadmin-tenants.service";

/**
 * Long-tail forwarding spec for the superadmin tenants controller. Load-
 * bearing: status + override mutations thread the acting super-admin id +
 * email (attributable to the audit trail), and the sub-resource listers
 * default page/limit.
 */
describe("SuperAdminTenantsController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: SuperAdminTenantsController;

  beforeEach(() => {
    svc = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({}),
      updateStatus: jest.fn().mockResolvedValue({}),
      getTenantUsers: jest.fn().mockResolvedValue([]),
      getTenantOrders: jest.fn().mockResolvedValue([]),
      getTenantStats: jest.fn().mockResolvedValue({}),
      getOverrides: jest.fn().mockResolvedValue({}),
      updateOverrides: jest.fn().mockResolvedValue({}),
      resetOverrides: jest.fn().mockResolvedValue({}),
    };
    ctrl = new SuperAdminTenantsController(
      svc as unknown as SuperAdminTenantsService,
    );
  });

  it("updateStatus threads the dto + acting super-admin identity", async () => {
    const dto = { status: "SUSPENDED" } as any;
    await ctrl.updateStatus("t1", dto, "sa-1", "root@x.com");
    expect(svc.updateStatus).toHaveBeenCalledWith("t1", dto, "sa-1", "root@x.com");
  });

  it("getTenantUsers defaults page/limit", async () => {
    await ctrl.getTenantUsers("t1", undefined as any, undefined as any);
    expect(svc.getTenantUsers).toHaveBeenCalledWith("t1", 1, 20);
  });

  it("updateOverrides threads dto + actor identity", async () => {
    const dto = { featureOverrides: {} } as any;
    await ctrl.updateOverrides("t1", dto, "sa-1", "root@x.com");
    expect(svc.updateOverrides).toHaveBeenCalledWith(
      "t1",
      dto,
      "sa-1",
      "root@x.com",
    );
  });

  it("resetOverrides threads the actor identity", async () => {
    await ctrl.resetOverrides("t1", "sa-1", "root@x.com");
    expect(svc.resetOverrides).toHaveBeenCalledWith("t1", "sa-1", "root@x.com");
  });
});
