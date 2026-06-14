import { DeliveryDlqController } from "./delivery-dlq.controller";
import { DeliveryLogService } from "../services/delivery-log.service";

/**
 * Long-tail forwarding spec for the delivery DLQ controller. Load-bearing
 * contracts: tenant-scoped reads, the ?platform filter is uppercased, limit
 * parses to int, summary wraps the depth, and requeue defaults a missing id
 * list to [] (so a malformed body re-queues nothing rather than throwing).
 */
describe("DeliveryDlqController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: DeliveryDlqController;
  const req = { user: { tenantId: "t1" } };

  beforeEach(() => {
    svc = {
      getDeadLetters: jest.fn().mockResolvedValue([]),
      dlqDepth: jest.fn().mockResolvedValue(7),
      requeueDeadLetters: jest.fn().mockResolvedValue({}),
    };
    ctrl = new DeliveryDlqController(svc as unknown as DeliveryLogService);
  });

  it("list scopes by tenant, uppercases platform and parses limit", () => {
    ctrl.list(req, "getir", "25", "cur-1");
    expect(svc.getDeadLetters).toHaveBeenCalledWith({
      tenantId: "t1",
      platform: "GETIR",
      limit: 25,
      cursor: "cur-1",
    });
  });

  it("summary wraps the depth in a {depth} envelope", async () => {
    const out = await ctrl.summary(req, "getir");
    expect(svc.dlqDepth).toHaveBeenCalledWith({
      tenantId: "t1",
      platform: "GETIR",
    });
    expect(out).toEqual({ depth: 7 });
  });

  it("requeue defaults a missing id list to [] and forwards options", () => {
    ctrl.requeue(req, { resetAttempts: true } as any);
    expect(svc.requeueDeadLetters).toHaveBeenCalledWith([], {
      resetAttempts: true,
      tenantId: "t1",
    });
  });

  it("requeue forwards an explicit id list", () => {
    ctrl.requeue(req, { ids: ["a", "b"] } as any);
    expect(svc.requeueDeadLetters).toHaveBeenCalledWith(
      ["a", "b"],
      expect.objectContaining({ tenantId: "t1" }),
    );
  });
});
