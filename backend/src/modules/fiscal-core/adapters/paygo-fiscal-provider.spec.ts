import { PaygoFiscalProvider } from "./paygo-fiscal-provider";
import { Gmp3FiscalReceiptCommand } from "./gmp3-fiscal-provider.base";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { PrismaService } from "../../../prisma/prisma.service";
import { CommandQueueService } from "../../device-mesh/command-queue.service";
import { FiscalReceiptRequest } from "../fiscal-provider.interface";

/**
 * Spec for the Paygo SP630 GMP-3 ÖKC adapter (the cash/non-card fiş rail). The
 * shared GMP-3 flow is exercised in depth by the Hugin spec; here we pin the
 * Paygo vendor specifics (id + vendorProfile dispatched to the gmp3 driver's
 * Paygo profile on the bridge) and confirm the thin subclass self-registers and
 * routes through the same command-queue transport.
 */
describe("PaygoFiscalProvider", () => {
  function makeMocks() {
    const registry = {
      register: jest.fn(),
    } as unknown as FiscalProviderRegistry;
    const prisma = {
      fiscalDeviceRecord: {
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      deviceCommand: { findUnique: jest.fn() },
    } as unknown as PrismaService;
    const commandQueue = {
      enqueue: jest.fn().mockResolvedValue({ id: "cmd-1" }),
    } as unknown as CommandQueueService;
    return {
      registry,
      prisma,
      commandQueue,
      provider: new PaygoFiscalProvider(registry, prisma, commandQueue),
    };
  }

  const req: FiscalReceiptRequest = {
    tenantId: "t1",
    fiscalDeviceId: "fd-paygo",
    idempotencyKey: "idem-paygo-1",
    lines: [
      {
        productCode: "P1",
        name: "Çay",
        qty: 2,
        unitPriceCents: 1500,
        vatRate: 20,
      },
    ],
    payments: [{ method: "cash", amountCents: 3000 }],
  };

  it("exposes the fiscal_paygo id and the GMP-3 capability set", () => {
    const { provider } = makeMocks();
    expect(provider.id).toBe("fiscal_paygo");
    expect(provider.capabilities.sort()).toEqual(
      ["cancel", "receipt", "x_report", "z_report"].sort(),
    );
  });

  it("self-registers on module init", () => {
    const { provider, registry } = makeMocks();
    provider.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(provider);
  });

  it("dispatches the paygo.sp630 vendor profile in the GMP-3 command and maps KDV 20 → dept F", async () => {
    const { provider, prisma, commandQueue } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
      deviceId: "mesh-paygo-1",
      serial: "5B0024050735",
      branchId: "b1",
    });
    (prisma.deviceCommand.findUnique as jest.Mock).mockResolvedValue({
      status: "done",
      result: { fiscalNo: "0042" },
      error: null,
    });

    const res = await provider.issueReceipt(req);
    expect(res.status).toBe("issued");
    expect(res.fiscalNo).toBe("0042");

    const payload = (commandQueue.enqueue as jest.Mock).mock.calls[0][2]
      .payload as unknown as Gmp3FiscalReceiptCommand;
    expect(payload.protocol).toBe("GMP3");
    expect(payload.vendorProfile).toBe("paygo.sp630");
    expect(payload.fiscalSerial).toBe("5B0024050735");
    expect(payload.lines[0].department).toBe("F"); // KDV 20 → F
    expect(payload.lines[0].quantityMilli).toBe(2000);
    expect(payload.payments[0].tender).toBe("NAKIT");
  });
});
