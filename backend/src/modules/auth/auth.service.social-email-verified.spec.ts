import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/**
 * deep-review C3 — Google Sign-In email_verified enforcement.
 *
 * Google permits tokens whose `email` claim is NOT verified (e.g. a
 * Workspace/Cloud-Identity domain whose admin set an arbitrary primary
 * email). Linking/logging-in by such an email is the canonical Google
 * Sign-In account-takeover vector. googleAuth must reject before any
 * user lookup or token issuance when email_verified is not true.
 */
describe("AuthService.googleAuth — email_verified gate (C3)", () => {
  let prisma: MockPrismaClient;
  let svc: AuthService;

  function buildPayload(email_verified: unknown) {
    return {
      getPayload: () => ({
        sub: "google-sub-1",
        email: "victim@example.com",
        given_name: "Vic",
        family_name: "Tim",
        email_verified,
      }),
    };
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    const jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
      decode: jest.fn(),
    };
    const configService = { get: jest.fn(() => undefined) };
    const emailService = {} as any;
    const notificationsService = {} as any;
    svc = new AuthService(
      prisma as any,
      jwtService as any,
      configService as any,
      emailService,
      notificationsService,
    );
  });

  it("rejects an unverified (email_verified=false) Google ID token without any user lookup", async () => {
    (svc as any).googleClient = {
      verifyIdToken: jest.fn().mockResolvedValue(buildPayload(false)),
    };
    const createSpy = jest
      .spyOn(svc as any, "createSocialAuthUser")
      .mockResolvedValue({ accessToken: "should-not-happen" } as any);

    await expect(
      svc.googleAuth({ credential: "id-token" } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("rejects when email_verified is missing (undefined) — strict === true", async () => {
    (svc as any).googleClient = {
      verifyIdToken: jest.fn().mockResolvedValue(buildPayload(undefined)),
    };
    const createSpy = jest
      .spyOn(svc as any, "createSocialAuthUser")
      .mockResolvedValue({ accessToken: "should-not-happen" } as any);

    await expect(
      svc.googleAuth({ credential: "id-token" } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("passes the gate when email_verified is true (proceeds to lookup/creation)", async () => {
    (svc as any).googleClient = {
      verifyIdToken: jest.fn().mockResolvedValue(buildPayload(true)),
    };
    (prisma.user.findUnique as any).mockResolvedValue(null); // no existing user
    const createSpy = jest
      .spyOn(svc as any, "createSocialAuthUser")
      .mockResolvedValue({ accessToken: "ok" } as any);

    const out = await svc.googleAuth({ credential: "id-token" } as any);

    expect(out).toEqual({ accessToken: "ok" });
    // Gate passed → googleId lookup ran and new-user creation was reached.
    expect(prisma.user.findUnique).toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalled();
  });
});
