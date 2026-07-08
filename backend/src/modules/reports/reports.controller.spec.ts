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
  // ADMIN scope so branchFor() honors the caller-supplied query.branchId (a
  // non-admin would be locked to req.scope.branchId — see branchFor()).
  const req = {
    tenantId: "t1",
    scope: { role: "ADMIN", tenantId: "t1", branchId: "b1", userId: "u1" },
  };

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

describe('ReportsController — branch authorization (audit fix)', () => {
  it('locks a non-admin to req.scope.branchId, ignoring a spoofed query.branchId', async () => {
    const svc: any = { getProfitAndLoss: jest.fn().mockResolvedValue({}) };
    const ctrl = new (require('./reports.controller').ReportsController)(svc);
    const managerReq = {
      tenantId: 't1',
      scope: { role: 'MANAGER', tenantId: 't1', branchId: 'my-branch', userId: 'u1' },
    };
    // MANAGER tries to read a sibling branch via the query param.
    await ctrl.getProfitAndLoss(managerReq, { branchId: 'other-branch' });
    const [, , , branchId] = svc.getProfitAndLoss.mock.calls[0];
    expect(branchId).toBe('my-branch'); // locked to the guard-validated branch, not 'other-branch'
  });

  it('lets an ADMIN target any branch in the tenant', async () => {
    const svc: any = { getProfitAndLoss: jest.fn().mockResolvedValue({}) };
    const ctrl = new (require('./reports.controller').ReportsController)(svc);
    const adminReq = {
      tenantId: 't1',
      scope: { role: 'ADMIN', tenantId: 't1', branchId: 'b1', userId: 'u1' },
    };
    await ctrl.getProfitAndLoss(adminReq, { branchId: 'branch-X' });
    const [, , , branchId] = svc.getProfitAndLoss.mock.calls[0];
    expect(branchId).toBe('branch-X');
  });
});
