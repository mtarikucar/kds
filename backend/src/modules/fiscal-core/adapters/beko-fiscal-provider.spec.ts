import { BekoFiscalProvider } from "./beko-fiscal-provider";
import { Gmp3FiscalReceiptCommand } from "./gmp3-fiscal-provider.base";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { PrismaService } from "../../../prisma/prisma.service";
import { CommandQueueService } from "../../device-mesh/command-queue.service";
import { FiscalReceiptRequest } from "../fiscal-provider.interface";

/**
 * Spec for the Beko GMP-3 ÖKC adapter. The shared GMP-3 flow is exercised in
 * depth by the Hugin spec; here we pin the Beko vendor specifics (id +
 * vendorProfile dispatched to the Beko SDK on the bridge) and confirm the
 * thin subclass self-registers and routes through the same command-queue
 * transport.
 */
describe("BekoFiscalProvider", () => {
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
      provider: new BekoFiscalProvider(registry, prisma, commandQueue),
    };
  }

  const req: FiscalReceiptRequest = {
    tenantId: "t1",
    fiscalDeviceId: "fd-beko",
    idempotencyKey: "idem-beko-1",
    lines: [
      {
        productCode: "P1",
        name: "Lahmacun",
        qty: 3,
        unitPriceCents: 4000,
        vatRate: 10,
      },
    ],
    payments: [{ method: "cash", amountCents: 12000 }],
  };

  it("exposes the fiscal_beko id and the GMP-3 capability set", () => {
    const { provider } = makeMocks();
    expect(provider.id).toBe("fiscal_beko");
    expect(provider.capabilities.sort()).toEqual(
      ["cancel", "receipt", "x_report", "z_report"].sort(),
    );
  });

  it("self-registers on module init", () => {
    const { provider, registry } = makeMocks();
    provider.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(provider);
  });

  it("dispatches the Beko vendor profile in the GMP-3 command and maps KDV 10 → dept D", async () => {
    const { provider, prisma, commandQueue } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
      deviceId: "mesh-beko-1",
      serial: "BK-SER-9",
      branchId: "b1",
    });
    (prisma.deviceCommand.findUnique as jest.Mock).mockResolvedValue({
      status: "done",
      result: { fiscalNo: "0009" },
      error: null,
    });

    const res = await provider.issueReceipt(req);
    expect(res.status).toBe("issued");
    expect(res.fiscalNo).toBe("0009");

    const payload = (commandQueue.enqueue as jest.Mock).mock.calls[0][2]
      .payload as unknown as Gmp3FiscalReceiptCommand;
    expect(payload.vendorProfile).toBe("beko.gmp3");
    expect(payload.fiscalSerial).toBe("BK-SER-9");
    expect(payload.lines[0].department).toBe("D"); // KDV 10 → D
    expect(payload.lines[0].quantityMilli).toBe(3000);
    expect(payload.payments[0].tender).toBe("NAKIT");
  });
});
