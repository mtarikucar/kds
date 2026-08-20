import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { SmsService } from "./sms.service";
import { SmsProviderRegistry } from "../sms-core/sms-provider.registry";
import { SmsProvider } from "../sms-core/sms-provider.interface";
import { CountryCapabilityResolver } from "../../common/country/country-capability.resolver";
import { RequestContext } from "../../common/context/request-context";

/**
 * Task 11: SMS provider selection moves from process-once (constructor
 * picks ONE provider off a single SMS_PROVIDER env var) to per-tenant
 * (send() resolves a provider through CountryCapabilityResolver +
 * SmsProviderRegistry, per call). Two families of regression here:
 *
 *  - iter-41 (pre-existing, preserved): mockMode must REFUSE to start under
 *    NODE_ENV=production unless ALLOW_MOCK_SMS_IN_PROD=true is set — a
 *    config typo dropping the provider env vars must never silently fall
 *    through to mockMode, because the send path then logs the full OTP +
 *    phone in plaintext. The CHECK ITSELF moved from the constructor to
 *    onApplicationBootstrap() (see class comment for why), so these tests
 *    now call that hook directly instead of asserting the constructor
 *    throws.
 *  - Task 11 (new): per-tenant routing, the ambient-context / explicit
 *    tenantId contract, the UZ refusal, and the "provider named but not
 *    registered" config-typo case must be a loud throw, never mock.
 */
