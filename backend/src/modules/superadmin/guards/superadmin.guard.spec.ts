import { UnauthorizedException } from "@nestjs/common";
import { SuperAdminGuard } from "./superadmin.guard";

/**
 * The SuperAdminGuard is the single chokepoint protecting every platform-ops
 * endpoint. Its branch matrix must hold exactly:
 *   - @SuperAdminPublic routes bypass entirely;
 *   - missing/invalid token → 401;
 *   - token whose `type` !== "superadmin" → 401 (a 2FA-pending or refresh
 *     token must NOT grant access);
 *   - SA row missing or non-ACTIVE → 401;
 *   - tokenVersion mismatch (force-logout) → "Session revoked";
 *   - happy path attaches the SA row to the request and returns true.
 */
function makeCtx(authorization?: string, isPublic = false) {
  const req: any = {
    headers: authorization ? { authorization } : {},
  };
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  };
  const ctx: any = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  };
  return { req, reflector, ctx };
}

describe("SuperAdminGuard", () => {
  let jwt: { verifyAsync: jest.Mock };
  let config: { get: jest.Mock };
  let prisma: { superAdmin: { findUnique: jest.Mock } };

  const activeSa = {
    id: "sa-1",
    email: "ops@platform.com",
    firstName: "O",
    lastName: "Ps",
    status: "ACTIVE",
    twoFactorEnabled: true,
    tokenVersion: 3,
  };

  function build(reflector: any) {
    return new SuperAdminGuard(
      reflector as any,
      jwt as any,
      config as any,
      prisma as any,
    );
  }

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn() };
    config = { get: jest.fn().mockReturnValue("secret") };
    prisma = { superAdmin: { findUnique: jest.fn() } };
  });

  it("bypasses everything for @SuperAdminPublic routes", async () => {
    const { ctx, reflector } = makeCtx(undefined, true);
    const guard = build(reflector);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it("rejects when no token is provided", async () => {
    const { ctx, reflector } = makeCtx(undefined);
    const guard = build(reflector);
    await expect(guard.canActivate(ctx)).rejects.toThrow("No token provided");
  });

  it("rejects a non-Bearer authorization header (token not extracted)", async () => {
    const { ctx, reflector } = makeCtx("Basic abc");
    const guard = build(reflector);
    await expect(guard.canActivate(ctx)).rejects.toThrow("No token provided");
  });

  it("maps a jwt verify failure to a generic Invalid token", async () => {
    jwt.verifyAsync.mockRejectedValue(new Error("jwt expired"));
    const { ctx, reflector } = makeCtx("Bearer bad");
    const guard = build(reflector);
    await expect(guard.canActivate(ctx)).rejects.toThrow("Invalid token");
  });

  it("rejects a token whose type is not 'superadmin' (e.g. 2fa-pending)", async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: "sa-1",
      type: "superadmin-2fa-pending",
      ver: 3,
    });
    const { ctx, reflector } = makeCtx("Bearer tmp");
    const guard = build(reflector);
    await expect(guard.canActivate(ctx)).rejects.toThrow("Invalid token type");
    expect(prisma.superAdmin.findUnique).not.toHaveBeenCalled();
  });

  it("rejects when the SA row is missing", async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: "sa-1",
      type: "superadmin",
      ver: 3,
    });
    prisma.superAdmin.findUnique.mockResolvedValue(null);
    const { ctx, reflector } = makeCtx("Bearer ok");
    const guard = build(reflector);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "SuperAdmin not found or inactive",
    );
  });

  it("rejects when the SA is not ACTIVE", async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: "sa-1",
      type: "superadmin",
      ver: 3,
    });
    prisma.superAdmin.findUnique.mockResolvedValue({
      ...activeSa,
      status: "SUSPENDED",
    });
    const { ctx, reflector } = makeCtx("Bearer ok");
    const guard = build(reflector);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "SuperAdmin not found or inactive",
    );
  });

  it("rejects when the token version no longer matches the live row (force-logout)", async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: "sa-1",
      type: "superadmin",
      ver: 2, // stale
    });
    prisma.superAdmin.findUnique.mockResolvedValue(activeSa); // live ver=3
    const { ctx, reflector } = makeCtx("Bearer ok");
    const guard = build(reflector);
    await expect(guard.canActivate(ctx)).rejects.toThrow("Session revoked");
  });

  it("accepts a valid active SA with matching version and attaches it", async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: "sa-1",
      type: "superadmin",
      ver: 3,
    });
    prisma.superAdmin.findUnique.mockResolvedValue(activeSa);
    const { ctx, req, reflector } = makeCtx("Bearer ok");
    const guard = build(reflector);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.superAdmin).toBe(activeSa);
  });

  it("does not enforce a version match when the token carries no numeric ver", async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: "sa-1",
      type: "superadmin",
      // ver omitted — legacy token, version check is skipped
    });
    prisma.superAdmin.findUnique.mockResolvedValue(activeSa);
    const { ctx, req, reflector } = makeCtx("Bearer legacy");
    const guard = build(reflector);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.superAdmin).toBe(activeSa);
  });
});
