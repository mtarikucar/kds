import { LocalBridgeController } from "./local-bridge.controller";
import { LocalBridgeService } from "./local-bridge.service";

/**
 * Long-tail forwarding spec for LocalBridgeController. Load-bearing
 * contracts: admin endpoints thread req.user.tenantId; the public claim
 * endpoint forwards the body only (no tenant — the provisioning token is
 * the identity); heartbeat uses the bridge-token identity (req.bridge.id).
 */
describe("LocalBridgeController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: LocalBridgeController;

  beforeEach(() => {
    svc = {
      list: jest.fn().mockResolvedValue([]),
      createSlot: jest.fn().mockResolvedValue({}),
      retire: jest.fn().mockResolvedValue({}),
      claim: jest.fn().mockResolvedValue({}),
      heartbeat: jest.fn().mockResolvedValue({}),
    };
    ctrl = new LocalBridgeController(svc as unknown as LocalBridgeService);
  });

  it("forwards a single-branch filter when the caller can access that branch", () => {
    // Wildcard owner ADMIN (empty allow-list) may target any branch.
    ctrl.list(
      { user: { tenantId: "t1", role: "ADMIN", allowedBranchIds: [] } },
      "b1",
    );
    expect(svc.list).toHaveBeenCalledWith("t1", { branchId: "b1" });
  });

  it("confines a branch-restricted caller to their allowed branches when no branchId is given", () => {
    ctrl.list({
      user: { tenantId: "t1", role: "MANAGER", allowedBranchIds: ["b1", "b2"] },
    });
    expect(svc.list).toHaveBeenCalledWith("t1", { branchIds: ["b1", "b2"] });
  });

  it("rejects a branchId outside the caller's allow-list", () => {
    expect(() =>
      ctrl.list(
        { user: { tenantId: "t1", role: "MANAGER", allowedBranchIds: ["b1"] } },
        "b2",
      ),
    ).toThrow();
  });

  it("createSlot is tenant-scoped", () => {
    const body = { branchId: "b1" } as any;
    ctrl.createSlot({ user: { tenantId: "t1" } }, body);
    expect(svc.createSlot).toHaveBeenCalledWith("t1", body);
  });

  it("retire is tenant-scoped", () => {
    ctrl.retire({ user: { tenantId: "t1" } }, "br-1");
    expect(svc.retire).toHaveBeenCalledWith("t1", "br-1");
  });

  it("claim forwards only the body (provisioning token is the identity)", () => {
    const body = { provisioningToken: "tok" } as any;
    ctrl.claim(body);
    expect(svc.claim).toHaveBeenCalledWith(body);
  });

  it("heartbeat uses the bridge-token identity (req.bridge.id)", () => {
    const body = { queueDepth: 3 } as any;
    ctrl.heartbeat({ bridge: { id: "br-9" } }, body);
    expect(svc.heartbeat).toHaveBeenCalledWith("br-9", body);
  });
});
