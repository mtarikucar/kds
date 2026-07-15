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

  it("keys a Device token by IP + a sha256 prefix (per-device bucket, secret never in the key)", async () => {
    const req = {
      headers: { authorization: "Device super-secret-token" },
      ip: "5.5.5.5",
    };
    const tracker = await guard.track(req);
    expect(tracker).toMatch(/^5\.5\.5\.5:device:[0-9a-f]{16}$/);
    expect(tracker).not.toContain("super-secret-token");
    // Stable: the same token always lands in the same bucket.
    await expect(guard.track(req)).resolves.toBe(tracker);
  });

  it("two devices behind the same NAT IP get SEPARATE buckets", async () => {
    const a = await guard.track({
      headers: { authorization: "Device token-a" },
      ip: "5.5.5.5",
    });
    const b = await guard.track({
      headers: { authorization: "Device token-b" },
      ip: "5.5.5.5",
    });
    expect(a).not.toBe(b);
  });

  it("keys a Bridge token like a Device token (bridge: namespace)", async () => {
    const tracker = await guard.track({
      headers: { authorization: "Bridge bridge-secret" },
      ip: "5.5.5.5",
    });
    expect(tracker).toMatch(/^5\.5\.5\.5:bridge:[0-9a-f]{16}$/);
  });

  it("a user Bearer JWT stays on the plain IP bucket (not machine traffic)", async () => {
    await expect(
      guard.track({
        headers: { authorization: "Bearer eyJhbGciOi..." },
        ip: "5.5.5.5",
      }),
    ).resolves.toBe("5.5.5.5");
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

  it("prefers CF-Connecting-IP over req.ip (req.ip is the rotating CF edge behind the double proxy hop)", async () => {
    const req = {
      headers: { "cf-connecting-ip": "9.9.9.9" },
      ip: "172.16.0.5", // nginx/CF-edge peer — must NOT be the key
      ips: ["104.28.1.1"], // rotating CF edge
    };
    await expect(guard.track(req)).resolves.toBe("9.9.9.9");
  });

  it("two requests from the same real client stay in ONE bucket even as the CF edge (req.ip) rotates", async () => {
    const a = await guard.track({
      headers: { "cf-connecting-ip": "9.9.9.9" },
      ip: "104.28.1.1",
    });
    const b = await guard.track({
      headers: { "cf-connecting-ip": "9.9.9.9" },
      ip: "104.28.9.9", // different CF edge, same real client
    });
    expect(a).toBe(b);
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
