import { of } from "rxjs";
import { RequestContextInterceptor } from "./request-context.interceptor";
import { RequestContext } from "./request-context";

function httpCtx(req: unknown) {
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe("RequestContextInterceptor", () => {
  const interceptor = new RequestContextInterceptor();

  it("enriches tenant/branch/user from req.user + req.scope", () => {
    const req = { user: { tenantId: "t-1", id: "u-1" }, scope: { branchId: "b-1" } };
    RequestContext.run({ requestId: "r-1" }, () => {
      interceptor.intercept(httpCtx(req), { handle: () => of(null) } as any);
      expect(RequestContext.get()).toEqual({
        requestId: "r-1",
        tenantId: "t-1",
        branchId: "b-1",
        userId: "u-1",
      });
    });
  });

  it("falls back to req.tenantId and req.user.sub", () => {
    const req = { tenantId: "t-2", user: { sub: "u-2" } };
    RequestContext.run({ requestId: "r-2" }, () => {
      interceptor.intercept(httpCtx(req), { handle: () => of(null) } as any);
      const store = RequestContext.get();
      expect(store?.tenantId).toBe("t-2");
      expect(store?.userId).toBe("u-2");
      expect(store?.branchId).toBeUndefined();
    });
  });

  it("is a no-op for non-http contexts", () => {
    const wsCtx = { getType: () => "ws" } as any;
    RequestContext.run({ requestId: "r-3" }, () => {
      interceptor.intercept(wsCtx, { handle: () => of(null) } as any);
      expect(RequestContext.get()).toEqual({ requestId: "r-3" });
    });
  });
});
