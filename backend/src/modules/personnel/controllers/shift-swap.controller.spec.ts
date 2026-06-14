import { ShiftSwapController } from "./shift-swap.controller";
import { ShiftSwapService } from "../services/shift-swap.service";
import { BranchScope } from "../../../common/scoping/branch-scope";

/**
 * Long-tail forwarding spec for the shift-swap controller. The two-step
 * swap consent flow is load-bearing: target-accept/reject route through the
 * SAME respondAsTarget method with a true/false flag, and approve/reject are
 * the manager-side actions — all thread the scope + acting user id.
 */
describe("ShiftSwapController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: ShiftSwapController;
  const req = { user: { id: "u1" } };
  const scope = { tenantId: "t1", branchId: "b1" } as unknown as BranchScope;

  beforeEach(() => {
    svc = {
      createRequest: jest.fn().mockResolvedValue({}),
      respondAsTarget: jest.fn().mockResolvedValue({}),
      approve: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
      findAll: jest.fn().mockResolvedValue([]),
    };
    ctrl = new ShiftSwapController(svc as unknown as ShiftSwapService);
  });

  it("createRequest threads scope + requester id + dto", () => {
    const dto = { targetId: "u2" } as any;
    ctrl.createRequest(req, scope, dto);
    expect(svc.createRequest).toHaveBeenCalledWith(scope, "u1", dto);
  });

  it("targetAccept routes through respondAsTarget with accept=true", () => {
    ctrl.targetAccept(req, scope, "sw-1");
    expect(svc.respondAsTarget).toHaveBeenCalledWith("sw-1", scope, "u1", true);
  });

  it("targetReject routes through respondAsTarget with accept=false", () => {
    ctrl.targetReject(req, scope, "sw-1");
    expect(svc.respondAsTarget).toHaveBeenCalledWith(
      "sw-1",
      scope,
      "u1",
      false,
    );
  });

  it("approve / reject are the manager-side actions", () => {
    ctrl.approve(req, scope, "sw-1");
    ctrl.reject(req, scope, "sw-1");
    expect(svc.approve).toHaveBeenCalledWith("sw-1", scope, "u1");
    expect(svc.reject).toHaveBeenCalledWith("sw-1", scope, "u1");
  });
});