describe("SmsService", () => {
  const baseEnv = { ...process.env };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    errSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    process.env = { ...baseEnv };
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  function makeConfig(env: Record<string, string | undefined>): ConfigService {
    return {
      get: (key: string) => env[key],
    } as ConfigService;
  }

  const fakeProvider = (name: string, sendImpl?: SmsProvider["send"]): SmsProvider => ({
    name,
    isConfigured: () => true,
    send: sendImpl ?? jest.fn().mockResolvedValue({ success: true, messageId: `${name}-1` }),
  });

  function makeCapability(
    resolve: (tenantId: string) => Promise<string> | string,
  ): CountryCapabilityResolver {
    return {
      smsProviderIdFor: jest.fn((tenantId: string) => Promise.resolve(resolve(tenantId))),
    } as unknown as CountryCapabilityResolver;
  }

  describe("mockMode prod refusal (onApplicationBootstrap)", () => {
    it("throws when NODE_ENV=production and no provider is registered anywhere", () => {
      process.env.NODE_ENV = "production";
      delete process.env.ALLOW_MOCK_SMS_IN_PROD;
      const registry = new SmsProviderRegistry(); // empty
      const svc = new SmsService(makeConfig({}), registry, {} as CountryCapabilityResolver);

      expect(() => svc.onApplicationBootstrap()).toThrow(
        /SMS provider not configured in production/,
      );
    });

    it("still throws when DEPLOYMENT_COUNTRIES is unset (default TR) and no provider is registered — today's behaviour", () => {
      process.env.NODE_ENV = "production";
      delete process.env.ALLOW_MOCK_SMS_IN_PROD;
      delete process.env.DEPLOYMENT_COUNTRIES;
      const registry = new SmsProviderRegistry(); // empty
      const svc = new SmsService(makeConfig({}), registry, {} as CountryCapabilityResolver);

      expect(() => svc.onApplicationBootstrap()).toThrow(
        /SMS provider not configured in production/,
      );
    });

    it("does NOT throw when DEPLOYMENT_COUNTRIES=UZ and no provider is registered — UZ names no SMS provider at all (Task 12)", () => {
      // UZ's country profile has smsProviderId: null — no UZ tenant can
      // ever reach mock (CountryCapabilityResolver.smsProviderIdFor throws
      // first, per its own class comment). Demanding NetGSM/Twilio
      // credentials from a deployment that structurally cannot use them is
      // the SMS sibling of the PayTR bug Task 12 fixes.
      process.env.NODE_ENV = "production";
      delete process.env.ALLOW_MOCK_SMS_IN_PROD;
      process.env.DEPLOYMENT_COUNTRIES = "UZ";
      const registry = new SmsProviderRegistry(); // empty
      const svc = new SmsService(makeConfig({}), registry, {} as CountryCapabilityResolver);

      expect(() => svc.onApplicationBootstrap()).not.toThrow();
    });

    it("still throws when DEPLOYMENT_COUNTRIES=TR,UZ and no provider is registered — TR still needs one", () => {
      process.env.NODE_ENV = "production";
      delete process.env.ALLOW_MOCK_SMS_IN_PROD;
      process.env.DEPLOYMENT_COUNTRIES = "TR,UZ";
      const registry = new SmsProviderRegistry(); // empty
      const svc = new SmsService(makeConfig({}), registry, {} as CountryCapabilityResolver);

      expect(() => svc.onApplicationBootstrap()).toThrow(
        /SMS provider not configured in production/,
      );
    });

    it("allows mockMode in production with the explicit escape hatch", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOW_MOCK_SMS_IN_PROD = "true";
      const registry = new SmsProviderRegistry();
      const svc = new SmsService(makeConfig({}), registry, {} as CountryCapabilityResolver);

      expect(() => svc.onApplicationBootstrap()).not.toThrow();
    });

    it("allows mockMode in non-production", () => {
      process.env.NODE_ENV = "development";
      delete process.env.ALLOW_MOCK_SMS_IN_PROD;
      const registry = new SmsProviderRegistry();
      const svc = new SmsService(makeConfig({}), registry, {} as CountryCapabilityResolver);

      expect(() => svc.onApplicationBootstrap()).not.toThrow();
    });

    it("does NOT refuse in production when at least one provider is registered, even if it isn't the one every tenant needs", () => {
      // The process-wide boot check is deliberately coarse — "something is
      // configured" is enough to boot; a specific tenant needing an
      // unregistered provider is a send-time failure, not a boot-time one.
      // See the "config typo" describe block below. (Task 12's
      // DEPLOYMENT_COUNTRIES gate, tested above, only relaxes the OTHER
      // branch — an EMPTY registry — it never makes this branch stricter.)
      process.env.NODE_ENV = "production";
      delete process.env.ALLOW_MOCK_SMS_IN_PROD;
      const registry = new SmsProviderRegistry();
      registry.register(fakeProvider("twilio"));
      const svc = new SmsService(makeConfig({}), registry, {} as CountryCapabilityResolver);

      expect(() => svc.onApplicationBootstrap()).not.toThrow();
    });

    it("the constructor itself never throws — only onApplicationBootstrap performs the refusal", () => {
      // This is the load-bearing "why" of moving the check: provider
      // self-registration now happens in each adapter's OWN onModuleInit(),
      // and Nest does not guarantee onModuleInit() ordering ACROSS modules
      // — only that onApplicationBootstrap() fires for every provider after
      // every module's onModuleInit() has run. Checking in the constructor
      // (which runs during DI instantiation, before ANY onModuleInit) would
      // see an empty registry unconditionally and refuse to boot even when
      // NetGSM/Twilio credentials ARE configured.
      process.env.NODE_ENV = "production";
      delete process.env.ALLOW_MOCK_SMS_IN_PROD;
      const registry = new SmsProviderRegistry(); // empty AT CONSTRUCTION TIME
      expect(
        () => new SmsService(makeConfig({}), registry, {} as CountryCapabilityResolver),
      ).not.toThrow();
    });
  });

  describe("phone PII masking (mock mode)", () => {
    it("masks the phone in the mock-mode log line (OTP stays for dev visibility)", async () => {
      process.env.NODE_ENV = "development";
      const svc = new SmsService(
        makeConfig({}),
        new SmsProviderRegistry(),
        {} as CountryCapabilityResolver,
      );

      await svc.send("+905551234567", "OTP: 123456");

      const calls = logSpy.mock.calls.map((c) => c.join(" "));
      const mockLog = calls.find((c) => c.includes("[MOCK SMS]"));
      expect(mockLog).toBeDefined();
      expect(mockLog).not.toContain("+905551234567");
      expect(mockLog).toMatch(/\*/);
      expect(mockLog).toContain("OTP: 123456");
    });
  });

  describe("per-tenant routing (Task 11)", () => {
    it("GLOBAL CONSTRAINT: a Turkish tenant's SMS goes out through NetGSM with identical (to, message) arguments", async () => {
      process.env.NODE_ENV = "development";
      process.env.SMS_PROVIDER = "netgsm";
      const registry = new SmsProviderRegistry();
      const netgsmSend = jest
        .fn()
        .mockResolvedValue({ success: true, messageId: "ng-1" });
      registry.register(fakeProvider("netgsm", netgsmSend));
      registry.register(fakeProvider("twilio"));
      const capability = makeCapability(() => "netgsm");
      const svc = new SmsService(makeConfig({ SMS_PROVIDER: "netgsm" }), registry, capability);

      const result = await svc.send("+905551234567", "OTP: 654321", "tr-tenant-1");

      expect(capability.smsProviderIdFor).toHaveBeenCalledWith("tr-tenant-1");
      expect(netgsmSend).toHaveBeenCalledWith("+905551234567", "OTP: 654321");
      expect(result).toEqual({ success: true, messageId: "ng-1" });
    });

    it("resolves the tenant from the ambient RequestContext when no explicit tenantId is passed", async () => {
      const registry = new SmsProviderRegistry();
      const netgsmSend = jest.fn().mockResolvedValue({ success: true, messageId: "ng-2" });
      registry.register(fakeProvider("netgsm", netgsmSend));
      const capability = makeCapability(() => "netgsm");
      const svc = new SmsService(makeConfig({}), registry, capability);

      await RequestContext.run({ tenantId: "tr-tenant-ambient" }, () =>
        svc.send("+905551234567", "hello"),
      );

      expect(capability.smsProviderIdFor).toHaveBeenCalledWith("tr-tenant-ambient");
      expect(netgsmSend).toHaveBeenCalledWith("+905551234567", "hello");
    });

    it("an explicit tenantId argument works OUTSIDE any request context (non-request caller)", async () => {
      expect(RequestContext.get()).toBeUndefined(); // sanity: no ambient context here
      const registry = new SmsProviderRegistry();
      const netgsmSend = jest.fn().mockResolvedValue({ success: true, messageId: "ng-3" });
      registry.register(fakeProvider("netgsm", netgsmSend));
      const capability = makeCapability(() => "netgsm");
      const svc = new SmsService(makeConfig({}), registry, capability);

      await svc.send("+905551234567", "cron message", "tr-tenant-cron");

      expect(capability.smsProviderIdFor).toHaveBeenCalledWith("tr-tenant-cron");
      expect(netgsmSend).toHaveBeenCalledWith("+905551234567", "cron message");
    });

    it("an explicit tenantId takes precedence over the ambient RequestContext tenant", async () => {
      const registry = new SmsProviderRegistry();
      registry.register(fakeProvider("netgsm"));
      const capability = makeCapability(() => "netgsm");
      const svc = new SmsService(makeConfig({}), registry, capability);

      await RequestContext.run({ tenantId: "ambient-tenant" }, () =>
        svc.send("+905551234567", "hi", "explicit-tenant"),
      );

      expect(capability.smsProviderIdFor).toHaveBeenCalledWith("explicit-tenant");
      expect(capability.smsProviderIdFor).not.toHaveBeenCalledWith("ambient-tenant");
    });

    it("REFUSES for a UZ tenant — throws (rejects), never returns a fake success", async () => {
      const registry = new SmsProviderRegistry();
      registry.register(fakeProvider("netgsm")); // something IS configured in this process
      const capability = makeCapability(() => {
        throw new Error(
          "No SMS provider configured for UZ — the country profile lists none yet.",
        );
      });
      const svc = new SmsService(makeConfig({}), registry, capability);

      await expect(
        svc.send("+998901234567", "OTP: 111111", "uz-tenant-1"),
      ).rejects.toThrow(/no sms provider configured for uz/i);
    });

    it("CONFIG TYPO: a tenant's resolved provider id is not registered, while OTHER providers exist — loud throw, never mock", async () => {
      const registry = new SmsProviderRegistry();
      registry.register(fakeProvider("twilio")); // netgsm creds missing in THIS deployment
      const capability = makeCapability(() => "netgsm"); // country profile names netgsm
      const svc = new SmsService(makeConfig({}), registry, capability);

      // Never silently pretend-sent for a resolvable tenant with a genuine
      // config problem — that's exactly the "OTP logged in plaintext"
      // failure mode this whole refusal chain exists to prevent. The
      // promise REJECTS (not "resolves with success:true"), and the
      // message names the broken provider id and says explicitly this is a
      // config problem rather than mock mode.
      await expect(
        svc.send("+905551234567", "OTP: 222222", "tr-tenant-broken"),
      ).rejects.toThrow(/netgsm/i);
      await expect(
        svc.send("+905551234567", "OTP: 222222", "tr-tenant-broken"),
      ).rejects.toThrow(/configuration problem, not mock mode/i);
    });

    it("NO TENANT RESOLVABLE AT ALL: falls back to the process-wide default provider (documented fallback)", async () => {
      process.env.SMS_PROVIDER = "netgsm";
      const registry = new SmsProviderRegistry();
      const netgsmSend = jest.fn().mockResolvedValue({ success: true, messageId: "ng-default" });
      registry.register(fakeProvider("netgsm", netgsmSend));
      const capability = {
        smsProviderIdFor: jest.fn(),
      } as unknown as CountryCapabilityResolver;
      const svc = new SmsService(makeConfig({ SMS_PROVIDER: "netgsm" }), registry, capability);

      expect(RequestContext.get()).toBeUndefined();
      const result = await svc.send("+905551234567", "no tenant in scope");

      expect(capability.smsProviderIdFor).not.toHaveBeenCalled();
      expect(netgsmSend).toHaveBeenCalledWith("+905551234567", "no tenant in scope");
      expect(result.success).toBe(true);
    });

    it("NO TENANT RESOLVABLE + nothing registered at all: mocks rather than throwing (dev/test convenience, prod already refused to boot)", async () => {
      process.env.NODE_ENV = "development";
      const registry = new SmsProviderRegistry(); // empty
      const capability = { smsProviderIdFor: jest.fn() } as unknown as CountryCapabilityResolver;
      const svc = new SmsService(makeConfig({}), registry, capability);

      const result = await svc.send("+905551234567", "dev echo");

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^mock-/);
    });
  });

  describe("isServiceEnabled", () => {
    it("is false when the registry is empty (process-wide mock mode)", () => {
      const svc = new SmsService(
        makeConfig({}),
        new SmsProviderRegistry(),
        {} as CountryCapabilityResolver,
      );
      expect(svc.isServiceEnabled()).toBe(false);
    });

    it("is true once at least one provider is registered", () => {
      const registry = new SmsProviderRegistry();
      registry.register(fakeProvider("netgsm"));
      const svc = new SmsService(makeConfig({}), registry, {} as CountryCapabilityResolver);
      expect(svc.isServiceEnabled()).toBe(true);
    });
  });
});
