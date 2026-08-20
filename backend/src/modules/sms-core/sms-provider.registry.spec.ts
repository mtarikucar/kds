import { NotFoundException } from "@nestjs/common";
import { SmsProviderRegistry } from "./sms-provider.registry";
import { SmsProvider } from "./sms-provider.interface";

/**
 * Mirrors fiscal-provider.registry.spec.ts. Load-bearing contracts:
 * register-then-get round-trips by name, an unknown id throws NotFound (so
 * a country profile naming a typo'd/unconfigured provider fails loudly
 * rather than silently dropping SMS), and re-registering the same name
 * overwrites.
 */
describe("SmsProviderRegistry", () => {
  const fakeProvider = (name: string): SmsProvider =>
    ({
      name,
      isConfigured: () => true,
      send: jest.fn(),
    }) as unknown as SmsProvider;

  it("registers a provider and retrieves it by name", () => {
    const reg = new SmsProviderRegistry();
    const p = fakeProvider("netgsm");
    reg.register(p);
    expect(reg.get("netgsm")).toBe(p);
  });

  it("throws NotFound for an unknown provider id", () => {
    const reg = new SmsProviderRegistry();
    expect(() => reg.get("nope")).toThrow(NotFoundException);
  });

  it("list returns every registered provider", () => {
    const reg = new SmsProviderRegistry();
    reg.register(fakeProvider("netgsm"));
    reg.register(fakeProvider("twilio"));
    expect(reg.list().map((p) => p.name).sort()).toEqual(["netgsm", "twilio"]);
  });

  it("list is empty when nothing has registered", () => {
    expect(new SmsProviderRegistry().list()).toEqual([]);
  });

  it("re-registering the same name overwrites the prior provider", () => {
    const reg = new SmsProviderRegistry();
    const first = fakeProvider("netgsm");
    const second = fakeProvider("netgsm");
    reg.register(first);
    reg.register(second);
    expect(reg.get("netgsm")).toBe(second);
    expect(reg.list()).toHaveLength(1);
  });
});
