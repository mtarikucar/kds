import { FiscalService } from "./fiscal.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { FiscalProviderRegistry } from "./fiscal-provider.registry";

/**
 * Behavioural tests for the fiscal service. The DB is mocked but the
 * pricing math (vat breakdown, total) runs for real — that math is the
 * compliance-sensitive part.
 */
describe("FiscalService.issueReceipt", () => {
  let prisma: MockPrismaClient;
  let registry: jest.Mocked<FiscalProviderRegistry>;
  let outbox: { append: jest.Mock };
  let svc: FiscalService;

  const TENANT = "t1";
  const DEVICE_ID = "fd-1";

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue("outbox") };
    registry = { get: jest.fn() } as any;
    svc = new FiscalService(prisma as any, registry as any, outbox as any);
  });

  it("returns the existing row on idempotent retry", async () => {
    prisma.fiscalDeviceRecord.findFirst.mockResolvedValue({
      id: DEVICE_ID,
      tenantId: TENANT,
      providerId: "mock",
      status: "online",
    } as any);
    prisma.fiscalReceipt.findUnique.mockResolvedValue({
      id: "fr-1",
      tenantId: TENANT,
      status: "issued",
    } as any);

    const out = await svc.issueReceipt({
      tenantId: TENANT,
      fiscalDeviceId: DEVICE_ID,
      lines: [
        {
          productCode: "X",
          name: "X",
          qty: 1,
          unitPriceCents: 1200,
          vatRate: 20,
        },
      ],
      payments: [{ method: "cash", amountCents: 1200 }],
      idempotencyKey: "dup-key",
    });
    expect(out.id).toBe("fr-1");
    expect(registry.get).not.toHaveBeenCalled(); // adapter not invoked on dup
  });

  it("computes VAT breakdown per rate and persists the queued row", async () => {
    prisma.fiscalDeviceRecord.findFirst.mockResolvedValue({
      id: DEVICE_ID,
      tenantId: TENANT,
      providerId: "mock",
      status: "online",
    } as any);
    prisma.fiscalReceipt.findUnique.mockResolvedValue(null);
    let capturedCreate: any = null;
    (prisma.fiscalReceipt.create as any).mockImplementation(
      async ({ data }: any) => {
        capturedCreate = data;
        return { id: "fr-new", ...data };
      },
    );
    (prisma.fiscalReceipt.update as any).mockImplementation(
      async ({ data }: any) => ({
        id: "fr-new",
        tenantId: TENANT,
        status: data.status,
        ...data,
      }),
    );
    const adapter = {
      issueReceipt: jest.fn().mockResolvedValue({
        providerId: "mock",
        receiptId: "fr-new",
        status: "issued",
        fiscalNo: "00000001",
      }),
    };
    registry.get.mockReturnValue(adapter as any);

    const out = await svc.issueReceipt({
      tenantId: TENANT,
      fiscalDeviceId: DEVICE_ID,
      lines: [
        {
          productCode: "A",
          name: "Burger",
          qty: 1,
          unitPriceCents: 12000,
          vatRate: 20,
        }, // 2000 vat
        {
          productCode: "B",
          name: "Bread",
          qty: 2,
          unitPriceCents: 1100,
          vatRate: 10,
        }, // 200 vat
      ],
      payments: [{ method: "card", amountCents: 14200 }],
      idempotencyKey: "k-1",
    });

    expect(adapter.issueReceipt).toHaveBeenCalled();
    expect(capturedCreate.totalCents).toBe(12000 + 2 * 1100);
    expect(capturedCreate.vatBreakdown).toEqual({ "20": 2000, "10": 200 });
    expect(out.status).toBe("issued");
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: "fiscal.receipt.printed.v1" }),
    );
  });

  it("closeDay rejects a retired fiscal device (iter-29)", async () => {
    // A retired yazarkasa has its counters frozen at retirement time; the
    // operator probably wanted to close the day on a DIFFERENT device.
    // Surface a clean 400 instead of letting it fail mid-adapter.
    prisma.fiscalDeviceRecord.findFirst.mockResolvedValue({
      id: DEVICE_ID,
      tenantId: TENANT,
      providerId: "mock",
      status: "retired",
    } as any);

    const scope = {
      tenantId: TENANT,
      branchId: "b-1",
      userId: "u-1",
      role: "ADMIN",
    } as any;
    await expect(svc.closeDay(scope, DEVICE_ID)).rejects.toThrow(/retired/i);
    expect(registry.get).not.toHaveBeenCalled();
  });

  it("FIX 3 — keeps the row queued (not failed) when the adapter returns status=queued", async () => {
    // On-prem GMP-3 ÖKC: the NORMAL case is `queued` — the receipt was enqueued
    // onto the device-mesh and the bridge has not acked yet. It must NOT be
    // mis-recorded as `failed` and must NOT emit fiscal.receipt.failed.v1.
    prisma.fiscalDeviceRecord.findFirst.mockResolvedValue({
      id: DEVICE_ID,
      tenantId: TENANT,
      providerId: "fiscal_hugin",
      status: "online",
    } as any);
    prisma.fiscalReceipt.findUnique.mockResolvedValue(null);
    (prisma.fiscalReceipt.create as any).mockResolvedValue({
      id: "fr-q",
      tenantId: TENANT,
      status: "queued",
    });
    let capturedUpdate: any = null;
    (prisma.fiscalReceipt.update as any).mockImplementation(
      async ({ data }: any) => {
        capturedUpdate = data;
        return { id: "fr-q", tenantId: TENANT, ...data };
      },
    );
    const adapter = {
      issueReceipt: jest.fn().mockResolvedValue({
        providerId: "fiscal_hugin",
        receiptId: "idem-q",
        status: "queued",
      }),
    };
    registry.get.mockReturnValue(adapter as any);

    const out = await svc.issueReceipt({
      tenantId: TENANT,
      fiscalDeviceId: DEVICE_ID,
      lines: [
        {
          productCode: "X",
          name: "X",
          qty: 1,
          unitPriceCents: 1200,
          vatRate: 20,
        },
      ],
      payments: [{ method: "cash", amountCents: 1200 }],
      idempotencyKey: "idem-q",
    });

    expect(out.status).toBe("queued");
    expect(capturedUpdate.status).toBe("queued");
    expect(capturedUpdate.issuedAt).toBeNull();
    expect(capturedUpdate.lastError).toBeNull();
    // No terminal domain event for a still-in-flight receipt.
    expect(outbox.append).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "fiscal.receipt.failed.v1" }),
    );
    expect(outbox.append).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "fiscal.receipt.printed.v1" }),
    );
  });

  it("FIX 1 — closeDay does NOT persist a fiscalDayClose row or emit when the provider throws (un-acked Z)", async () => {
    prisma.fiscalDeviceRecord.findFirst.mockResolvedValue({
      id: DEVICE_ID,
      tenantId: TENANT,
      providerId: "fiscal_hugin",
      status: "online",
      branchId: "b-1",
    } as any);
    const adapter = {
      // GMP-3 closeDay throws a retryable conflict while the ÖKC has not acked.
      closeDay: jest
        .fn()
        .mockRejectedValue(
          new Error(
            "Z report queued on device dev-1; reconcile after the ÖKC acks",
          ),
        ),
    };
    registry.get.mockReturnValue(adapter as any);

    const scope = {
      tenantId: TENANT,
      branchId: "b-1",
      userId: "u-1",
      role: "ADMIN",
    } as any;
    await expect(svc.closeDay(scope, DEVICE_ID)).rejects.toThrow(
      /queued on device/i,
    );

    expect(prisma.fiscalDayClose.create).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "fiscal.day.closed.v1" }),
    );
  });

  it("FIX 1 — closeDay rejects (no persist) when the provider returns a report with an empty zNo", async () => {
    prisma.fiscalDeviceRecord.findFirst.mockResolvedValue({
      id: DEVICE_ID,
      tenantId: TENANT,
      providerId: "fiscal_hugin",
      status: "online",
      branchId: "b-1",
    } as any);
    const adapter = {
      closeDay: jest.fn().mockResolvedValue({
        providerId: "fiscal_hugin",
        fiscalDeviceId: DEVICE_ID,
        zNo: "",
        openedAt: new Date(0).toISOString(),
        closedAt: new Date(1000).toISOString(),
        totals: {},
      }),
    };
    registry.get.mockReturnValue(adapter as any);

    const scope = {
      tenantId: TENANT,
      branchId: "b-1",
      userId: "u-1",
      role: "ADMIN",
    } as any;
    await expect(svc.closeDay(scope, DEVICE_ID)).rejects.toThrow(/Z number/i);
    expect(prisma.fiscalDayClose.create).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "fiscal.day.closed.v1" }),
    );
  });

  it("marks the row failed and emits a failure event when the adapter throws", async () => {
    prisma.fiscalDeviceRecord.findFirst.mockResolvedValue({
      id: DEVICE_ID,
      tenantId: TENANT,
      providerId: "mock",
      status: "online",
    } as any);
    prisma.fiscalReceipt.findUnique.mockResolvedValue(null);
    (prisma.fiscalReceipt.create as any).mockResolvedValue({
      id: "fr-x",
      tenantId: TENANT,
      status: "queued",
    });
    (prisma.fiscalReceipt.update as any).mockImplementation(
      async ({ data }: any) => ({
        id: "fr-x",
        tenantId: TENANT,
        ...data,
      }),
    );
    const adapter = {
      issueReceipt: jest.fn().mockRejectedValue(new Error("serial port busy")),
    };
    registry.get.mockReturnValue(adapter as any);

    const out = await svc.issueReceipt({
      tenantId: TENANT,
      fiscalDeviceId: DEVICE_ID,
      lines: [
        {
          productCode: "X",
          name: "X",
          qty: 1,
          unitPriceCents: 100,
          vatRate: 20,
        },
      ],
      payments: [{ method: "cash", amountCents: 100 }],
      idempotencyKey: "k-2",
    });

    expect(out.status).toBe("failed");
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: "fiscal.receipt.failed.v1" }),
    );
  });
});

