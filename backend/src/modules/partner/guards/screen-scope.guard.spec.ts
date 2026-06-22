import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ScreenScopeGuard } from "./screen-scope.guard";
import { REQUIRED_SCOPE_KEY } from "../decorators/require-scope.decorator";

/**
 * ScreenScopeGuard enforces a handler's @RequireScope against the scopes the
 * authenticated screen token carries (req.screen.scopes, set by
 * ScreenTokenGuard). No @RequireScope on the route → no check.
 */
function makeContext(screenScopes?: string[]) {
  const handler = () => undefined;
  const klass = class {};
  return {
    getHandler: () => handler,
    getClass: () => klass,
    switchToHttp: () => ({
      getRequest: () => ({
        screen: screenScopes ? { scopes: screenScopes } : undefined,
      }),
    }),
  } as any;
}

describe("ScreenScopeGuard", () => {
  let guard: ScreenScopeGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new ScreenScopeGuard(reflector);
  });

  it("returns true when no @RequireScope is present (absent → allow)", () => {
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue(undefined as any);
    expect(guard.canActivate(makeContext(["menu:read"]))).toBe(true);
  });

  it("returns true when the required scope IS present on the screen token", () => {
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue("orders:write" as any);
    expect(guard.canActivate(makeContext(["menu:read", "orders:write"]))).toBe(
      true,
    );
  });

  it("throws Forbidden when the required scope is missing from the screen token", () => {
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue("orders:write" as any);
    expect(() => guard.canActivate(makeContext(["menu:read"]))).toThrow(
      ForbiddenException,
    );
  });

  it("reads the metadata from the handler + class targets under REQUIRED_SCOPE_KEY", () => {
    const spy = jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue("menu:read" as any);
    const ctx = makeContext(["menu:read"]);
    guard.canActivate(ctx);
    expect(spy).toHaveBeenCalledWith(REQUIRED_SCOPE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });
});
