import { MachineThrottlerGuard } from "./machine-throttler.guard";

// getTracker is protected; exercise it via a thin subclass that exposes it.
class TestableGuard extends MachineThrottlerGuard {
  public track(req: Record<string, any>): Promise<string> {
    return this.getTracker(req);
  }
}

describe("MachineThrottlerGuard.getTracker", () => {
  const guard = new TestableGuard(
    // ThrottlerGuard ctor args are unused by getTracker; cast through unknown.
    {} as any,
    {} as any,
    {} as any,
  );

  it("keys a Screen token by its non-secret uuid prefix", async () => {
    const req = {
      headers: { authorization: "Screen 0190abc-uuidv7.secrettail==" },
    };
    await expect(guard.track(req)).resolves.toBe("screen:0190abc-uuidv7");
  });

  it("keys a partner request by X-Partner-Key", async () => {
    const req = { headers: { "x-partner-key": "pk_live_abc" } };
    await expect(guard.track(req)).resolves.toBe("pk:pk_live_abc");
  });

  it("falls back to client IP when no machine principal header is present", async () => {
    await expect(guard.track({ headers: {}, ip: "9.9.9.9" })).resolves.toBe(
      "9.9.9.9",
    );
  });

  it("prefers req.ips[0] (proxied) over req.ip", async () => {
    const req = { headers: {}, ips: ["1.1.1.1", "2.2.2.2"], ip: "3.3.3.3" };
    await expect(guard.track(req)).resolves.toBe("1.1.1.1");
  });
});