/**
 * Track 1 branch-scope hardening. fiscal_receipts now carry a branchId so a
 * multi-branch tenant's receipts isolate per branch. issueReceipt persists the
 * branch the receipt was issued at.
 *
 * Recovery reads (listPending / cancel / retry) use an orphan-inclusive scope:
 * the active branch OR branchId IS NULL. A receipt issued by a device with no
 * branch (fiscal_devices.branchId NULL → receipt branchId NULL) would
 * otherwise be invisible to every per-branch recovery panel and stuck forever.
 * branchId is a globally-unique FK, so including NULL never exposes another
 * branch's owned receipts — only the unowned orphans.
 */
describe("FiscalService branch-scope", () => {
  let prisma: MockPrismaClient;
  let registry: jest.Mocked<FiscalProviderRegistry>;
  let outbox: { append: jest.Mock };
  let svc: FiscalService;

  const scope = {
    tenantId: "t-1",
    branchId: "b-1",
    userId: "u-1",
    role: "ADMIN",
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue("outbox") };
    registry = { get: jest.fn() } as any;
    svc = new FiscalService(prisma as any, registry as any, outbox as any);
  });

  it("listPending scopes to the branch and includes branchless orphan receipts", async () => {
    (prisma.fiscalReceipt.findMany as any).mockResolvedValue([]);
    await svc.listPending(scope);
    const where = (prisma.fiscalReceipt.findMany as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe("t-1");
    expect(where.branchId).toBeUndefined(); // moved into the OR
    expect(where.OR).toEqual(
      expect.arrayContaining([{ branchId: "b-1" }, { branchId: null }]),
    );
    expect(where.status).toEqual({ in: ["queued", "failed"] });
  });

  it("issueReceipt persists branchId from the request", async () => {
    prisma.fiscalDeviceRecord.findFirst.mockResolvedValue({
      id: "d-1",
      tenantId: "t-1",
      branchId: "b-1",
      providerId: "mock",
      status: "online",
    } as any);
    prisma.fiscalReceipt.findUnique.mockResolvedValue(null);
    (prisma.fiscalReceipt.create as any).mockImplementation(
      async ({ data }: any) => ({
        id: "fr-new",
        ...data,
      }),
    );
    (prisma.fiscalReceipt.update as any).mockImplementation(
      async ({ data }: any) => ({
        id: "fr-new",
        tenantId: "t-1",
        status: data.status,
        ...data,
      }),
    );
    const adapter = {
      issueReceipt: jest.fn().mockResolvedValue({
        providerId: "mock",
        receiptId: "fr-new",
        status: "issued",
        fiscalNo: "00000001",
      }),
    };
    registry.get.mockReturnValue(adapter as any);

    await svc.issueReceipt({
      tenantId: "t-1",
      branchId: "b-1",
      fiscalDeviceId: "d-1",
      lines: [
        {
          productCode: "X",
          name: "X",
          qty: 1,
          unitPriceCents: 1200,
          vatRate: 20,
        },
      ],
      payments: [{ method: "cash", amountCents: 1200 }],
      idempotencyKey: "k-branch",
    } as any);

    const data = (prisma.fiscalReceipt.create as any).mock.calls[0][0].data;
    expect(data.branchId).toBe("b-1");
  });

  it("issueReceipt falls back to the device branch when the request omits one", async () => {
    prisma.fiscalDeviceRecord.findFirst.mockResolvedValue({
      id: "d-1",
      tenantId: "t-1",
      branchId: "b-dev",
      providerId: "mock",
      status: "online",
    } as any);
    prisma.fiscalReceipt.findUnique.mockResolvedValue(null);
    (prisma.fiscalReceipt.create as any).mockImplementation(
      async ({ data }: any) => ({
        id: "fr-new",
        ...data,
      }),
    );
    (prisma.fiscalReceipt.update as any).mockImplementation(
      async ({ data }: any) => ({
        id: "fr-new",
        tenantId: "t-1",
        status: data.status,
        ...data,
      }),
    );
    const adapter = {
      issueReceipt: jest.fn().mockResolvedValue({
        providerId: "mock",
        receiptId: "fr-new",
        status: "issued",
        fiscalNo: "00000002",
      }),
    };
    registry.get.mockReturnValue(adapter as any);

    await svc.issueReceipt({
      tenantId: "t-1",
      fiscalDeviceId: "d-1",
      lines: [
        {
          productCode: "X",
          name: "X",
          qty: 1,
          unitPriceCents: 1200,
          vatRate: 20,
        },
      ],
      payments: [{ method: "cash", amountCents: 1200 }],
      idempotencyKey: "k-nobranch",
    } as any);

    const data = (prisma.fiscalReceipt.create as any).mock.calls[0][0].data;
    expect(data.branchId).toBe("b-dev");
  });

  it("cancelReceipt looks up the row by branch scope", async () => {
    prisma.fiscalReceipt.findFirst.mockResolvedValue({
      id: "fr-1",
      tenantId: "t-1",
      branchId: "b-1",
      providerId: "mock",
      status: "issued",
    } as any);
    (prisma.fiscalReceipt.update as any).mockResolvedValue({
      id: "fr-1",
      status: "cancelled",
    });
    const adapter = { cancelReceipt: jest.fn().mockResolvedValue(undefined) };
    registry.get.mockReturnValue(adapter as any);

    await svc.cancelReceipt(scope, "fr-1", "duplicate");
    const where = (prisma.fiscalReceipt.findFirst as any).mock.calls[0][0]
      .where;
    expect(where.id).toBe("fr-1");
    expect(where.tenantId).toBe("t-1");
    expect(where.branchId).toBeUndefined(); // moved into the OR
    expect(where.OR).toEqual(
      expect.arrayContaining([{ branchId: "b-1" }, { branchId: null }]),
    );
  });

  it("retryFailed looks up the row by branch scope", async () => {
    prisma.fiscalReceipt.findFirst.mockResolvedValue({
      id: "fr-1",
      tenantId: "t-1",
      branchId: "b-1",
      providerId: "mock",
      status: "failed",
      fiscalDeviceId: "d-1",
      orderId: null,
      idempotencyKey: "k",
      totalCents: 100,
      lines: [],
      updatedAt: new Date(0),
    } as any);
    (prisma.fiscalReceipt.update as any).mockImplementation(
      async ({ data }: any) => ({
        id: "fr-1",
        tenantId: "t-1",
        ...data,
      }),
    );
    const adapter = {
      issueReceipt: jest.fn().mockResolvedValue({
        providerId: "mock",
        receiptId: "fr-1",
        status: "issued",
        fiscalNo: "00000003",
      }),
    };
    registry.get.mockReturnValue(adapter as any);

    await svc.retryFailed(scope, "fr-1");
    const where = (prisma.fiscalReceipt.findFirst as any).mock.calls[0][0]
      .where;
    expect(where.id).toBe("fr-1");
    expect(where.tenantId).toBe("t-1");
    expect(where.branchId).toBeUndefined(); // moved into the OR
    expect(where.OR).toEqual(
      expect.arrayContaining([{ branchId: "b-1" }, { branchId: null }]),
    );
  });

  it("closeDay scopes the device lookup by branchId + tenantId", async () => {
    // closeDay runs a Z report for ONE device, which lives in one branch.
    // The device lookup must be branch-scoped so a branch-A operator can't
    // close the day on a branch-B device by id (cross-branch IDOR).
    prisma.fiscalDeviceRecord.findFirst.mockResolvedValue({
      id: "d-1",
      tenantId: "t-1",
      branchId: "b-1",
      providerId: "mock",
      status: "online",
    } as any);
    (prisma.fiscalDayClose.create as any).mockResolvedValue({ id: "dc-1" });
    const adapter = {
      closeDay: jest.fn().mockResolvedValue({
        zNo: "Z-1",
        openedAt: new Date(0).toISOString(),
        closedAt: new Date(1000).toISOString(),
        totals: { cash: 100 },
      }),
    };
    registry.get.mockReturnValue(adapter as any);

    await svc.closeDay(scope, "d-1");

    const where = (prisma.fiscalDeviceRecord.findFirst as any).mock.calls[0][0]
      .where;
    expect(where.id).toBe("d-1");
    expect(where.tenantId).toBe("t-1");
    expect(where.branchId).toBe("b-1");
  });
});
