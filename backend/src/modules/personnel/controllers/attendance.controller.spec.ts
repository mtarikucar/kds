import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "../services/attendance.service";
import { BranchScope } from "../../../common/scoping/branch-scope";

/**
 * Long-tail forwarding spec for the personnel attendance controller. Load-
 * bearing contracts: clock punches identify the actor from req.user.id +
 * tenantId (a user clocks only themselves); branch-scoped reads thread the
 * scope; clock-in passes the optional notes through.
 */
describe("AttendanceController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: AttendanceController;
  const req = { tenantId: "t1", user: { id: "u1" } };
  const scope = { tenantId: "t1", branchId: "b1" } as unknown as BranchScope;

  beforeEach(() => {
    svc = {
      clockIn: jest.fn().mockResolvedValue({}),
      clockOut: jest.fn().mockResolvedValue({}),
      breakStart: jest.fn().mockResolvedValue({}),
      breakEnd: jest.fn().mockResolvedValue({}),
      getMyStatus: jest.fn().mockResolvedValue({}),
      getTodayAttendance: jest.fn().mockResolvedValue([]),
      getAttendanceHistory: jest.fn().mockResolvedValue([]),
      getAttendanceSummary: jest.fn().mockResolvedValue({}),
    };
    ctrl = new AttendanceController(svc as unknown as AttendanceService);
  });

  it("clockIn identifies the actor and passes the notes", () => {
    ctrl.clockIn(req, { notes: "traffic" } as any);
    expect(svc.clockIn).toHaveBeenCalledWith("t1", "u1", "traffic");
  });

  it("clockOut/breakStart/breakEnd act on the actor's own attendance", () => {
    ctrl.clockOut(req);
    ctrl.breakStart(req);
    ctrl.breakEnd(req);
    expect(svc.clockOut).toHaveBeenCalledWith("t1", "u1");
    expect(svc.breakStart).toHaveBeenCalledWith("t1", "u1");
    expect(svc.breakEnd).toHaveBeenCalledWith("t1", "u1");
  });

  it("getHistory threads the scope + query", () => {
    const query = { page: 1 } as any;
    ctrl.getHistory(scope, query);
    expect(svc.getAttendanceHistory).toHaveBeenCalledWith(scope, query);
  });

  it("getMyStatus / getTodayAttendance forward the scope", () => {
    ctrl.getMyStatus(scope);
    ctrl.getTodayAttendance(scope);
    expect(svc.getMyStatus).toHaveBeenCalledWith(scope);
    expect(svc.getTodayAttendance).toHaveBeenCalledWith(scope);
  });
});
