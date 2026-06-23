import { HuginFiscalProvider } from "./hugin-fiscal-provider";
import { Gmp3FiscalReceiptCommand } from "./gmp3-fiscal-provider.base";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { PrismaService } from "../../../prisma/prisma.service";
import { CommandQueueService } from "../../device-mesh/command-queue.service";
import { FiscalReceiptRequest } from "../fiscal-provider.interface";

/**
 * Spec for the real GMP-3 / TSM yazarkasa (ÖKC) adapter — exercised through
 * HuginFiscalProvider, which is a thin shell over Gmp3FiscalProviderBase, so
 * this covers the shared base contract end-to-end with vendor specifics
 * pinned to Hugin.
 *
 * Load-bearing contracts:
 *  - capabilities = receipt|z_report|x_report|cancel
 *  - issueReceipt enqueues a `fiscal_receipt` GMP-3 command onto the linked
 *    mesh device (local_bridge), carrying the caller's idempotencyKey so a
 *    retry re-binds the SAME command row (no second fiş printed);
 *  - lines map onto KDV department groups A–F; payments map onto GMP-3 tender
 *    codes; money stays in integer kuruş;
 *  - the bridge ack is correlated by (deviceId, idempotencyKey) and mapped:
 *    done→issued (fiscalNo/fiscalZNo carried), failed→failed, else→queued;
 *  - a fiscal record with no linked mesh device is a clean 404 (can't drive
 *    an on-prem ÖKC from the cloud);
 *  - self-registers on module init.
 */
