import { HealthDashboardController } from "./health-dashboard.controller";
import { HealthDashboardService } from "./health-dashboard.service";

/**
 * Long-tail forwarding spec for HealthDashboardController. Operational
 * visibility, ADMIN/MANAGER only; the load-bearing contract is tenant
 * scoping — the overview and per-branch score both read req.user.tenantId.
 */
describe("HealthDashboardController", () => {
  let svc: { tenantOverview: jest.Mock; branchScore: jest.Mock };
  let ctrl: HealthDashboardController;
  const req = { user: { tenantId: "t1" } };

  beforeEach(() => {
    svc = {
      tenantOverview: jest.fn().mockResolvedValue([]),
      branchScore: jest.fn().mockResolvedValue({}),
    };
    ctrl = new HealthDashboardController(
      svc as unknown as HealthDashboardService,
    );
  });

  it("branches reads the tenant overview", () => {
    ctrl.branches(req);
    expect(svc.tenantOverview).toHaveBeenCalledWith("t1");
  });

  it("branch threads tenantId + branchId", () => {
    ctrl.branch(req, "b1");
    expect(svc.branchScore).toHaveBeenCalledWith("t1", "b1");
  });
});
