import { lastValueFrom, Observable, of } from "rxjs";
import { RequestContextInterceptor } from "./request-context.interceptor";
import { RequestContext } from "./request-context";
import { CountryService } from "../country/country.service";
import { mockPrismaClient, MockPrismaClient } from "../test/prisma-mock.service";

function httpCtx(req: unknown) {
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe("RequestContextInterceptor", () => {
  // Uncached in these three tests (cachedCodeFor stubbed to null), so the
  // interceptor takes the async country.forTenant() branch, which is never
  // subscribed to here (next.handle()'s result is discarded) — country
  // resolution therefore never completes and countryCode is never set. That
  // is exactly why these tests' `toEqual` checks omit countryCode: they are
  // asserting the SYNCHRONOUS part of intercept() only.
  const country = {
    cachedCodeFor: jest.fn(() => null),
    forTenant: jest.fn(() => new Promise(() => {})),
  };
  const interceptor = new RequestContextInterceptor(country as any);

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

describe("RequestContextInterceptor country resolution", () => {
  // Real CountryService over the real prisma mock (not a hand-rolled stub) —
  // this is the only way `prisma.tenant.findUnique` call counts mean
  // anything. See country.service.spec.ts for the hand-rolled style; here
  // the query COUNT across successive requests is the point.
  let prisma: MockPrismaClient;
  let country: CountryService;
  let interceptor: RequestContextInterceptor;

  beforeEach(() => {
    prisma = mockPrismaClient();
    country = new CountryService(prisma as any);
    interceptor = new RequestContextInterceptor(country);
    (prisma.tenant.findUnique as any).mockResolvedValue({ countryCode: "UZ" });
  });

  /** Runs one simulated request through the interceptor to completion. */
  function runRequest(
    tenantId: string | undefined,
    handle: () => Observable<unknown> = () => of("handled"),
  ) {
    let observable!: Observable<unknown>;
    RequestContext.run({ requestId: "r", tenantId }, () => {
      observable = interceptor.intercept(
        httpCtx(tenantId ? { user: { tenantId } } : {}),
        { handle } as any,
      );
    });
    return lastValueFrom(observable);
  }

  it("does NOT hit the database when the tenant's code is already cached", async () => {
    // The single most important test in this task. This interceptor runs on
    // every request; a naive implementation adds a query per request.
    // Warm the cache, then assert prisma is never touched again.
    await runRequest("t-1");
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);

    // ... second request through the same interceptor ...
    await runRequest("t-1");
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
  });

  it("resolves and caches on the first request for a tenant", async () => {
    expect(country.cachedCodeFor("t-1")).toBeNull();

    let seenCountryCode: string | undefined;
    await RequestContext.run({ requestId: "r-1", tenantId: "t-1" }, async () => {
      await lastValueFrom(
        interceptor.intercept(httpCtx({ user: { tenantId: "t-1" } }), {
          handle: () => of("handled"),
        } as any),
      );
      seenCountryCode = RequestContext.get()?.countryCode;
    });

    expect(seenCountryCode).toBe("UZ");
    expect(country.cachedCodeFor("t-1")).toBe("UZ");
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
  });

  it("passes an anonymous request straight through with no query at all", async () => {
    const result = await runRequest(undefined);
    expect(result).toBe("handled");
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it("invalidate() forces the next request to re-read", async () => {
    await runRequest("t-1");
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);

    country.invalidate("t-1");

    await runRequest("t-1");
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(2);
  });

  it("still calls next.handle() exactly once on both the cached and uncached paths", async () => {
    // A switchMap mistake here would either drop the request or run it twice.
    const handle = jest.fn(() => of("handled"));

    // Uncached path (first request for this tenant).
    await runRequest("t-1", handle);
    expect(handle).toHaveBeenCalledTimes(1);

    // Cached path (second request, same tenant).
    await runRequest("t-1", handle);
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it("still runs the request when country resolution fails — a DB blip must not 500 every route", async () => {
    // Before the cache, this interceptor was fully synchronous and could not
    // fail this way. Right after a process restart the cache is empty for
    // EVERY tenant, so a DB hiccup during warm-up would 500 the first
    // request of any tenant — Turkish ones included. Country is a
    // nice-to-have; the request handler (an order, a payment) is not.
    (prisma.tenant.findUnique as any).mockRejectedValue(new Error("connection reset"));

    const handled = await runRequest("t-1");

    expect(handled).toBe("handled"); // the route ran — request did not 500
    expect(RequestContext.get()?.countryCode).toBeUndefined(); // degraded, not wrong
  });

  it("a failed resolution does not poison the cache — the next request retries", async () => {
    (prisma.tenant.findUnique as any).mockRejectedValueOnce(new Error("connection reset"));

    await runRequest("t-1");
    expect(country.cachedCodeFor("t-1")).toBeNull();

    // Second request: prisma now succeeds (default mock from beforeEach).
    await runRequest("t-1");
    expect(country.cachedCodeFor("t-1")).toBe("UZ");
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(2); // retried, not stuck
  });

  /**
   * Fix round 1 (Task 5 review, Task 3 wiring gap): TenantGuard steps aside
   * entirely for @Public() routes via shouldBypassGlobalAuth, so req.user
   * and req.tenantId are BOTH absent on every public route — the QR menu,
   * public reservations, customer self-pay, OTP, Partner Display. Ambient
   * country resolution was therefore completely inert on exactly the
   * surfaces where a CUSTOMER types their own phone number.
   *
   * Some of these routes (qr-menu ":tenantId", public-reservations
   * ":tenantId/settings" etc.) already carry the tenant as a route param.
   * That's enough to pick a COUNTRY PROFILE. It is NOT enough to trust as
   * an identity — a public route's params are attacker-controlled — so the
   * fallback below must feed ONLY the country lookup, never
   * RequestContext.tenantId (which flows into logs, Sentry, and branch/
   * tenant scoping decisions elsewhere).
   */
  describe("public route param fallback (country lookup only)", () => {
    it("resolves country from req.params.tenantId when there is no authenticated tenant", async () => {
      let seenCountryCode: string | undefined;
      let seenTenantId: string | undefined;
      await RequestContext.run({ requestId: "r-pub" }, async () => {
        await lastValueFrom(
          interceptor.intercept(httpCtx({ params: { tenantId: "t-1" } }), {
            handle: () => of("handled"),
          } as any),
        );
        seenCountryCode = RequestContext.get()?.countryCode;
        seenTenantId = RequestContext.get()?.tenantId;
      });
      expect(seenCountryCode).toBe("UZ");
      expect(seenTenantId).toBeUndefined();
    });

    // The load-bearing security test. A route param is attacker-controlled
    // on a public route — using it to pick a country profile is harmless
    // (worst case: your own phone number parses under the wrong region),
    // but writing it to RequestContext.tenantId would be a tenant-escape
    // vector via logs/Sentry/scoping.
    it("NEVER populates RequestContext.tenantId from a route param", async () => {
      let store: ReturnType<typeof RequestContext.get>;
      await RequestContext.run({ requestId: "r-pub" }, async () => {
        await lastValueFrom(
          interceptor.intercept(
            httpCtx({ params: { tenantId: "victim-tenant" } }),
            { handle: () => of("handled") } as any,
          ),
        );
        store = RequestContext.get();
      });
      expect(store?.tenantId).toBeUndefined();
      expect(store?.countryCode).toBe("UZ"); // country WAS resolved from the param
    });

    it("still uses the process-lifetime cache on the route-param path — no query-per-request regression", async () => {
      const run = () =>
        RequestContext.run({ requestId: "r-pub" }, async () => {
          await lastValueFrom(
            interceptor.intercept(httpCtx({ params: { tenantId: "t-1" } }), {
              handle: () => of("handled"),
            } as any),
          );
        });
      await run();
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
      await run();
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
    });

    it("ignores an unrelated route param (e.g. :subdomain on by-subdomain) — falls back to no countryCode, same as today", async () => {
      // by-subdomain/:subdomain is explicitly out of scope: resolving a
      // subdomain to a country needs a separate lookup this fix doesn't add.
      let store: ReturnType<typeof RequestContext.get>;
      await RequestContext.run({ requestId: "r-pub" }, async () => {
        await lastValueFrom(
          interceptor.intercept(httpCtx({ params: { subdomain: "acme" } }), {
            handle: () => of("handled"),
          } as any),
        );
        store = RequestContext.get();
      });
      expect(store?.tenantId).toBeUndefined();
      expect(store?.countryCode).toBeUndefined();
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it("degrades gracefully when country resolution fails on the route-param path — a DB blip must not 500 a public route", async () => {
      (prisma.tenant.findUnique as any).mockRejectedValueOnce(
        new Error("connection reset"),
      );
      let result: unknown;
      let store: ReturnType<typeof RequestContext.get>;
      await RequestContext.run({ requestId: "r-pub" }, async () => {
        result = await lastValueFrom(
          interceptor.intercept(httpCtx({ params: { tenantId: "t-1" } }), {
            handle: () => of("handled"),
          } as any),
        );
        store = RequestContext.get();
      });
      expect(result).toBe("handled");
      expect(store?.tenantId).toBeUndefined();
      expect(store?.countryCode).toBeUndefined();
    });
  });
});
