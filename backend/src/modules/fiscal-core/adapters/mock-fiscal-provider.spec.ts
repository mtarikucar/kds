import { MockFiscalProvider } from "./mock-fiscal-provider";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { FiscalReceiptRequest } from "../fiscal-provider.interface";

/**
 * Long-tail spec for the sandbox fiscal provider (the FAKE impl behind the
 * FiscalProvider seam). Load-bearing contracts: idempotency (same
 * idempotencyKey → identical receipt, no new fiscal number burned);
 * monotonically-increasing zero-padded fiscal numbers; online status;
 * and it self-registers on init OUTSIDE production only.
 */
describe("MockFiscalProvider", () => {
  function makeReq(key: string): FiscalReceiptRequest {
    return {
      tenantId: "t1",
      fiscalDeviceId: "dev-1",
      lines: [],
      payments: [],
      idempotencyKey: key,
    };
  }

  it("issues a fiscal number that is zero-padded to 8 digits and increments", async () => {
    const provider = new MockFiscalProvider({} as FiscalProviderRegistry);
    const r1 = await provider.issueReceipt(makeReq("k1"));
    const r2 = await provider.issueReceipt(makeReq("k2"));
    expect(r1.fiscalNo).toBe("00000001");
    expect(r2.fiscalNo).toBe("00000002");
    expect(r1.status).toBe("issued");
  });

  it("is idempotent: the same key returns the cached receipt", async () => {
    const provider = new MockFiscalProvider({} as FiscalProviderRegistry);
    const first = await provider.issueReceipt(makeReq("same"));
    const second = await provider.issueReceipt(makeReq("same"));
    expect(second).toBe(first);
    expect(second.receiptId).toBe(first.receiptId);
    expect(second.fiscalNo).toBe(first.fiscalNo); // no extra number burned
  });

  it("reports the device as online", async () => {
    const provider = new MockFiscalProvider({} as FiscalProviderRegistry);
    const status = await provider.status("dev-1");
    expect(status).toMatchObject({
      providerId: "mock",
      fiscalDeviceId: "dev-1",
      status: "online",
    });
  });

  it("self-registers on init when NOT in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    const register = jest.fn();
    const provider = new MockFiscalProvider({
      register,
    } as unknown as FiscalProviderRegistry);
    provider.onModuleInit();
    expect(register).toHaveBeenCalledWith(provider);
    process.env.NODE_ENV = prev;
  });

  it("does NOT self-register in production (sandbox must not serve real receipts)", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const register = jest.fn();
    const provider = new MockFiscalProvider({
      register,
    } as unknown as FiscalProviderRegistry);
    provider.onModuleInit();
    expect(register).not.toHaveBeenCalled();
    process.env.NODE_ENV = prev;
  });

  it("healthCheck reports ok in mock mode", async () => {
    const provider = new MockFiscalProvider({} as FiscalProviderRegistry);
    await expect(provider.healthCheck()).resolves.toMatchObject({ ok: true });
  });
});
