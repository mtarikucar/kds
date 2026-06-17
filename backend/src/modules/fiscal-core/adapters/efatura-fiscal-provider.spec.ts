import { EfaturaFiscalProvider } from "./efatura-fiscal-provider";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { PrismaService } from "../../../prisma/prisma.service";
import { FiscalReceiptRequest } from "../fiscal-provider.interface";

/**
 * Long-tail spec for the e-Fatura/e-Arşiv adapter (the real impl behind the
 * FiscalProvider seam, driven against a fake Prisma). Load-bearing
 * contracts: it mirrors a SalesInvoice row, mints a unique grep-friendly
 * fiscalNo, and — critically — when the mirror write fails it returns
 * status:'failed' (NOT 'issued') so accounting can't silently diverge from
 * the fiscal ledger.
 */
describe("EfaturaFiscalProvider", () => {
  function makeProvider(createImpl: jest.Mock) {
    const registry = {
      register: jest.fn(),
    } as unknown as FiscalProviderRegistry;
    const prisma = {
      salesInvoice: { create: createImpl },
    } as unknown as PrismaService;
    return new EfaturaFiscalProvider(registry, prisma);
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

  it("issues with status=issued and a grep-friendly EARS fiscalNo", async () => {
    const create = jest.fn().mockResolvedValue({});
    const provider = makeProvider(create);
    const result = await provider.issueReceipt(req);
    expect(result.status).toBe("issued");
    expect(result.fiscalNo).toMatch(/^EARS-\d{4}-\d{8}-[0-9a-f]{8}$/);
    expect(result.receiptId).toBe("idem-1");
  });

  it("mirrors a SalesInvoice row with TRY money converted from cents", async () => {
    const create = jest.fn().mockResolvedValue({});
    const provider = makeProvider(create);
    await provider.issueReceipt(req);
    const data = create.mock.calls[0][0].data;
    expect(data.tenantId).toBe("t1");
    expect(data.currency).toBe("TRY");
    expect(data.status).toBe("pending");
    // deep-review H9/M9: prices are KDV-inclusive, so 2 * 5000 = 10000 cents =
    // 100.00 TRY is the GROSS (totalAmount). The taxable base (subtotal) is
    // net = gross - extracted KDV; at 20% that is 100 - round(100*20/120) =
    // 100 - 16.67 = 83.33. The row now writes the real SalesInvoice columns
    // (subtotal/taxAmount/totalAmount), not the non-existent `kind`/`total`.
    expect(data.totalAmount).toBe(100);
    expect(data.subtotal).toBeCloseTo(83.33, 2);
    expect(data.taxAmount).toBeCloseTo(16.67, 2);
    expect(data.type).toBe("SALES");
    expect(data.items.create).toHaveLength(1);
  });

  it("returns status=failed (not issued) when the mirror write throws", async () => {
    const create = jest.fn().mockRejectedValue(new Error("P2002 unique"));
    const provider = makeProvider(create);
    const result = await provider.issueReceipt(req);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/SalesInvoice mirror failed/);
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
    const provider = makeProvider(jest.fn());
    await expect(provider.status("dev-1")).resolves.toMatchObject({
      status: "online",
    });
    const z = await provider.zReport("dev-1", new Date());
    expect(z.zNo).toBe(""); // e-Arşiv has no Z report
  });
});
