import { UnauthorizedException } from "@nestjs/common";
import * as appleSignin from "apple-signin-auth";
import { AuthService } from "./auth.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

jest.mock("apple-signin-auth");

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

/**
 * deep-review C3 — Google ACCESS-TOKEN (userinfo) path email_verified coercion.
 *
 * When the credential is an OAuth access token (not an ID token), googleAuth
 * falls through to the /tokeninfo audience check + /oauth2/v3/userinfo lookup.
 * That endpoint returns email_verified as EITHER a boolean or the string
 * "true"/"false". The gate must coerce both forms: reject "false"/false and
 * accept "true"/true — never trust an unverified email for account linking.
 */
describe("AuthService.googleAuth — access-token (userinfo) email_verified coercion (C3)", () => {
  const CLIENT_ID = "google-client-id";
  let prisma: MockPrismaClient;
  let svc: AuthService;
  let realFetch: typeof global.fetch;

  function jsonResponse(body: unknown) {
    return { ok: true, json: jest.fn().mockResolvedValue(body) } as any;
  }

  // Wire fetch so the credential is treated as an access token:
  //  1) /tokeninfo → audience matches CLIENT_ID
  //  2) /oauth2/v3/userinfo → returns the supplied userInfo payload
  function wireFetch(userInfo: Record<string, unknown>) {
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/tokeninfo")) {
        return jsonResponse({ aud: CLIENT_ID });
      }
      if (u.includes("/userinfo")) {
        return jsonResponse(userInfo);
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as any;
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    const jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
      decode: jest.fn(),
    };
    const configService = {
      get: jest.fn((k: string) =>
        k === "GOOGLE_CLIENT_ID" ? CLIENT_ID : undefined,
      ),
    };
    const emailService = {} as any;
    const notificationsService = {} as any;
    svc = new AuthService(
      prisma as any,
      jwtService as any,
      configService as any,
      emailService,
      notificationsService,
    );
    // Force the ID-token branch to fail so the access-token path runs.
    (svc as any).googleClient = {
      verifyIdToken: jest.fn().mockRejectedValue(new Error("not an id token")),
    };
    realFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const baseUserInfo = {
    sub: "google-sub-userinfo",
    email: "victim@example.com",
    given_name: "Vic",
    family_name: "Tim",
  };

  it.each([["false"], [false]])(
    'rejects when userinfo email_verified is %p (string/boolean unverified)',
    async (unverified) => {
      wireFetch({ ...baseUserInfo, email_verified: unverified });
      const createSpy = jest
        .spyOn(svc as any, "createSocialAuthUser")
        .mockResolvedValue({ accessToken: "should-not-happen" } as any);

      await expect(
        svc.googleAuth({ credential: "access-token" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  it.each([["true"], [true]])(
    'passes the gate when userinfo email_verified is %p (string/boolean verified)',
    async (verified) => {
      wireFetch({ ...baseUserInfo, email_verified: verified });
      (prisma.user.findUnique as any).mockResolvedValue(null); // no existing user
      const createSpy = jest
        .spyOn(svc as any, "createSocialAuthUser")
        .mockResolvedValue({ accessToken: "ok" } as any);

      const out = await svc.googleAuth({
        credential: "access-token",
      } as any);

      expect(out).toEqual({ accessToken: "ok" });
      expect(prisma.user.findUnique).toHaveBeenCalled();
      expect(createSpy).toHaveBeenCalled();
    },
  );
});

/**
 * deep-review C3 (Apple parity) — appleAuth must reject an EXPLICITLY
 * unverified email (email_verified === false or "false") while still allowing
 * a verified value through to lookup/creation. A missing claim is intentionally
 * tolerated and is covered by leaving it out of the rejected cases here.
 */
describe("AuthService.appleAuth — explicit unverified email rejection (C3)", () => {
  let prisma: MockPrismaClient;
  let svc: AuthService;

  function mockApplePayload(email_verified: unknown) {
    (appleSignin.verifyIdToken as jest.Mock).mockResolvedValue({
      sub: "apple-sub-1",
      email: "victim@example.com",
      email_verified,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
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

  it.each([[false], ["false"]])(
    "rejects an explicitly-unverified Apple token (email_verified=%p) without any user lookup",
    async (unverified) => {
      mockApplePayload(unverified);
      const createSpy = jest
        .spyOn(svc as any, "createSocialAuthUser")
        .mockResolvedValue({ accessToken: "should-not-happen" } as any);

      await expect(
        svc.appleAuth({ identityToken: "apple-id-token" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  it.each([[true], ["true"]])(
    "passes the gate when Apple email_verified is %p (proceeds to lookup/creation)",
    async (verified) => {
      mockApplePayload(verified);
      (prisma.user.findUnique as any).mockResolvedValue(null); // no existing user
      const createSpy = jest
        .spyOn(svc as any, "createSocialAuthUser")
        .mockResolvedValue({ accessToken: "ok" } as any);

      const out = await svc.appleAuth({
        identityToken: "apple-id-token",
      } as any);

      expect(out).toEqual({ accessToken: "ok" });
      expect(prisma.user.findUnique).toHaveBeenCalled();
      expect(createSpy).toHaveBeenCalled();
    },
  );
});
