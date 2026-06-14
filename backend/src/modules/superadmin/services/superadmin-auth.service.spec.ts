import {
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";

// bcrypt + speakeasy + qrcode are mocked so the tests are deterministic and
// fast. The module computes a DUMMY_SA_BCRYPT_HASH at import time via
// bcrypt.hashSync — that call must resolve before the class is constructed,
// so the mock is declared before the import below.
jest.mock("bcryptjs", () => ({
  hashSync: jest.fn().mockReturnValue("$dummy$hash"),
  hash: jest.fn().mockResolvedValue("$hashed$"),
  compare: jest.fn(),
}));
jest.mock("speakeasy", () => ({
  totp: { verifyDelta: jest.fn() },
  generateSecret: jest.fn().mockReturnValue({
    base32: "BASE32SECRET",
    otpauth_url: "otpauth://totp/x",
  }),
}));
jest.mock("qrcode", () => ({
  toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,QR"),
}));

import * as bcrypt from "bcryptjs";
import * as speakeasy from "speakeasy";
import { SuperAdminAuthService } from "./superadmin-auth.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

describe("SuperAdminAuthService", () => {
  let prisma: MockPrismaClient;
  let jwt: { sign: jest.Mock; verify: jest.Mock };
  let config: { get: jest.Mock };
  let audit: { log: jest.Mock };
  let svc: SuperAdminAuthService;

  const baseSa: any = {
    id: "sa-1",
    email: "ops@platform.com",
    password: "$bcrypted$",
    firstName: "O",
    lastName: "Ps",
    status: "ACTIVE",
    twoFactorEnabled: true,
    twoFactorSecret: "BASE32SECRET",
    pendingTwoFactorSecret: null,
    backupCodes: [],
    failedLogins: 0,
    lockedUntil: null,
    lastTotpStep: null,
    lastTotpStepExpiresAt: null,
    tokenVersion: 5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = mockPrismaClient();
    jwt = {
      sign: jest.fn().mockReturnValue("signed.jwt.token"),
      verify: jest.fn(),
    };
    config = { get: jest.fn().mockReturnValue("jwt-secret") };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    svc = new SuperAdminAuthService(
      prisma as any,
      jwt as any,
      config as any,
      audit as any,
    );
  });

  describe("login", () => {
    it("runs a dummy bcrypt compare and 401s when the email is unknown (timing-safe)", async () => {
      prisma.superAdmin.findUnique.mockResolvedValue(null as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        svc.login({ email: "nope@x.com", password: "pw" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // The throwaway compare ran so the no-user path spends bcrypt time too.
      expect(bcrypt.compare).toHaveBeenCalledWith("pw", "$dummy$hash");
    });

    it("reports remaining lock time when the account is currently locked", async () => {
      const lockedUntil = new Date(Date.now() + 10 * 60_000);
      prisma.superAdmin.findUnique.mockResolvedValue({
        ...baseSa,
        lockedUntil,
      });
      await expect(
        svc.login({ email: baseSa.email, password: "pw" }),
      ).rejects.toThrow(/Account locked\. Try again in \d+ minutes/);
      // Password is never even compared while locked.
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it("401s an inactive account before checking the password", async () => {
      prisma.superAdmin.findUnique.mockResolvedValue({
        ...baseSa,
        status: "DISABLED",
      });
      await expect(
        svc.login({ email: baseSa.email, password: "pw" }),
      ).rejects.toThrow("Account is inactive");
    });

    it("increments failedLogins on a bad password and locks after 5 failures", async () => {
      prisma.superAdmin.findUnique.mockResolvedValue({
        ...baseSa,
        failedLogins: 4,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      prisma.superAdmin.update.mockResolvedValue({} as any);

      await expect(
        svc.login({ email: baseSa.email, password: "wrong" }),
      ).rejects.toThrow("Invalid credentials");

      const updateArg = prisma.superAdmin.update.mock.calls[0][0] as any;
      expect(updateArg.data.failedLogins).toBe(5);
      expect(updateArg.data.lockedUntil).toBeInstanceOf(Date);
    });

    it("does NOT lock when failures are still below the threshold", async () => {
      prisma.superAdmin.findUnique.mockResolvedValue({
        ...baseSa,
        failedLogins: 1,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      prisma.superAdmin.update.mockResolvedValue({} as any);

      await expect(
        svc.login({ email: baseSa.email, password: "wrong" }),
      ).rejects.toThrow("Invalid credentials");
      const updateArg = prisma.superAdmin.update.mock.calls[0][0] as any;
      expect(updateArg.data.failedLogins).toBe(2);
      expect(updateArg.data.lockedUntil).toBeUndefined();
    });

    it("refuses login (403) when a valid-password account has NOT enabled 2FA, and audits the attempt", async () => {
      prisma.superAdmin.findUnique.mockResolvedValue({
        ...baseSa,
        twoFactorEnabled: false,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        svc.login({ email: baseSa.email, password: "pw" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: "2fa_not_enabled" }),
        }),
      );
    });

    it("issues a 2FA-pending temp token on a correct password (does NOT reset lockout yet)", async () => {
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseSa });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const res = await svc.login({ email: baseSa.email, password: "pw" });
      expect(res).toEqual({
        requiresTwoFactor: true,
        tempToken: "signed.jwt.token",
      });
      // failedLogins reset must happen in verify2FA, not here.
      expect(prisma.superAdmin.update).not.toHaveBeenCalled();
      const signPayload = jwt.sign.mock.calls[0][0];
      expect(signPayload.type).toBe("superadmin-2fa-pending");
    });
  });

  describe("verify2FA", () => {
    it("rejects a temp token of the wrong type", async () => {
      jwt.verify.mockReturnValue({ sub: "sa-1", type: "superadmin-refresh" });
      await expect(
        svc.verify2FA({ tempToken: "t", code: "123456" }),
      ).rejects.toThrow("Invalid token");
    });

    it("rejects an unverifiable / expired temp token", async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error("jwt expired");
      });
      await expect(
        svc.verify2FA({ tempToken: "t", code: "123456" }),
      ).rejects.toThrow("Invalid or expired token");
    });

    it("accepts a valid TOTP code, resets lockout, audits, and returns full tokens", async () => {
      jwt.verify.mockReturnValue({
        sub: "sa-1",
        type: "superadmin-2fa-pending",
      });
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseSa });
      (speakeasy.totp.verifyDelta as jest.Mock).mockReturnValue({ delta: 0 });
      prisma.superAdmin.update.mockResolvedValue({} as any);

      const res = await svc.verify2FA(
        { tempToken: "t", code: "123456" },
        "1.2.3.4",
      );

      expect(res.requiresTwoFactor).toBe(false);
      expect(res.accessToken).toBeDefined();
      expect(res.refreshToken).toBeDefined();
      // Lockout counters reset only after the FULL login completes.
      const resetCall = prisma.superAdmin.update.mock.calls.find(
        (c: any) => c[0].data.failedLogins === 0,
      );
      expect(resetCall).toBeDefined();
      expect(resetCall![0].data.lockedUntil).toBeNull();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ backupCodeUsed: false }),
        }),
      );
    });

    it("rejects a replayed TOTP step that is still within the replay lock window", async () => {
      jwt.verify.mockReturnValue({
        sub: "sa-1",
        type: "superadmin-2fa-pending",
      });
      // The current step (Date.now()/30000 + delta) must equal lastTotpStep
      // and the lock must not yet have expired.
      const currentStep = BigInt(Math.floor(Date.now() / 30_000));
      prisma.superAdmin.findUnique.mockResolvedValue({
        ...baseSa,
        lastTotpStep: currentStep,
        lastTotpStepExpiresAt: new Date(Date.now() + 60_000),
        backupCodes: [],
      });
      (speakeasy.totp.verifyDelta as jest.Mock).mockReturnValue({ delta: 0 });

      await expect(
        svc.verify2FA({ tempToken: "t", code: "123456" }),
      ).rejects.toThrow("Invalid 2FA code");
    });

    it("accepts a valid backup code when TOTP fails and records backupCodeUsed=true", async () => {
      jwt.verify.mockReturnValue({
        sub: "sa-1",
        type: "superadmin-2fa-pending",
      });
      // hash of "abcd1234" — service hashes the normalized code with sha256.
      const { createHash } = require("crypto");
      const codeHash = createHash("sha256").update("abcd1234").digest("hex");
      prisma.superAdmin.findUnique.mockResolvedValue({
        ...baseSa,
        backupCodes: [codeHash],
      });
      (speakeasy.totp.verifyDelta as jest.Mock).mockReturnValue(null); // TOTP fails
      // verifyBackupCode runs a $transaction(tx => ...) — drive the callback.
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const tx = {
          superAdmin: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ backupCodes: [codeHash] }),
            update: jest.fn().mockResolvedValue({}),
          },
        };
        return cb(tx);
      });
      prisma.superAdmin.update.mockResolvedValue({} as any);

      const res = await svc.verify2FA({ tempToken: "t", code: "abcd1234" });
      expect(res.requiresTwoFactor).toBe(false);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ backupCodeUsed: true }),
        }),
      );
    });

    it("401s when both TOTP and backup code fail", async () => {
      jwt.verify.mockReturnValue({
        sub: "sa-1",
        type: "superadmin-2fa-pending",
      });
      prisma.superAdmin.findUnique.mockResolvedValue({
        ...baseSa,
        backupCodes: ["someotherhash"],
      });
      (speakeasy.totp.verifyDelta as jest.Mock).mockReturnValue(null);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
        cb({
          superAdmin: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ backupCodes: ["someotherhash"] }),
            update: jest.fn(),
          },
        }),
      );

      await expect(
        svc.verify2FA({ tempToken: "t", code: "000000" }),
      ).rejects.toThrow("Invalid 2FA code");
    });
  });

  describe("refreshToken", () => {
    it("rejects a token of the wrong type", async () => {
      jwt.verify.mockReturnValue({ type: "superadmin", sub: "sa-1", ver: 5 });
      await expect(svc.refreshToken("rt")).rejects.toThrow("Invalid token type");
    });

    it("rejects a refresh token missing the version claim", async () => {
      jwt.verify.mockReturnValue({ type: "superadmin-refresh", sub: "sa-1" });
      await expect(svc.refreshToken("rt")).rejects.toThrow(
        "Refresh token missing version claim",
      );
    });

    it("rejects when the atomic version bump matches zero rows (already rotated / revoked)", async () => {
      jwt.verify.mockReturnValue({
        type: "superadmin-refresh",
        sub: "sa-1",
        ver: 4,
      });
      prisma.superAdmin.updateMany.mockResolvedValue({ count: 0 } as any);
      await expect(svc.refreshToken("rt")).rejects.toThrow("Session revoked");
      expect(prisma.superAdmin.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "sa-1", tokenVersion: 4 }),
        }),
      );
    });

    it("rotates and returns fresh tokens when the version matches exactly one row", async () => {
      jwt.verify.mockReturnValue({
        type: "superadmin-refresh",
        sub: "sa-1",
        ver: 5,
      });
      prisma.superAdmin.updateMany.mockResolvedValue({ count: 1 } as any);
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseSa });

      const res = await svc.refreshToken("rt");
      expect(res.requiresTwoFactor).toBe(false);
      expect(res.accessToken).toBeDefined();
      expect(res.refreshToken).toBeDefined();
    });
  });

  describe("disable2FA", () => {
    it("rejects when 2FA is not currently enabled", async () => {
      prisma.superAdmin.findUnique.mockResolvedValue({
        ...baseSa,
        twoFactorEnabled: false,
      });
      await expect(
        svc.disable2FA("sa-1", "pw", "123456"),
      ).rejects.toThrow("2FA is not enabled");
    });

    it("rejects when the current password is wrong", async () => {
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseSa });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        svc.disable2FA("sa-1", "wrong", "123456"),
      ).rejects.toThrow("Current password is incorrect");
    });

    it("clears 2FA + bumps tokenVersion when password and TOTP both pass", async () => {
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseSa });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (speakeasy.totp.verifyDelta as jest.Mock).mockReturnValue({ delta: 0 });
      prisma.superAdmin.update.mockResolvedValue({} as any);

      const res = await svc.disable2FA("sa-1", "pw", "123456");
      expect(res).toEqual({ message: "2FA disabled successfully" });
      const disableCall = prisma.superAdmin.update.mock.calls.find(
        (c: any) => c[0].data.twoFactorEnabled === false,
      );
      expect(disableCall![0].data).toMatchObject({
        twoFactorSecret: null,
        backupCodes: [],
        tokenVersion: { increment: 1 },
      });
    });
  });

  describe("createInitialSuperAdmin", () => {
    it("refuses to bootstrap when a superadmin already exists", async () => {
      prisma.superAdmin.count.mockResolvedValue(1 as any);
      await expect(
        svc.createInitialSuperAdmin("a@b.com", "pw", "A", "B"),
      ).rejects.toThrow("SuperAdmin already exists");
      expect(prisma.superAdmin.create).not.toHaveBeenCalled();
    });

    it("creates the first SA with 2FA pre-enabled and returns backup codes once", async () => {
      prisma.superAdmin.count.mockResolvedValue(0 as any);
      prisma.superAdmin.create.mockResolvedValue({
        id: "sa-new",
        email: "a@b.com",
      } as any);

      const res = await svc.createInitialSuperAdmin("a@b.com", "pw", "A", "B");
      expect(res.id).toBe("sa-new");
      expect(res.otpauthUrl).toBe("otpauth://totp/x");
      expect(res.backupCodes).toHaveLength(10);
      const createArg = prisma.superAdmin.create.mock.calls[0][0] as any;
      expect(createArg.data.twoFactorEnabled).toBe(true);
      expect(createArg.data.twoFactorSecret).toBe("BASE32SECRET");
    });
  });
});
