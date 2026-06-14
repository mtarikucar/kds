import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * Long-tail forwarding spec for ReportsController. Load-bearing contracts:
 * ISO date query strings are parsed to Date (undefined when absent), the
 * tenantId comes off req, branchId is threaded through, and the
 * top-products limit defaults to 10 when omitted.
 */
describe("ReportsController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: ReportsController;
  const req = { tenantId: "t1" };

  beforeEach(() => {
    svc = {
      getSalesSummary: jest.fn().mockResolvedValue({}),
      getTopProducts: jest.fn().mockResolvedValue({}),
      getPaymentMethodBreakdown: jest.fn().mockResolvedValue({}),
      getOrdersByHour: jest.fn().mockResolvedValue({}),
      getCustomerAnalytics: jest.fn().mockResolvedValue({}),
      getInventoryReport: jest.fn().mockResolvedValue({}),
      getStaffPerformance: jest.fn().mockResolvedValue({}),
    };
    ctrl = new ReportsController(svc as unknown as ReportsService);
  });

  it("getSalesSummary parses dates and forwards tenantId + branchId", async () => {
    await ctrl.getSalesSummary(req, {
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      branchId: "b1",
    });
    const [tenantId, start, end, branchId] =
      svc.getSalesSummary.mock.calls[0];
    expect(tenantId).toBe("t1");
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);
    expect(branchId).toBe("b1");
  });

  it("getSalesSummary passes undefined dates when query is empty", async () => {
    await ctrl.getSalesSummary(req, {});
    expect(svc.getSalesSummary).toHaveBeenCalledWith(
      "t1",
      undefined,
      undefined,
      undefined,
    );
  });

  it("getTopProducts defaults the limit to 10 when omitted", async () => {
    await ctrl.getTopProducts(req, {});
    const limit = svc.getTopProducts.mock.calls[0][3];
    expect(limit).toBe(10);
  });

  it("getTopProducts forwards an explicit limit", async () => {
    await ctrl.getTopProducts(req, { limit: 25 });
    expect(svc.getTopProducts.mock.calls[0][3]).toBe(25);
  });

  it("getOrdersByHour parses the single date and threads branchId", async () => {
    await ctrl.getOrdersByHour(req, { date: "2026-04-15", branchId: "b2" });
    const [tenantId, date, branchId] = svc.getOrdersByHour.mock.calls[0];
    expect(tenantId).toBe("t1");
    expect(date).toBeInstanceOf(Date);
    expect(branchId).toBe("b2");
  });

  it("getInventoryReport just forwards the tenantId", async () => {
    await ctrl.getInventoryReport(req);
    expect(svc.getInventoryReport).toHaveBeenCalledWith("t1");
  });
});
