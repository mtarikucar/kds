import { RequestContext } from "./request-context";

describe("RequestContext", () => {
  it("returns undefined outside any run()", () => {
    expect(RequestContext.get()).toBeUndefined();
    expect(RequestContext.getRequestId()).toBeUndefined();
  });

  it("mints a requestId when the seed has none", () => {
    RequestContext.run({}, () => {
      const id = RequestContext.getRequestId();
      expect(id).toMatch(/^[0-9a-f-]{36}$/); // uuid v4 shape
    });
  });

  it("honours an inbound requestId (cross-service tracing)", () => {
    RequestContext.run({ requestId: "trace-abc" }, () => {
      expect(RequestContext.getRequestId()).toBe("trace-abc");
    });
  });

  it("set() merges fields visible to the rest of the continuation", () => {
    RequestContext.run({ requestId: "r1" }, () => {
      RequestContext.set({ tenantId: "t-1", branchId: "b-1", userId: "u-1" });
      expect(RequestContext.get()).toEqual({
        requestId: "r1",
        tenantId: "t-1",
        branchId: "b-1",
        userId: "u-1",
      });
    });
  });

  it("set() ignores undefined values and is a no-op outside a request", () => {
    expect(() => RequestContext.set({ tenantId: "t-x" })).not.toThrow();
    RequestContext.run({ requestId: "r1" }, () => {
      RequestContext.set({ tenantId: undefined, branchId: "b-2" });
      expect(RequestContext.get()).toEqual({ requestId: "r1", branchId: "b-2" });
    });
  });

  it("enrich() prepends correlation fields without clobbering explicit meta", () => {
    RequestContext.run({ requestId: "r1", tenantId: "t-1" }, () => {
      const meta = RequestContext.enrich({ orderId: "o-9", tenantId: "explicit" });
      expect(meta).toEqual({
        requestId: "r1",
        tenantId: "explicit", // caller-provided value wins
        orderId: "o-9",
      });
    });
  });

  it("enrich() returns meta unchanged outside a request", () => {
    const meta = { foo: "bar" };
    expect(RequestContext.enrich(meta)).toEqual({ foo: "bar" });
  });

  it("isolates concurrent contexts (no async bleed)", async () => {
    const seen: string[] = [];
    await Promise.all([
      new Promise<void>((resolve) =>
        RequestContext.run({ requestId: "A" }, async () => {
          await new Promise((r) => setTimeout(r, 10));
          seen.push(RequestContext.getRequestId()!);
          resolve();
        }),
      ),
      new Promise<void>((resolve) =>
        RequestContext.run({ requestId: "B" }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          seen.push(RequestContext.getRequestId()!);
          resolve();
        }),
      ),
    ]);
    expect(seen.sort()).toEqual(["A", "B"]);
  });
});
