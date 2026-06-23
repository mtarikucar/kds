import { DeliveryPlatformsController } from "./delivery-platforms.controller";
import { DeliveryConfigService } from "../services/delivery-config.service";
import { DeliveryLogService } from "../services/delivery-log.service";
import { DeliveryMenuSyncService } from "../services/delivery-menu-sync.service";
import { DeliveryTestService } from "../services/delivery-test.service";

/**
 * Long-tail forwarding spec for DeliveryPlatformsController. Load-bearing
 * contracts: the :platform param is normalised to UPPERCASE before hitting
 * the service (so "getir" and "GETIR" resolve the same config row); every
 * call is tenant-scoped; log query strings parse success/limit/offset; and
 * testConnection wraps the bool in a {success} envelope.
 */
describe("DeliveryPlatformsController", () => {
  let config: Record<string, jest.Mock>;
  let logs: { getLogs: jest.Mock };
  let menu: Record<string, jest.Mock>;
  let test: { simulateOrder: jest.Mock };
  let ctrl: DeliveryPlatformsController;
  const req = { user: { tenantId: "t1" } };

  beforeEach(() => {
    config = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      testConnection: jest.fn().mockResolvedValue(true),
      toggleRestaurant: jest.fn().mockResolvedValue({}),
    };
    logs = { getLogs: jest.fn().mockResolvedValue([]) };
    menu = {
      getMappings: jest.fn().mockResolvedValue([]),
      createMapping: jest.fn().mockResolvedValue({}),
      deleteMapping: jest.fn().mockResolvedValue({}),
      syncMenuToPlatform: jest.fn().mockResolvedValue({}),
    };
    test = {
      simulateOrder: jest
        .fn()
        .mockResolvedValue({
          id: "ord-1",
          orderNumber: "GET-1",
          externalOrderId: "TEST-x",
          status: "PENDING_APPROVAL",
        }),
    };
    ctrl = new DeliveryPlatformsController(
      config as unknown as DeliveryConfigService,
      logs as unknown as DeliveryLogService,
      menu as unknown as DeliveryMenuSyncService,
      test as unknown as DeliveryTestService,
    );
  });

  it("findOneConfig normalises the platform name to uppercase", () => {
    ctrl.findOneConfig(req, "getir");
    expect(config.findOne).toHaveBeenCalledWith("t1", "GETIR");
  });

  it("createConfig is tenant-scoped", () => {
    const dto = { platform: "GETIR" } as any;
    ctrl.createConfig(req, dto);
    expect(config.create).toHaveBeenCalledWith("t1", dto);
  });

  it("deleteConfig uppercases the platform", () => {
    ctrl.deleteConfig(req, "trendyol");
    expect(config.delete).toHaveBeenCalledWith("t1", "TRENDYOL");
  });

  it("testConnection wraps the result in a {success} envelope", async () => {
    const out = await ctrl.testConnection(req, "getir");
    expect(config.testConnection).toHaveBeenCalledWith("t1", "GETIR");
    expect(out).toEqual({ success: true });
  });

  it("createTestOrder uppercases the platform and returns a {simulated} envelope", async () => {
    const out = await ctrl.createTestOrder(req, "getir");
    expect(test.simulateOrder).toHaveBeenCalledWith("t1", "GETIR");
    expect(out).toEqual({
      simulated: true,
      orderId: "ord-1",
      orderNumber: "GET-1",
      externalOrderId: "TEST-x",
      status: "PENDING_APPROVAL",
    });
  });

  it("createTestOrder tolerates a null order (pipeline declined)", async () => {
    test.simulateOrder.mockResolvedValueOnce(null);
    const out = await ctrl.createTestOrder(req, "getir");
    expect(out).toEqual({
      simulated: true,
      orderId: null,
      orderNumber: null,
      externalOrderId: null,
      status: null,
    });
  });

  it("getLogs parses success/limit/offset and uppercases the platform filter", () => {
    ctrl.getLogs(req, "getir", "true", "50", "10");
    expect(logs.getLogs).toHaveBeenCalledWith("t1", {
      platform: "GETIR",
      success: true,
      limit: 50,
      offset: 10,
    });
  });

  it("getLogs leaves success undefined when the query is absent", () => {
    ctrl.getLogs(req);
    expect(logs.getLogs).toHaveBeenCalledWith("t1", {
      platform: undefined,
      success: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it("createMapping uppercases the platform and threads the fields", () => {
    ctrl.createMapping(req, {
      productId: "p1",
      platform: "getir",
      externalItemId: "ext-1",
    });
    expect(menu.createMapping).toHaveBeenCalledWith(
      "t1",
      "p1",
      "GETIR",
      "ext-1",
      undefined,
    );
  });
});
