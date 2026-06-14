import { Request } from "express";
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
  const req = {
    ip: "9.9.9.9",
    headers: { "user-agent": "jest" },
  } as unknown as Request;

  beforeEach(() => {
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
    await ctrl.login(dto, req);
    expect(svc.login).toHaveBeenCalledWith(dto, "9.9.9.9", "jest");
  });

  it("verify2FA forwards the dto + ip + user agent", async () => {
    const dto = { code: "123456" } as any;
    await ctrl.verify2FA(dto, req);
    expect(svc.verify2FA).toHaveBeenCalledWith(dto, "9.9.9.9", "jest");
  });

  it("disable2FA threads the super-admin id + password + code", async () => {
    await ctrl.disable2FA("sa-1", { currentPassword: "p", code: "123456" } as any);
    expect(svc.disable2FA).toHaveBeenCalledWith("sa-1", "p", "123456");
  });

  it("refresh forwards just the refresh token", async () => {
    await ctrl.refresh({ refreshToken: "rt" } as any);
    expect(svc.refreshToken).toHaveBeenCalledWith("rt");
  });

  it("logout threads the super-admin id + ip + user agent", async () => {
    await ctrl.logout("sa-1", req);
    expect(svc.logout).toHaveBeenCalledWith("sa-1", "9.9.9.9", "jest");
  });

  it("getProfile echoes the guard-attached principal", async () => {
    const principal = { id: "sa-1", email: "root@x.com" };
    await expect(ctrl.getProfile(principal)).resolves.toEqual(principal);
  });
});
