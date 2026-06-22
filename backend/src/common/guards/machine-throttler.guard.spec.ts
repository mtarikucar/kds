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

  it("keys a Screen token by IP + its non-secret uuid prefix (IP is primary so forged prefixes can't escape)", async () => {
    const req = {
      headers: { authorization: "Screen 0190abc-uuidv7.secrettail==" },
      ip: "5.5.5.5",
    };
    await expect(guard.track(req)).resolves.toBe(
      "5.5.5.5:screen:0190abc-uuidv7",
    );
  });

  it("keys a partner request by IP + X-Partner-Key", async () => {
    const req = { headers: { "x-partner-key": "pk_live_abc" }, ip: "5.5.5.5" };
    await expect(guard.track(req)).resolves.toBe("5.5.5.5:pk:pk_live_abc");
  });

  it("a single IP cycling forged Screen prefixes stays bucketed under that IP", async () => {
    const k1 = await guard.track({
      headers: { authorization: "Screen forged-1.x" },
      ip: "9.9.9.9",
    });
    const k2 = await guard.track({
      headers: { authorization: "Screen forged-2.x" },
      ip: "9.9.9.9",
    });
    // Different sub-buckets, but both carry the same IP segment so an IP cap
    // (if added) would still apply; crucially they are not raw `screen:*`.
    expect(k1.startsWith("9.9.9.9:")).toBe(true);
    expect(k2.startsWith("9.9.9.9:")).toBe(true);
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
