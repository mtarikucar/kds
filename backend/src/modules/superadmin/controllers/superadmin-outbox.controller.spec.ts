import { SuperAdminOutboxController } from "./superadmin-outbox.controller";
import { SuperAdminOutboxService } from "../services/superadmin-outbox.service";

/**
 * Long-tail forwarding spec for the superadmin outbox DLQ controller. Load-
 * bearing contracts: listFailed parses the limit query to int and passes
 * the rest through; getEvent forwards the id; requeue defaults a missing id
 * list to [] (a malformed body re-queues nothing rather than throwing).
 */
describe("SuperAdminOutboxController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: SuperAdminOutboxController;

  beforeEach(() => {
    svc = {
      summary: jest.fn().mockResolvedValue({}),
      listFailed: jest.fn().mockResolvedValue([]),
      getEvent: jest.fn().mockResolvedValue({}),
      requeue: jest.fn().mockResolvedValue({}),
    };
    ctrl = new SuperAdminOutboxController(
      svc as unknown as SuperAdminOutboxService,
    );
  });

  it("listFailed parses the limit to int and passes filters through", () => {
    ctrl.listFailed({ tenantId: "t1", type: "order.created", limit: "50" });
    expect(svc.listFailed).toHaveBeenCalledWith({
      tenantId: "t1",
      type: "order.created",
      limit: 50,
      cursor: undefined,
    });
  });

  it("getEvent forwards the id", () => {
    ctrl.getEvent("evt-1");
    expect(svc.getEvent).toHaveBeenCalledWith("evt-1");
  });

  it("requeue defaults a missing id list to []", () => {
    ctrl.requeue({ resetAttempts: true } as any);
    expect(svc.requeue).toHaveBeenCalledWith([], { resetAttempts: true });
  });

  it("requeue forwards an explicit id list", () => {
    ctrl.requeue({ ids: ["a", "b"] } as any);
    expect(svc.requeue).toHaveBeenCalledWith(["a", "b"], {
      resetAttempts: undefined,
    });
  });
});
