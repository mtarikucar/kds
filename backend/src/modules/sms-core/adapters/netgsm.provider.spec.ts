import { ConfigService } from "@nestjs/config";
import { NetGsmProvider } from "./netgsm.provider";
import { SmsProviderRegistry } from "../sms-provider.registry";

/**
 * Task 11: NetGsmProvider becomes an @Injectable() DI adapter (mirrors
 * PaytrPaymentProvider / HuginFiscalProvider) that self-registers into
 * SmsProviderRegistry from its own onModuleInit() — conditional on having
 * real credentials, exactly like the pre-refactor initializeProvider()
 * required NetGsmProvider.isConfigured() before selecting it.
 */
describe("NetGsmProvider", () => {
  function makeConfig(env: Record<string, string | undefined>): ConfigService {
    return { get: (key: string) => env[key] } as ConfigService;
  }

  it("registers itself as 'netgsm' when credentials are present", () => {
    const registry = { register: jest.fn() } as unknown as SmsProviderRegistry;
    const provider = new NetGsmProvider(
      registry,
      makeConfig({
        NETGSM_USERCODE: "u",
        NETGSM_PASSWORD: "p",
        NETGSM_MSGHEADER: "HummyTummy",
      }),
    );

    provider.onModuleInit();

    expect(provider.name).toBe("netgsm");
    expect(provider.isConfigured()).toBe(true);
    expect(registry.register).toHaveBeenCalledWith(provider);
  });

  it("does NOT register when credentials are missing", () => {
    const registry = { register: jest.fn() } as unknown as SmsProviderRegistry;
    const provider = new NetGsmProvider(registry, makeConfig({}));

    provider.onModuleInit();

    expect(provider.isConfigured()).toBe(false);
    expect(registry.register).not.toHaveBeenCalled();
  });

  it("does NOT register when only some credentials are present (partial config)", () => {
    const registry = { register: jest.fn() } as unknown as SmsProviderRegistry;
    const provider = new NetGsmProvider(
      registry,
      makeConfig({ NETGSM_USERCODE: "u" }),
    );

    provider.onModuleInit();

    expect(registry.register).not.toHaveBeenCalled();
  });
});
