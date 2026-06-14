import { NotFoundException } from "@nestjs/common";
import { FiscalProviderRegistry } from "./fiscal-provider.registry";
import { FiscalProvider } from "./fiscal-provider.interface";

/**
 * Long-tail spec for the fiscal provider registry — the seam over real
 * yazarkasa hardware. Load-bearing contracts: register-then-get round-trips
 * by id, an unknown id throws NotFound (so a typo'd provider config fails
 * loudly rather than silently dropping receipts), and re-registering the
 * same id overwrites.
 */
describe("FiscalProviderRegistry", () => {
  const fakeProvider = (id: string): FiscalProvider =>
    ({
      id,
      capabilities: ["receipt"],
    }) as unknown as FiscalProvider;

  it("registers a provider and retrieves it by id", () => {
    const reg = new FiscalProviderRegistry();
    const p = fakeProvider("mock");
    reg.register(p);
    expect(reg.get("mock")).toBe(p);
  });

  it("throws NotFound for an unknown provider id", () => {
    const reg = new FiscalProviderRegistry();
    expect(() => reg.get("nope")).toThrow(NotFoundException);
  });

  it("list returns every registered provider", () => {
    const reg = new FiscalProviderRegistry();
    reg.register(fakeProvider("a"));
    reg.register(fakeProvider("b"));
    expect(reg.list().map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("re-registering the same id overwrites the prior provider", () => {
    const reg = new FiscalProviderRegistry();
    const first = fakeProvider("dup");
    const second = fakeProvider("dup");
    reg.register(first);
    reg.register(second);
    expect(reg.get("dup")).toBe(second);
    expect(reg.list()).toHaveLength(1);
  });
});
