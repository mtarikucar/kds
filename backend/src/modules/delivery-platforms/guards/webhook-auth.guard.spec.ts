import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { createHmac } from "crypto";
import { WebhookAuthGuard, WEBHOOK_PLATFORM_KEY } from "./webhook-auth.guard";

const YS_SECRET = "test-yemeksepeti-secret";

function makeContext(
  platform: string,
  headers: Record<string, string>,
  params: Record<string, string> = {},
): ExecutionContext {
  const req = { headers, params };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as any as ExecutionContext;
}

function makeGuard(): WebhookAuthGuard {
  const config = {
    get: (key: string) =>
      key === "YEMEKSEPETI_WEBHOOK_SECRET" ? YS_SECRET : undefined,
  } as ConfigService;
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === WEBHOOK_PLATFORM_KEY ? "YEMEKSEPETI" : undefined,
  } as any as Reflector;
  return new WebhookAuthGuard(config, reflector);
}

/** Build a Yemeksepeti-style JWT (HS512 over base64url-encoded header+payload). */
function makeYsJwt(
  headerOverride: Record<string, any>,
  payloadOverride: Record<string, any>,
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS512", typ: "JWT", ...headerOverride }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      ...payloadOverride,
    }),
  ).toString("base64url");
  const sig = createHmac("sha512", YS_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

describe("WebhookAuthGuard — Yemeksepeti JWT (iter-27)", () => {
  it("accepts a well-formed HS512 token within the freshness window", () => {
    const guard = makeGuard();
    const token = makeYsJwt({}, {});
    expect(
      guard.canActivate(
        makeContext("YEMEKSEPETI", { authorization: `Bearer ${token}` }),
      ),
    ).toBe(true);
  });

  it("rejects a token with alg!=HS512 in the header (iter-27 — alg-confusion guard)", () => {
    const guard = makeGuard();
    // alg=none style: header claims `none`, sig is empty. The HMAC
    // compute would mismatch anyway, but pinning the header rejects
    // earlier and explicitly.
    const headerB64 = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const payloadB64 = Buffer.from(
      JSON.stringify({
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString("base64url");
    const token = `${headerB64}.${payloadB64}.`;

    expect(() =>
      guard.canActivate(
        makeContext("YEMEKSEPETI", { authorization: `Bearer ${token}` }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects a token with alg=HS256 in the header (alg-confusion guard)", () => {
    const guard = makeGuard();
    // Sign with HS256 + the correct secret — without alg pinning, a
    // naive verify could fall back to HMAC over the same secret with a
    // different alg and succeed. We refuse before computing.
    const headerB64 = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const payloadB64 = Buffer.from(
      JSON.stringify({
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString("base64url");
    const sig = createHmac("sha256", YS_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");
    const token = `${headerB64}.${payloadB64}.${sig}`;

    expect(() =>
      guard.canActivate(
        makeContext("YEMEKSEPETI", { authorization: `Bearer ${token}` }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects a token with iat older than 5 minutes (iter-27 — freshness window)", () => {
    const guard = makeGuard();
    const tenMinAgo = Math.floor(Date.now() / 1000) - 10 * 60;
    const token = makeYsJwt({}, { iat: tenMinAgo, exp: tenMinAgo + 3600 });

    expect(() =>
      guard.canActivate(
        makeContext("YEMEKSEPETI", { authorization: `Bearer ${token}` }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects a token without iat (freshness gate cannot verify)", () => {
    const guard = makeGuard();
    const token = makeYsJwt(
      {},
      { iat: undefined, exp: Math.floor(Date.now() / 1000) + 60 },
    );

    expect(() =>
      guard.canActivate(
        makeContext("YEMEKSEPETI", { authorization: `Bearer ${token}` }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects a token with iat far in the future (clock-skew guard)", () => {
    const guard = makeGuard();
    const fiveMinFromNow = Math.floor(Date.now() / 1000) + 5 * 60;
    const token = makeYsJwt(
      {},
      { iat: fiveMinFromNow, exp: fiveMinFromNow + 60 },
    );

    expect(() =>
      guard.canActivate(
        makeContext("YEMEKSEPETI", { authorization: `Bearer ${token}` }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects an expired token (existing exp gate, regression coverage)", () => {
    const guard = makeGuard();
    const oneMinAgo = Math.floor(Date.now() / 1000) - 60;
    const token = makeYsJwt({}, { iat: oneMinAgo - 30, exp: oneMinAgo });

    expect(() =>
      guard.canActivate(
        makeContext("YEMEKSEPETI", { authorization: `Bearer ${token}` }),
      ),
    ).toThrow(UnauthorizedException);
  });

  // deep-review H15 — cross-tenant binding: a JWT minted for tenant A
  // (its `sub` names restaurant A) must not authorize tenant B's URL.
  it("rejects a tenant-A JWT replayed against tenant-B URL (sub != remoteId)", () => {
    const guard = makeGuard();
    const token = makeYsJwt({}, { sub: "restaurant-A" });

    expect(() =>
      guard.canActivate(
        makeContext(
          "YEMEKSEPETI",
          { authorization: `Bearer ${token}` },
          { remoteId: "restaurant-B" },
        ),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("accepts a JWT whose sub claim matches the URL remoteId", () => {
    const guard = makeGuard();
    const token = makeYsJwt({}, { sub: "restaurant-A" });

    expect(
      guard.canActivate(
        makeContext(
          "YEMEKSEPETI",
          { authorization: `Bearer ${token}` },
          { remoteId: "restaurant-A" },
        ),
      ),
    ).toBe(true);
  });

  it("accepts a claim-less JWT against any remoteId (no positive mismatch)", () => {
    const guard = makeGuard();
    const token = makeYsJwt({}, {});

    expect(
      guard.canActivate(
        makeContext(
          "YEMEKSEPETI",
          { authorization: `Bearer ${token}` },
          { remoteId: "restaurant-B" },
        ),
      ),
    ).toBe(true);
  });
});
