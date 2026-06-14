import { PerformanceController } from "./performance.controller";
import { ShiftTemplatesController } from "./shift-templates.controller";
import { ScheduleController } from "./schedule.controller";
import { PerformanceService } from "../services/performance.service";
import { ShiftTemplatesService } from "../services/shift-templates.service";
import { ScheduleService } from "../services/schedule.service";
import { BranchScope } from "../../../common/scoping/branch-scope";

/**
 * Long-tail forwarding spec for the remaining personnel controllers. Load-
 * bearing: every endpoint threads the BranchScope (these are branch-scoped
 * resources); schedule reads destructure query.weekStart; bulk-assign and
 * single-assign route to their distinct service methods; remove passes the
 * scope's tenantId.
 */
const scope = { tenantId: "t1", branchId: "b1" } as unknown as BranchScope;

describe("PerformanceController", () => {
  it("getMetrics / getTrends forward scope + query", () => {
    const svc = {
      getEnhancedMetrics: jest.fn().mockResolvedValue({}),
      getTrends: jest.fn().mockResolvedValue({}),
    };
    const ctrl = new PerformanceController(
      svc as unknown as PerformanceService,
    );
    const query = { userId: "u1" } as any;
    ctrl.getMetrics(scope, query);
    ctrl.getTrends(scope, query);
    expect(svc.getEnhancedMetrics).toHaveBeenCalledWith(scope, query);
    expect(svc.getTrends).toHaveBeenCalledWith(scope, query);
  });
});

describe("ShiftTemplatesController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: ShiftTemplatesController;
  beforeEach(() => {
    svc = {
      create: jest.fn().mockResolvedValue({}),
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
    };
    ctrl = new ShiftTemplatesController(
      svc as unknown as ShiftTemplatesService,
    );
  });

  it("create / update / remove thread the scope", () => {
    const dto = { name: "Morning" } as any;
    ctrl.create(scope, dto);
    ctrl.update(scope, "tmpl-1", dto);
    ctrl.remove(scope, "tmpl-1");
    expect(svc.create).toHaveBeenCalledWith(scope, dto);
    expect(svc.update).toHaveBeenCalledWith(scope, "tmpl-1", dto);
    expect(svc.remove).toHaveBeenCalledWith(scope, "tmpl-1");
  });
});

describe("ScheduleController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: ScheduleController;
  beforeEach(() => {
    svc = {
      getWeeklySchedule: jest.fn().mockResolvedValue({}),
      assign: jest.fn().mockResolvedValue({}),
      assignBulk: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
    };
    ctrl = new ScheduleController(svc as unknown as ScheduleService);
  });

  it("getWeeklySchedule destructures query.weekStart", () => {
    ctrl.getWeeklySchedule(scope, { weekStart: "2026-06-15" } as any);
    expect(svc.getWeeklySchedule).toHaveBeenCalledWith(scope, "2026-06-15");
  });

  it("assign and assignBulk route to their distinct service methods", () => {
    const single = { userId: "u1" } as any;
    const bulk = { assignments: [] } as any;
    ctrl.assign(scope, single);
    ctrl.assignBulk(scope, bulk);
    expect(svc.assign).toHaveBeenCalledWith(scope, single);
    expect(svc.assignBulk).toHaveBeenCalledWith(scope, bulk);
  });

  it("remove passes the scope's tenantId", () => {
    ctrl.remove(scope, "asg-1");
    expect(svc.remove).toHaveBeenCalledWith("asg-1", "t1");
  });
});
