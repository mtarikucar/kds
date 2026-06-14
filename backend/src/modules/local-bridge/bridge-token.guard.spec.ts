import { UnauthorizedException } from "@nestjs/common";
import { BridgeTokenGuard } from "./bridge-token.guard";

/**
 * Bridge auth mirrors device auth but uses the `Authorization: Bridge
 * <token>` scheme — bridges are first-class principals. The guard must
 * reject missing/mis-schemed headers, unknown/expired tokens, and retired
 * bridges, and attach `req.bridge` on success. A regression that drops the
 * retired check would let a decommissioned on-prem bridge keep relaying
 * commands to in-branch hardware.
 */
function ctxWith(authorization?: string) {
  const req: any = { headers: authorization ? { authorization } : {} };
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as any,
  };
}

describe("BridgeTokenGuard", () => {
  let bridges: { authenticateToken: jest.Mock };
  let guard: BridgeTokenGuard;

  beforeEach(() => {
    bridges = { authenticateToken: jest.fn() };
    guard = new BridgeTokenGuard(bridges as any);
  });

  it("rejects a request with no Authorization header", async () => {
    const { ctx } = ctxWith(undefined);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new UnauthorizedException("No bridge token"),
    );
    expect(bridges.authenticateToken).not.toHaveBeenCalled();
  });

  it("rejects the Device scheme (only Bridge is accepted here)", async () => {
    const { ctx } = ctxWith("Device abc");
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      /Authorization: Bridge/,
    );
    expect(bridges.authenticateToken).not.toHaveBeenCalled();
  });

  it("rejects a Bridge scheme with no token value", async () => {
    const { ctx } = ctxWith("Bridge");
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      /Authorization: Bridge/,
    );
  });

  it("rejects when the token does not authenticate", async () => {
    bridges.authenticateToken.mockResolvedValue(null);
    const { ctx } = ctxWith("Bridge tok-xyz");
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "Invalid or expired bridge token",
    );
    expect(bridges.authenticateToken).toHaveBeenCalledWith("tok-xyz");
  });

  it("rejects a retired bridge even with a valid token", async () => {
    bridges.authenticateToken.mockResolvedValue({
      id: "br-1",
      status: "retired",
    });
    const { ctx } = ctxWith("Bridge tok-xyz");
    await expect(guard.canActivate(ctx)).rejects.toThrow("Bridge retired");
  });

  it("authenticates an online bridge and attaches it to the request", async () => {
    const bridge = { id: "br-1", status: "online", branchId: "b-1" };
    bridges.authenticateToken.mockResolvedValue(bridge);
    const { ctx, req } = ctxWith("Bridge tok-xyz");

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.bridge).toBe(bridge);
  });
});
