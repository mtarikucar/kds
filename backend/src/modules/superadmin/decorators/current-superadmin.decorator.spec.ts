import { ExecutionContext } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { CurrentSuperAdmin } from "./current-superadmin.decorator";

/**
 * Long-tail spec for the @CurrentSuperAdmin param decorator. It reads
 * request.superAdmin (set by SuperAdminGuard) and, when given a key,
 * narrows to that property. Load-bearing: with no arg it returns the whole
 * principal; with a key it returns the field; both are undefined-safe when
 * the guard hasn't populated the request.
 *
 * NestJS stores the factory in ROUTE_ARGS_METADATA; we extract and invoke
 * it directly the way @nestjs's own tests do.
 */
function getFactory() {
  class Probe {
    handler(@CurrentSuperAdmin() _all: unknown, @CurrentSuperAdmin("id") _id: unknown) {}
  }
  const meta = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Probe,
    "handler",
  ) as Record<string, { factory: (data: unknown, ctx: ExecutionContext) => unknown }>;
  // The most-recently registered (index :1) is the 'id' variant; both share
  // the same factory function, so grab any entry's factory.
  return Object.values(meta)[0].factory;
}

function ctxWith(superAdmin: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ superAdmin }) }),
  } as unknown as ExecutionContext;
}

describe("CurrentSuperAdmin", () => {
  const factory = getFactory();
  const principal = { id: "sa-1", email: "root@x.com" };

  it("returns the whole superAdmin principal with no key", () => {
    expect(factory(undefined, ctxWith(principal))).toEqual(principal);
  });

  it("narrows to a single field when given a key", () => {
    expect(factory("id", ctxWith(principal))).toBe("sa-1");
    expect(factory("email", ctxWith(principal))).toBe("root@x.com");
  });

  it("is undefined-safe when the guard hasn't populated the request", () => {
    expect(factory("id", ctxWith(undefined))).toBeUndefined();
    expect(factory(undefined, ctxWith(undefined))).toBeUndefined();
  });
});
