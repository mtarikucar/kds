import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { shouldBypassGlobalAuth } from "./guard-bypass.helper";
import { IS_PUBLIC_KEY } from "../../modules/auth/decorators/public.decorator";
import {
  IS_SUPERADMIN_PUBLIC_KEY,
  IS_SUPERADMIN_ROUTE_KEY,
} from "../../modules/superadmin/decorators/superadmin.decorator";

/**
 * Long-tail spec for the shared auth-bypass decision used by the global
 * guards. Load-bearing contract: any one of the three bypass keys
 * (@Public, @SuperadminPublic, @SuperadminRoute) on handler OR class
 * short-circuits the main-app pipeline; none → no bypass.
 */
describe("shouldBypassGlobalAuth", () => {
  const handler = () => undefined;
  class Ctrl {}
  const ctx = {
    getHandler: () => handler,
    getClass: () => Ctrl,
  } as unknown as ExecutionContext;

  function reflectorReturning(trueKey: string | null): Reflector {
    return {
      getAllAndOverride: (key: string) => key === trueKey,
    } as unknown as Reflector;
  }

  it("bypasses when @Public is present", () => {
    expect(shouldBypassGlobalAuth(reflectorReturning(IS_PUBLIC_KEY), ctx)).toBe(
      true,
    );
  });

  it("bypasses when the superadmin-public key is present", () => {
    expect(
      shouldBypassGlobalAuth(reflectorReturning(IS_SUPERADMIN_PUBLIC_KEY), ctx),
    ).toBe(true);
  });

  it("bypasses when the superadmin-route key is present", () => {
    expect(
      shouldBypassGlobalAuth(reflectorReturning(IS_SUPERADMIN_ROUTE_KEY), ctx),
    ).toBe(true);
  });

  it("does NOT bypass when no bypass key is set", () => {
    expect(shouldBypassGlobalAuth(reflectorReturning(null), ctx)).toBe(false);
  });

  it("inspects both the handler and the class as targets", () => {
    const getAllAndOverride = jest.fn().mockReturnValue(false);
    const reflector = { getAllAndOverride } as unknown as Reflector;
    shouldBypassGlobalAuth(reflector, ctx);
    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      handler,
      Ctrl,
    ]);
  });
});
