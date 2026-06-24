import { EfaturaFiscalProvider } from "./efatura-fiscal-provider";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { PrismaService } from "../../../prisma/prisma.service";
import { FiscalReceiptRequest } from "../fiscal-provider.interface";

/**
 * Spec for the e-Fatura/e-Arşiv adapter (HONESTY SHIM).
 *
 * Load-bearing contract: this provider does NOT issue e-documents. The real
 * e-Fatura/e-Arşiv rail lives in the accounting module (SalesInvoiceService →
 * AccountingSyncService) and fires on order payment. So this adapter MUST:
 *   - NEVER return status:'issued' (it submits nothing to the GİB),
 *   - NEVER write a SalesInvoice row (that orphan-diverged the ledger),
 *   - NEVER mint a fake fiscalNo,
 *   - return status:'failed' with a message pointing at Settings → Accounting.
 */
describe("EfaturaFiscalProvider", () => {
  function makeProvider(createImpl: jest.Mock = jest.fn()) {
    const registry = {
      register: jest.fn(),
    } as unknown as FiscalProviderRegistry;
    const prisma = {
      salesInvoice: { create: createImpl },
    } as unknown as PrismaService;
    return { provider: new EfaturaFiscalProvider(registry, prisma), create: createImpl };
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

  it("NEVER writes a SalesInvoice row (no orphaned/diverged invoice)", async () => {
    const { provider, create } = makeProvider();
    await provider.issueReceipt(req);
    expect(create).not.toHaveBeenCalled();
  });

  it("registers itself on module init", () => {
    const registry = {
      register: jest.fn(),
    } as unknown as FiscalProviderRegistry;
    const provider = new EfaturaFiscalProvider(registry, {
      salesInvoice: { create: jest.fn() },
    } as unknown as PrismaService);
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
