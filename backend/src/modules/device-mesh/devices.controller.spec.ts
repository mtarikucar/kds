import { DevicesController } from "./devices.controller";
import { DeviceService } from "./device.service";
import { CommandQueueService } from "./command-queue.service";

/**
 * Long-tail forwarding spec for DevicesController. Load-bearing contracts:
 * admin endpoints thread req.user.tenantId (tenant scoping); the device-side
 * endpoints thread req.device.id (device-token identity, NOT the tenant);
 * list query params pass through; listCommands parses the limit to int.
 */
describe("DevicesController", () => {
  let devices: Record<string, jest.Mock>;
  let queue: Record<string, jest.Mock>;
  let ctrl: DevicesController;
  // deep-review H14: branch-scoped surface — the global BranchGuard sets
  // req.scope.branchId, which the controller forwards so device commands stay
  // within the caller's validated branch.
  const userReq = {
    user: { tenantId: "t1", role: "ADMIN", primaryBranchId: null, allowedBranchIds: [] },
    scope: { branchId: "branch-a" },
  };
  const deviceReq = { device: { id: "dev-1" } };

  beforeEach(() => {
    devices = {
      list: jest.fn().mockResolvedValue([]),
      createSlot: jest.fn().mockResolvedValue({}),
      retire: jest.fn().mockResolvedValue({}),
      pair: jest.fn().mockResolvedValue({}),
      heartbeat: jest.fn().mockResolvedValue({}),
    };
    queue = {
      enqueue: jest.fn().mockResolvedValue({}),
      listForDevice: jest.fn().mockResolvedValue([]),
      claimNext: jest.fn().mockResolvedValue(null),
      ack: jest.fn().mockResolvedValue({}),
    };
    ctrl = new DevicesController(
      devices as unknown as DeviceService,
      queue as unknown as CommandQueueService,
    );
  });

  it("list forwards tenantId + the filter object", () => {
    ctrl.list(userReq, "b1", "kds_screen", "online");
    expect(devices.list).toHaveBeenCalledWith("t1", {
      branchId: "b1",
      kind: "kds_screen",
      status: "online",
    });
  });

  it("create forwards tenantId + dto with the branch resolved from scope", () => {
    const dto = { kind: "kds_screen" } as any;
    ctrl.create(userReq, dto);
    // devices.branchId is NOT NULL — the handler fills it from req.scope
    // (branch-a) when the body omits it.
    expect(devices.createSlot).toHaveBeenCalledWith("t1", {
      kind: "kds_screen",
      branchId: "branch-a",
    });
  });

  it("create lets an explicit body branchId override the scope (ADMIN wildcard)", () => {
    const dto = { kind: "kds_screen", branchId: "branch-z" } as any;
    ctrl.create(userReq, dto);
    expect(devices.createSlot).toHaveBeenCalledWith("t1", {
      kind: "kds_screen",
      branchId: "branch-z",
    });
  });

  it("create REFUSES a body branchId outside a restricted MANAGER allow-list (H14)", () => {
    const mgrReq = {
      user: { tenantId: "t1", role: "MANAGER", primaryBranchId: "branch-a", allowedBranchIds: ["branch-a"] },
      scope: { branchId: "branch-a" },
    };
    const dto = { kind: "kds_screen", branchId: "branch-z" } as any;
    expect(() => ctrl.create(mgrReq, dto)).toThrow(/cannot manage devices/i);
    expect(devices.createSlot).not.toHaveBeenCalled();
  });

  it("create allows a MANAGER to provision in an allowed branch", () => {
    const mgrReq = {
      user: { tenantId: "t1", role: "MANAGER", primaryBranchId: "branch-a", allowedBranchIds: ["branch-a", "branch-z"] },
      scope: { branchId: "branch-a" },
    };
    ctrl.create(mgrReq, { kind: "kds_screen", branchId: "branch-z" } as any);
    expect(devices.createSlot).toHaveBeenCalledWith("t1", { kind: "kds_screen", branchId: "branch-z" });
  });

  it("enqueueCommand threads tenantId, device id and dto", () => {
    const dto = { kind: "print.receipt", payload: {} } as any;
    ctrl.enqueueCommand(userReq, "dev-9", dto);
    // H14: branch scope (branch-a) threaded through as the 4th arg.
    expect(queue.enqueue).toHaveBeenCalledWith("t1", "dev-9", dto, "branch-a");
  });

  it("listCommands parses the limit to int", () => {
    ctrl.listCommands(userReq, "dev-9", "queued", "20");
    expect(queue.listForDevice).toHaveBeenCalledWith(
      "t1",
      "dev-9",
      {
        status: "queued",
        limit: 20,
      },
      "branch-a",
    );
  });

  it("pair forwards the dto (public, device not yet known)", () => {
    const dto = { pairCode: "A4F9K2" } as any;
    ctrl.pair(dto);
    expect(devices.pair).toHaveBeenCalledWith(dto);
  });

  it("heartbeat uses the device-token identity (req.device.id), not a tenant", () => {
    const dto = { batteryPct: 80 } as any;
    ctrl.heartbeat(deviceReq, dto);
    expect(devices.heartbeat).toHaveBeenCalledWith("dev-1", dto);
  });

  it("nextCommand claims for the authenticated device", () => {
    ctrl.nextCommand(deviceReq);
    expect(queue.claimNext).toHaveBeenCalledWith("dev-1");
  });

  it("ack threads device id + commandId + dto", () => {
    const dto = { status: "done" } as any;
    ctrl.ack(deviceReq, "cmd-1", dto);
    expect(queue.ack).toHaveBeenCalledWith("dev-1", "cmd-1", dto);
  });
});
