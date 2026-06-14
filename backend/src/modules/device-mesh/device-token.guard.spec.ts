import { UnauthorizedException } from "@nestjs/common";
import { DeviceTokenGuard } from "./device-token.guard";

/**
 * Device auth uses the non-Bearer `Authorization: Device <token>` scheme so
 * intermediaries that strip Bearer can't clobber it. The guard's job is a
 * strict gate: reject missing/mis-schemed headers, reject unknown/expired
 * tokens, reject retired devices, and on success attach `req.device`. Every
 * rejection must be an UnauthorizedException — a regression that returns
 * `false` (silent) or forgets the retired check would let a decommissioned
 * device keep talking.
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

describe("DeviceTokenGuard", () => {
  let devices: { authenticateToken: jest.Mock };
  let guard: DeviceTokenGuard;

  beforeEach(() => {
    devices = { authenticateToken: jest.fn() };
    guard = new DeviceTokenGuard(devices as any);
  });

  it("rejects a request with no Authorization header", async () => {
    const { ctx } = ctxWith(undefined);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new UnauthorizedException("No device token"),
    );
    expect(devices.authenticateToken).not.toHaveBeenCalled();
  });

  it("rejects a Bearer-schemed header (wrong scheme)", async () => {
    const { ctx } = ctxWith("Bearer abc");
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      /Authorization: Device/,
    );
    expect(devices.authenticateToken).not.toHaveBeenCalled();
  });

  it("rejects a Device scheme with no token value", async () => {
    const { ctx } = ctxWith("Device");
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      /Authorization: Device/,
    );
  });

  it("rejects when the token does not authenticate (unknown/expired)", async () => {
    devices.authenticateToken.mockResolvedValue(null);
    const { ctx } = ctxWith("Device tok-123");
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "Invalid or expired device token",
    );
    expect(devices.authenticateToken).toHaveBeenCalledWith("tok-123");
  });

  it("rejects a retired device even when the token authenticates", async () => {
    devices.authenticateToken.mockResolvedValue({
      id: "dev-1",
      status: "retired",
    });
    const { ctx } = ctxWith("Device tok-123");
    await expect(guard.canActivate(ctx)).rejects.toThrow("Device retired");
  });

  it("authenticates an active device and attaches it to the request", async () => {
    const device = { id: "dev-1", status: "online", branchId: "b-1" };
    devices.authenticateToken.mockResolvedValue(device);
    const { ctx, req } = ctxWith("Device tok-123");

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.device).toBe(device);
  });
});
