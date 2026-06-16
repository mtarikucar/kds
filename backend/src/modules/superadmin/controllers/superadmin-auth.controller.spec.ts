import { Request, Response } from "express";
import { SuperAdminAuthController } from "./superadmin-auth.controller";
import { SuperAdminAuthService } from "../services/superadmin-auth.service";

/**
 * Long-tail forwarding spec for the superadmin auth controller. Load-
 * bearing: login/verify-2fa/logout thread the resolved client IP + user
 * agent into the service (for the audit/security log); 2FA lifecycle
 * endpoints thread the authenticated super-admin id; /me echoes the
 * principal the guard attached.
 */
describe("SuperAdminAuthController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: SuperAdminAuthController;
  let res: Response & { cookie: jest.Mock; clearCookie: jest.Mock };
  const req = {
    ip: "9.9.9.9",
    headers: { "user-agent": "jest" },
    cookies: {},
  } as unknown as Request;

  beforeEach(() => {
    res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response & { cookie: jest.Mock; clearCookie: jest.Mock };
    svc = {
      login: jest.fn().mockResolvedValue({}),
      verify2FA: jest.fn().mockResolvedValue({}),
      setup2FA: jest.fn().mockResolvedValue({}),
      enable2FA: jest.fn().mockResolvedValue({}),
      disable2FA: jest.fn().mockResolvedValue({}),
      regenerateBackupCodes: jest.fn().mockResolvedValue({}),
      logout: jest.fn().mockResolvedValue({}),
      refreshToken: jest.fn().mockResolvedValue({}),
    };
    ctrl = new SuperAdminAuthController(
      svc as unknown as SuperAdminAuthService,
    );
  });

  it("login forwards the dto + resolved ip + user agent", async () => {
    const dto = { email: "root@x.com", password: "p" } as any;
    await ctrl.login(dto, req, res);
    expect(svc.login).toHaveBeenCalledWith(dto, "9.9.9.9", "jest");
  });

  it("login sets the httpOnly refresh cookie when the service returns one", async () => {
    svc.login.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
    await ctrl.login({ email: "root@x.com", password: "p" } as any, req, res);
    expect(res.cookie).toHaveBeenCalledWith(
      "superAdminRefreshToken",
      "rt",
      expect.objectContaining({ httpOnly: true, path: "/api/superadmin/auth" }),
    );
  });

  it("login leaves the cookie untouched on the 2FA-tempToken branch", async () => {
    svc.login.mockResolvedValue({ tempToken: "tmp", requires2FA: true });
    await ctrl.login({ email: "root@x.com", password: "p" } as any, req, res);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("verify2FA forwards the dto + ip + user agent", async () => {
    const dto = { code: "123456" } as any;
    await ctrl.verify2FA(dto, req, res);
    expect(svc.verify2FA).toHaveBeenCalledWith(dto, "9.9.9.9", "jest");
  });

  it("disable2FA threads the super-admin id + password + code", async () => {
    await ctrl.disable2FA("sa-1", { currentPassword: "p", code: "123456" } as any);
    expect(svc.disable2FA).toHaveBeenCalledWith("sa-1", "p", "123456");
  });

  it("refresh prefers the httpOnly cookie over the body token", async () => {
    svc.refreshToken.mockResolvedValue({ accessToken: "new-at" });
    const cookieReq = {
      cookies: { superAdminRefreshToken: "cookie-rt" },
    } as unknown as Request;
    await ctrl.refresh({ refreshToken: "body-rt" } as any, cookieReq, res);
    expect(svc.refreshToken).toHaveBeenCalledWith("cookie-rt");
  });

  it("refresh falls back to the body token when no cookie is present", async () => {
    svc.refreshToken.mockResolvedValue({ accessToken: "new-at" });
    await ctrl.refresh({ refreshToken: "body-rt" } as any, req, res);
    expect(svc.refreshToken).toHaveBeenCalledWith("body-rt");
  });

  it("refresh rotates the cookie when the service returns a new refresh token", async () => {
    svc.refreshToken.mockResolvedValue({
      accessToken: "new-at",
      refreshToken: "rotated-rt",
    });
    const cookieReq = {
      cookies: { superAdminRefreshToken: "cookie-rt" },
    } as unknown as Request;
    await ctrl.refresh({} as any, cookieReq, res);
    expect(res.cookie).toHaveBeenCalledWith(
      "superAdminRefreshToken",
      "rotated-rt",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("refresh rejects when neither a cookie nor a body token is present", async () => {
    await expect(ctrl.refresh({} as any, req, res)).rejects.toThrow(
      /missing refresh token/i,
    );
    expect(svc.refreshToken).not.toHaveBeenCalled();
  });

  it("logout threads the super-admin id + ip + user agent and clears the cookie", async () => {
    await ctrl.logout("sa-1", req, res);
    expect(svc.logout).toHaveBeenCalledWith("sa-1", "9.9.9.9", "jest");
    expect(res.clearCookie).toHaveBeenCalledWith(
      "superAdminRefreshToken",
      expect.objectContaining({ path: "/api/superadmin/auth" }),
    );
  });

  it("getProfile echoes the guard-attached principal", async () => {
    const principal = { id: "sa-1", email: "root@x.com" };
    await expect(ctrl.getProfile(principal)).resolves.toEqual(principal);
  });
});
