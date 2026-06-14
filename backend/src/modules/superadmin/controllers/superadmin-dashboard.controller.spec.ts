import { SuperAdminDashboardController } from "./superadmin-dashboard.controller";
import { SuperAdminDashboardService } from "../services/superadmin-dashboard.service";
import { SuperAdminAuditService } from "../services/superadmin-audit.service";

/**
 * Long-tail forwarding spec for the superadmin dashboard controller. Load-
 * bearing: revenue defaults the period to "month", recent/audit-recent
 * default the limit to 10, and the audit-recent endpoint routes to the
 * audit service (not the dashboard service).
 */
describe("SuperAdminDashboardController", () => {
  let dash: Record<string, jest.Mock>;
  let audit: { getRecentActivity: jest.Mock };
  let ctrl: SuperAdminDashboardController;

  beforeEach(() => {
    dash = {
      getStats: jest.fn().mockResolvedValue({}),
      getRevenueAnalytics: jest.fn().mockResolvedValue({}),
      getGrowthMetrics: jest.fn().mockResolvedValue({}),
      getPlanDistribution: jest.fn().mockResolvedValue({}),
      getRecentActivity: jest.fn().mockResolvedValue([]),
      getAlerts: jest.fn().mockResolvedValue([]),
    };
    audit = { getRecentActivity: jest.fn().mockResolvedValue([]) };
    ctrl = new SuperAdminDashboardController(
      dash as unknown as SuperAdminDashboardService,
      audit as unknown as SuperAdminAuditService,
    );
  });

  it("getRevenue defaults the period to month", async () => {
    await ctrl.getRevenue(undefined as any);
    expect(dash.getRevenueAnalytics).toHaveBeenCalledWith("month");
  });

  it("getRevenue forwards an explicit period", async () => {
    await ctrl.getRevenue("year");
    expect(dash.getRevenueAnalytics).toHaveBeenCalledWith("year");
  });

  it("getRecent defaults the limit to 10", async () => {
    await ctrl.getRecent(undefined as any);
    expect(dash.getRecentActivity).toHaveBeenCalledWith(10);
  });

  it("audit-recent routes to the audit service", async () => {
    await ctrl.getRecentAuditLogs(5);
    expect(audit.getRecentActivity).toHaveBeenCalledWith(5);
  });
});
