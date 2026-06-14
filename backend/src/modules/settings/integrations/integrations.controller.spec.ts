import {
  IntegrationsController,
  HardwareConfigController,
} from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";

/**
 * Long-tail forwarding spec for the integration controllers. Load-bearing
 * contracts: findAll branches on the ?type filter; every call is
 * tenant-scoped; toggle/sync/device endpoints forward the right body
 * fields. The HardwareConfigController feeds the desktop app and must
 * thread deviceId + tenantId.
 */
describe("IntegrationsController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: IntegrationsController;
  const req = { tenantId: "t1" };

  beforeEach(() => {
    svc = {
      findAll: jest.fn().mockResolvedValue([]),
      findByType: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      toggleStatus: jest.fn().mockResolvedValue({}),
      updateLastSync: jest.fn().mockResolvedValue({}),
    };
    ctrl = new IntegrationsController(svc as unknown as IntegrationsService);
  });

  it("findAll delegates to findByType when a ?type filter is present", () => {
    ctrl.findAll(req, "PAYMENT_GATEWAY");
    expect(svc.findByType).toHaveBeenCalledWith("t1", "PAYMENT_GATEWAY");
    expect(svc.findAll).not.toHaveBeenCalled();
  });

  it("findAll lists everything when no type filter", () => {
    ctrl.findAll(req);
    expect(svc.findAll).toHaveBeenCalledWith("t1");
  });

  it("create / update / delete are tenant-scoped", () => {
    const dto = { name: "x" } as any;
    ctrl.create(req, dto);
    ctrl.update(req, "i1", dto);
    ctrl.delete(req, "i1");
    expect(svc.create).toHaveBeenCalledWith("t1", dto);
    expect(svc.update).toHaveBeenCalledWith("i1", "t1", dto);
    expect(svc.delete).toHaveBeenCalledWith("i1", "t1");
  });

  it("toggleStatus forwards the isEnabled flag", () => {
    ctrl.toggleStatus(req, "i1", { isEnabled: false } as any);
    expect(svc.toggleStatus).toHaveBeenCalledWith("i1", "t1", false);
  });
});

describe("HardwareConfigController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: HardwareConfigController;
  const req = { tenantId: "t1" };

  beforeEach(() => {
    svc = {
      getHardwareConfig: jest.fn().mockResolvedValue({}),
      updateDeviceStatus: jest.fn().mockResolvedValue({}),
      reportDeviceEvent: jest.fn().mockResolvedValue({}),
    };
    ctrl = new HardwareConfigController(svc as unknown as IntegrationsService);
  });

  it("getHardwareConfig forwards the tenantId", async () => {
    await ctrl.getHardwareConfig(req);
    expect(svc.getHardwareConfig).toHaveBeenCalledWith("t1");
  });

  it("updateDeviceStatus threads deviceId, tenantId and status", async () => {
    await ctrl.updateDeviceStatus(req, "dev-1", { status: "online" } as any);
    expect(svc.updateDeviceStatus).toHaveBeenCalledWith(
      "dev-1",
      "t1",
      "online",
    );
  });

  it("reportDeviceEvent threads deviceId, tenantId and the body", async () => {
    const body = { eventType: "error" } as any;
    await ctrl.reportDeviceEvent(req, "dev-1", body);
    expect(svc.reportDeviceEvent).toHaveBeenCalledWith("dev-1", "t1", body);
  });
});
