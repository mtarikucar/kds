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

const TY_SECRET = "test-trendyol-secret";

function makeTrendyolGuard(): WebhookAuthGuard {
  const config = {
    get: (key: string) =>
      key === "TRENDYOL_WEBHOOK_SECRET" ? TY_SECRET : undefined,
  } as ConfigService;
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === WEBHOOK_PLATFORM_KEY ? "TRENDYOL" : undefined,
  } as any as Reflector;
  return new WebhookAuthGuard(config, reflector);
}

/**
 * Build a Trendyol request context. The HMAC is over `${timestamp}.${rawBody}`
 * (sha256, hex) and rawBody is captured as a Buffer, matching the guard's
 * byte-for-byte verification contract.
 */
function makeTrendyolContext(
  bodyObj: Record<string, any>,
  opts: {
    secret?: string;
    timestamp?: number;
    tamperSignature?: boolean;
    omitSignature?: boolean;
    params?: Record<string, string>;
  } = {},
): ExecutionContext {
  const timestamp =
    opts.timestamp ?? Math.floor(Date.now() / 1000);
  const rawBody = Buffer.from(JSON.stringify(bodyObj), "utf8");
  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  let signature = createHmac("sha256", opts.secret ?? TY_SECRET)
    .update(signedPayload)
    .digest("hex");
  if (opts.tamperSignature) {
    signature = signature.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  }
  const headers: Record<string, string> = {
    "x-webhook-timestamp": String(timestamp),
  };
  if (!opts.omitSignature) {
    headers["x-webhook-signature"] = signature;
  }
  const req = { headers, params: opts.params ?? {}, rawBody };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as any as ExecutionContext;
}

describe("WebhookAuthGuard — Trendyol HMAC (B-webhook-auth)", () => {
  it("accepts a body with a valid sha256 HMAC signature", () => {
    const guard = makeTrendyolGuard();
    expect(
      guard.canActivate(makeTrendyolContext({ orderNumber: "123" })),
    ).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const guard = makeTrendyolGuard();
    expect(() =>
      guard.canActivate(
        makeTrendyolContext({ orderNumber: "123" }, { tamperSignature: true }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const guard = makeTrendyolGuard();
    expect(() =>
      guard.canActivate(
        makeTrendyolContext({ orderNumber: "123" }, { secret: "wrong-secret" }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects when the signature header is missing", () => {
    const guard = makeTrendyolGuard();
    expect(() =>
      guard.canActivate(
        makeTrendyolContext({ orderNumber: "123" }, { omitSignature: true }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects a stale timestamp outside the freshness window", () => {
    const guard = makeTrendyolGuard();
    const tenMinAgo = Math.floor(Date.now() / 1000) - 10 * 60;
    expect(() =>
      guard.canActivate(
        makeTrendyolContext({ orderNumber: "123" }, { timestamp: tenMinAgo }),
      ),
    ).toThrow(UnauthorizedException);
  });

  // B-webhook-auth — body→restaurant binding: a verified body whose
  // restaurant id does not match the URL remoteId must be rejected.
  it("rejects when the body restaurant id does not match the URL remoteId", () => {
    const guard = makeTrendyolGuard();
    expect(() =>
      guard.canActivate(
        makeTrendyolContext(
          { restaurantId: "restaurant-A" },
          { params: { remoteId: "restaurant-B" } },
        ),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("accepts when the body restaurant id matches the URL remoteId", () => {
    const guard = makeTrendyolGuard();
    expect(
      guard.canActivate(
        makeTrendyolContext(
          { supplierId: "restaurant-A" },
          { params: { remoteId: "restaurant-A" } },
        ),
      ),
    ).toBe(true);
  });

  // B-webhook-auth — observability: when the body carries NONE of the
  // candidate restaurant-id fields, the binding is a silent no-op. The
  // guard must still pass (reject-on-positive-mismatch only) but emit a
  // WARN so ops can detect the gap in prod and supply the real field.
  it("passes but logs a WARN when no candidate restaurant field is present", () => {
    const guard = makeTrendyolGuard();
    const warnSpy = jest
      .spyOn((guard as any).logger, "warn")
      .mockImplementation(() => undefined);

    expect(
      guard.canActivate(
        makeTrendyolContext(
          { orderNumber: "123" },
          { params: { remoteId: "restaurant-B" } },
        ),
      ),
    ).toBe(true);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/none of the known restaurant-id/i);
    warnSpy.mockRestore();
  });

  it("does not WARN when no remoteId is in the URL (binding not attempted)", () => {
    const guard = makeTrendyolGuard();
    const warnSpy = jest
      .spyOn((guard as any).logger, "warn")
      .mockImplementation(() => undefined);

    expect(
      guard.canActivate(makeTrendyolContext({ orderNumber: "123" })),
    ).toBe(true);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
