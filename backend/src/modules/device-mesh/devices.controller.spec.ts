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
  const userReq = { user: { tenantId: "t1" } };
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

  it("create forwards tenantId + dto", () => {
    const dto = { kind: "kds_screen" } as any;
    ctrl.create(userReq, dto);
    expect(devices.createSlot).toHaveBeenCalledWith("t1", dto);
  });

  it("enqueueCommand threads tenantId, device id and dto", () => {
    const dto = { kind: "print.receipt", payload: {} } as any;
    ctrl.enqueueCommand(userReq, "dev-9", dto);
    expect(queue.enqueue).toHaveBeenCalledWith("t1", "dev-9", dto);
  });

  it("listCommands parses the limit to int", () => {
    ctrl.listCommands(userReq, "dev-9", "queued", "20");
    expect(queue.listForDevice).toHaveBeenCalledWith("t1", "dev-9", {
      status: "queued",
      limit: 20,
    });
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
