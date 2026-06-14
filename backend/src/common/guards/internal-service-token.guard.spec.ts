import {
  ServiceUnavailableException,
  UnauthorizedException,
  ExecutionContext,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InternalServiceTokenGuard } from "./internal-service-token.guard";

/**
 * Long-tail spec for the service-to-service token guard on /api/internal/*.
 * Load-bearing contracts: unset secret fails CLOSED with 503 (peer can tell
 * "not configured" from "wrong token"); missing/mismatched-length/wrong
 * header → 401; an exact match → allow. The compare is constant-time but the
 * observable behaviour (pass/fail) is what we assert.
 */
describe("InternalServiceTokenGuard", () => {
  function makeGuard(expected?: string): InternalServiceTokenGuard {
    const config = {
      get: jest.fn().mockReturnValue(expected),
    } as unknown as ConfigService;
    return new InternalServiceTokenGuard(config);
  }

  function ctxWithHeader(token?: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: token === undefined ? {} : { "x-internal-token": token },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it("throws 503 ServiceUnavailable when the secret is unset (fails closed)", () => {
    const guard = makeGuard(undefined);
    expect(() => guard.canActivate(ctxWithHeader("anything"))).toThrow(
      ServiceUnavailableException,
    );
  });

  it("throws 401 when the header is missing", () => {
    const guard = makeGuard("the-secret-token");
    expect(() => guard.canActivate(ctxWithHeader(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it("throws 401 when the header is not a string", () => {
    const guard = makeGuard("the-secret-token");
    expect(() => guard.canActivate(ctxWithHeader(["arr"]))).toThrow(
      UnauthorizedException,
    );
  });

  it("throws 401 when the token length differs", () => {
    const guard = makeGuard("the-secret-token");
    expect(() => guard.canActivate(ctxWithHeader("short"))).toThrow(
      UnauthorizedException,
    );
  });

  it("throws 401 on a same-length but wrong token", () => {
    const guard = makeGuard("aaaaaaaa");
    expect(() => guard.canActivate(ctxWithHeader("bbbbbbbb"))).toThrow(
      UnauthorizedException,
    );
  });

  it("allows an exact token match", () => {
    const guard = makeGuard("the-secret-token");
    expect(guard.canActivate(ctxWithHeader("the-secret-token"))).toBe(true);
  });
});
