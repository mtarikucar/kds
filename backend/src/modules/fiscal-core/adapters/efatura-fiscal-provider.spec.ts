import { EfaturaFiscalProvider } from "./efatura-fiscal-provider";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { FiscalReceiptRequest } from "../fiscal-provider.interface";

/**
 * Spec for the e-Fatura/e-Arşiv adapter (HONESTY SHIM).
 *
 * Load-bearing contract: this provider does NOT issue e-documents. The real
 * e-Fatura/e-Arşiv rail lives in the accounting module (SalesInvoiceService →
 * AccountingSyncService) and fires on order payment. So this adapter MUST:
 *   - NEVER return status:'issued' (it submits nothing to the GİB),
 *   - NEVER write a SalesInvoice row (it now has NO DB access at all — the
 *     PrismaService injection was removed once the fake-issuance was deleted),
 *   - NEVER mint a fake fiscalNo,
 *   - return status:'failed' with a message pointing at Settings → Accounting.
 */
describe("EfaturaFiscalProvider", () => {
  function makeProvider() {
    const registry = {
      register: jest.fn(),
    } as unknown as FiscalProviderRegistry;
    return { provider: new EfaturaFiscalProvider(registry) };
  }

  const req: FiscalReceiptRequest = {
    tenantId: "t1",
    fiscalDeviceId: "dev-1",
    orderId: "o1",
    idempotencyKey: "idem-1",
    lines: [
      {
        productCode: "P1",
        name: "Coffee",
        qty: 2,
        unitPriceCents: 5000,
        vatRate: 20,
      },
    ],
    payments: [{ method: "card", amountCents: 10000 }],
  };

  it("refuses to fake an issuance: status=failed, no fiscalNo", async () => {
    const { provider } = makeProvider();
    const result = await provider.issueReceipt(req);
    expect(result.status).toBe("failed");
    expect(result.fiscalNo).toBeUndefined();
    expect(result.receiptId).toBe("idem-1");
    expect(result.error).toMatch(/Accounting/i);
  });

  it("has no DB dependency (cannot write a SalesInvoice — orphan-divergence is structurally impossible)", () => {
    // The provider no longer takes a PrismaService; constructing it with only
    // the registry proves the fake-issuance write path is gone for good.
    const { provider } = makeProvider();
    expect(provider).toBeInstanceOf(EfaturaFiscalProvider);
  });

  it("registers itself on module init", () => {
    const registry = {
      register: jest.fn(),
    } as unknown as FiscalProviderRegistry;
    const provider = new EfaturaFiscalProvider(registry);
    provider.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(provider);
  });

  it("reports online status and an empty e-Arşiv Z report", async () => {
    const { provider } = makeProvider();
    await expect(provider.status("dev-1")).resolves.toMatchObject({
      status: "online",
    });
    const z = await provider.zReport("dev-1", new Date());
    expect(z.zNo).toBe(""); // e-Arşiv has no Z report
  });
});
