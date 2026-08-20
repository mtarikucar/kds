import { ConfigService } from "@nestjs/config";
import { TwilioProvider } from "./twilio.provider";
import { SmsProviderRegistry } from "../sms-provider.registry";

/**
 * Task 11: TwilioProvider becomes an @Injectable() DI adapter that
 * self-registers into SmsProviderRegistry from onModuleInit() — conditional
 * on having real credentials. Mirrors netgsm.provider.spec.ts.
 */
describe("TwilioProvider", () => {
  function makeConfig(env: Record<string, string | undefined>): ConfigService {
    return { get: (key: string) => env[key] } as ConfigService;
  }

  it("registers itself as 'twilio' when credentials are present", () => {
    const registry = { register: jest.fn() } as unknown as SmsProviderRegistry;
    const provider = new TwilioProvider(
      registry,
      makeConfig({
        TWILIO_ACCOUNT_SID: "AC123",
        TWILIO_AUTH_TOKEN: "secret",
        TWILIO_PHONE_NUMBER: "+15551234567",
      }),
    );

    provider.onModuleInit();

    expect(provider.name).toBe("twilio");
    expect(provider.isConfigured()).toBe(true);
    expect(registry.register).toHaveBeenCalledWith(provider);
  });

  it("does NOT register when credentials are missing", () => {
    const registry = { register: jest.fn() } as unknown as SmsProviderRegistry;
    const provider = new TwilioProvider(registry, makeConfig({}));

    provider.onModuleInit();

    expect(provider.isConfigured()).toBe(false);
    expect(registry.register).not.toHaveBeenCalled();
  });

  it("does NOT register when the phone number is missing (account creds alone are not enough)", () => {
    const registry = { register: jest.fn() } as unknown as SmsProviderRegistry;
    const provider = new TwilioProvider(
      registry,
      makeConfig({
        TWILIO_ACCOUNT_SID: "AC123",
        TWILIO_AUTH_TOKEN: "secret",
      }),
    );

    provider.onModuleInit();

    expect(registry.register).not.toHaveBeenCalled();
  });
});