describe("HuginFiscalProvider (GMP-3 base)", () => {
  function makeMocks() {
    const registry = {
      register: jest.fn(),
    } as unknown as FiscalProviderRegistry;
    const prisma = {
      fiscalDeviceRecord: {
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      fiscalReceipt: { findFirst: jest.fn() },
      deviceCommand: { findUnique: jest.fn() },
    } as unknown as PrismaService;
    const commandQueue = {
      enqueue: jest.fn().mockResolvedValue({ id: "cmd-1" }),
    } as unknown as CommandQueueService;
    const provider = new HuginFiscalProvider(registry, prisma, commandQueue);
    return { registry, prisma, commandQueue, provider };
  }

  const req: FiscalReceiptRequest = {
    tenantId: "t1",
    branchId: "b1",
    fiscalDeviceId: "fd-1",
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
      {
        productCode: "P2",
        name: "Water",
        qty: 1,
        unitPriceCents: 1000,
        vatRate: 1,
      },
    ],
    payments: [{ method: "card", amountCents: 11000, brand: "VISA" }],
  };

  function linkedDevice() {
    return {
      deviceId: "mesh-dev-1",
      serial: "HG-SER-1",
      branchId: "b1",
      tenantId: "t1",
    };
  }

  it("exposes the GMP-3 capability set and the fiscal_hugin id", () => {
    const { provider } = makeMocks();
    expect(provider.id).toBe("fiscal_hugin");
    expect(provider.capabilities.sort()).toEqual(
      ["cancel", "receipt", "x_report", "z_report"].sort(),
    );
  });

  it("self-registers on module init", () => {
    const { provider, registry } = makeMocks();
    provider.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(provider);
  });

  it("enqueues a GMP-3 fiscal_receipt command on the linked mesh device with the caller's idempotencyKey", async () => {
    const { provider, prisma, commandQueue } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(
      linkedDevice(),
    );
    (prisma.deviceCommand.findUnique as jest.Mock).mockResolvedValue(null);

    await provider.issueReceipt(req);

    expect(commandQueue.enqueue).toHaveBeenCalledTimes(1);
    const [tenantId, meshDeviceId, input, branchId] = (
      commandQueue.enqueue as jest.Mock
    ).mock.calls[0];
    expect(tenantId).toBe("t1");
    expect(meshDeviceId).toBe("mesh-dev-1");
    expect(input.kind).toBe("fiscal_receipt");
    expect(input.idempotencyKey).toBe("idem-1");
    expect(branchId).toBe("b1");

    const payload = input.payload as unknown as Gmp3FiscalReceiptCommand;
    expect(payload.protocol).toBe("GMP3");
    expect(payload.vendorProfile).toBe("hugin.gmp3");
    expect(payload.fiscalSerial).toBe("HG-SER-1");
    expect(payload.kind).toBe("cash_receipt");
  });

  it("maps KDV rates onto department groups A–F and quantities into milli-units", async () => {
    const { provider, prisma, commandQueue } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(
      linkedDevice(),
    );
    (prisma.deviceCommand.findUnique as jest.Mock).mockResolvedValue(null);

    await provider.issueReceipt(req);

    const payload = (commandQueue.enqueue as jest.Mock).mock.calls[0][2]
      .payload as unknown as Gmp3FiscalReceiptCommand;
    // KDV 20 → dept F, KDV 1 → dept B (default TR hospitality layout).
    expect(payload.lines[0].department).toBe("F");
    expect(payload.lines[1].department).toBe("B");
    // qty 2 → 2000 milli; money stays integer kuruş.
    expect(payload.lines[0].quantityMilli).toBe(2000);
    expect(payload.lines[0].unitPriceCents).toBe(5000);
  });

  it("maps payment methods onto GMP-3 tender codes (card → KREDI_KARTI)", async () => {
    const { provider, prisma, commandQueue } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(
      linkedDevice(),
    );
    (prisma.deviceCommand.findUnique as jest.Mock).mockResolvedValue(null);

    await provider.issueReceipt(req);

    const payload = (commandQueue.enqueue as jest.Mock).mock.calls[0][2]
      .payload as unknown as Gmp3FiscalReceiptCommand;
    expect(payload.payments[0].tender).toBe("KREDI_KARTI");
    expect(payload.payments[0].amountCents).toBe(11000);
    expect(payload.payments[0].brand).toBe("VISA");
  });

  it("returns status=queued (receiptId=idempotencyKey) while the bridge has not yet acked", async () => {
    const { provider, prisma } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(
      linkedDevice(),
    );
    (prisma.deviceCommand.findUnique as jest.Mock).mockResolvedValue({
      status: "inflight",
      result: null,
      error: null,
    });

    const res = await provider.issueReceipt(req);
    expect(res.status).toBe("queued");
    expect(res.receiptId).toBe("idem-1");
    expect(res.providerId).toBe("fiscal_hugin");
  });

  it("maps a bridge `done` ack onto status=issued, carrying fiscalNo/fiscalZNo", async () => {
    const { provider, prisma } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(
      linkedDevice(),
    );
    (prisma.deviceCommand.findUnique as jest.Mock).mockResolvedValue({
      status: "done",
      result: { fiscalNo: "0000123", fiscalZNo: "0042", raw: { ek: "u" } },
      error: null,
    });

    const res = await provider.issueReceipt(req);
    expect(res.status).toBe("issued");
    expect(res.fiscalNo).toBe("0000123");
    expect(res.fiscalZNo).toBe("0042");
    expect(res.raw).toEqual({ ek: "u" });
  });

  it("maps a bridge `failed` ack onto status=failed, surfacing the device error", async () => {
    const { provider, prisma } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(
      linkedDevice(),
    );
    (prisma.deviceCommand.findUnique as jest.Mock).mockResolvedValue({
      status: "failed",
      result: null,
      error: "ÖKC paper out",
    });

    const res = await provider.issueReceipt(req);
    expect(res.status).toBe("failed");
    expect(res.error).toBe("ÖKC paper out");
  });

  it("404s when the fiscal device has no linked mesh bridge (cannot drive an on-prem ÖKC)", async () => {
    const { provider, prisma, commandQueue } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
      deviceId: null,
      serial: "HG-SER-1",
      branchId: "b1",
    });
    await expect(provider.issueReceipt(req)).rejects.toThrow(
      /no linked mesh device/i,
    );
    expect(commandQueue.enqueue).not.toHaveBeenCalled();
  });

  it("404s when the fiscal device record is unknown for this provider", async () => {
    const { provider, prisma } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(provider.issueReceipt(req)).rejects.toThrow(/not found/i);
  });

  it("returns status=failed (not throwing) when the enqueue itself throws", async () => {
    const { provider, prisma, commandQueue } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(
      linkedDevice(),
    );
    (commandQueue.enqueue as jest.Mock).mockRejectedValue(
      new Error("queue down"),
    );
    const res = await provider.issueReceipt(req);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/enqueue failed/);
  });

  it("cancelReceipt resolves the originating ÖKC and enqueues a GMP-3 fiscal_cancel", async () => {
    const { provider, prisma, commandQueue } = makeMocks();
    (prisma.fiscalReceipt.findFirst as jest.Mock).mockResolvedValue({
      tenantId: "t1",
      fiscalDeviceId: "fd-1",
      branchId: "b1",
    });
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(
      linkedDevice(),
    );

    await provider.cancelReceipt("rcpt-1", "müşteri iadesi");

    const [, meshDeviceId, input] = (commandQueue.enqueue as jest.Mock).mock
      .calls[0];
    expect(meshDeviceId).toBe("mesh-dev-1");
    expect(input.kind).toBe("fiscal_cancel");
    expect(input.idempotencyKey).toBe("cancel:rcpt-1");
  });

  it("zReport enqueues a GMP-3 Z report and maps the bridge totals/zNo back", async () => {
    const { provider, prisma } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(
      linkedDevice(),
    );
    (prisma.deviceCommand.findUnique as jest.Mock).mockResolvedValue({
      status: "done",
      result: {
        zNo: "Z-0042",
        openedAt: "2026-06-23T06:00:00.000Z",
        closedAt: "2026-06-23T23:59:00.000Z",
        totals: { cash: 12345, card: 6789 },
      },
      error: null,
    });

    const z = await provider.zReport("fd-1", new Date("2026-06-23T12:00:00Z"));
    expect(z.providerId).toBe("fiscal_hugin");
    expect(z.zNo).toBe("Z-0042");
    expect(z.totals).toEqual({ cash: 12345, card: 6789 });
  });

  it("healthCheck is ok when the DB is reachable", async () => {
    const { provider } = makeMocks();
    await expect(provider.healthCheck()).resolves.toMatchObject({ ok: true });
  });

  it("reports the persisted device status, defaulting unknown rows to offline", async () => {
    const { provider, prisma } = makeMocks();
    (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(null);
    const s = await provider.status("fd-x");
    expect(s.status).toBe("offline");
    expect(s.providerId).toBe("fiscal_hugin");
  });
});
