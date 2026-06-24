import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { FiscalService } from "./fiscal.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { FiscalProviderRegistry } from "./fiscal-provider.registry";

/**
 * Device-registration (create-site) tests. This is the surface that was
 * missing — without it the payment-finalizer's yazarkasa path is permanently
 * dormant. The tests pin the honesty guards: only a `receipt`-capable physical
 * provider registers (efatura is rejected), a linked bridge must be real, and
 * a duplicate serial is a conflict not a 500.
 */
describe("FiscalService device registration", () => {
  let prisma: MockPrismaClient;
  let registry: jest.Mocked<FiscalProviderRegistry>;
  let outbox: { append: jest.Mock };
  let svc: FiscalService;

  const SCOPE = { tenantId: "t1", branchId: "br-1" } as any;

  const huginProvider = {
    id: "fiscal_hugin",
    capabilities: ["receipt", "z_report", "cancel"],
  };
  const efaturaProvider = { id: "efatura", capabilities: ["invoice"] };

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue("outbox") };
    registry = { get: jest.fn() } as any;
    svc = new FiscalService(prisma as any, registry as any, outbox as any);
  });

  it("rejects a provider without the `receipt` capability (efatura is not a physical device)", async () => {
    registry.get.mockReturnValue(efaturaProvider as any);
    await expect(
      svc.registerDevice(SCOPE, { providerId: "efatura", serial: "X1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.fiscalDeviceRecord.create).not.toHaveBeenCalled();
  });

  it("propagates NotFound for an unknown providerId (registry throws)", async () => {
    registry.get.mockImplementation(() => {
      throw new NotFoundException("Unknown fiscal provider: nope");
    });
    await expect(
      svc.registerDevice(SCOPE, { providerId: "nope", serial: "X1" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("creates an offline device with the provider's capabilities, scoped to the branch", async () => {
    registry.get.mockReturnValue(huginProvider as any);
    let captured: any = null;
    (prisma.fiscalDeviceRecord.create as any).mockImplementation(
      async ({ data }: any) => {
        captured = data;
        return { id: "fd-new", ...data };
      },
    );

    const out = await svc.registerDevice(SCOPE, {
      providerId: "fiscal_hugin",
      serial: "HUG-123",
      model: "Hugin T300",
    });

    expect(out.id).toBeTruthy();
    expect(captured).toMatchObject({
      tenantId: "t1",
      branchId: "br-1",
      providerId: "fiscal_hugin",
      serial: "HUG-123",
      model: "Hugin T300",
      capabilities: ["receipt", "z_report", "cancel"],
      status: "offline",
      deviceId: null,
    });
  });

  it("rejects a linked deviceId that does not exist in the tenant", async () => {
    registry.get.mockReturnValue(huginProvider as any);
    (prisma.device.findFirst as any).mockResolvedValue(null);

    await expect(
      svc.registerDevice(SCOPE, {
        providerId: "fiscal_hugin",
        serial: "HUG-1",
        deviceId: "dev-x",
      }),
    ).rejects.toThrow(/Linked device not found/);
    expect(prisma.fiscalDeviceRecord.create).not.toHaveBeenCalled();
  });

  it("rejects a linked device of a non-bridge kind", async () => {
    registry.get.mockReturnValue(huginProvider as any);
    (prisma.device.findFirst as any).mockResolvedValue({
      id: "dev-x",
      kind: "scanner",
      branchId: "br-1",
    });

    await expect(
      svc.registerDevice(SCOPE, {
        providerId: "fiscal_hugin",
        serial: "HUG-1",
        deviceId: "dev-x",
      }),
    ).rejects.toThrow(/not a bridge\/yazarkasa/);
  });

  it("accepts a valid local_bridge link and stores it", async () => {
    registry.get.mockReturnValue(huginProvider as any);
    (prisma.device.findFirst as any).mockResolvedValue({
      id: "dev-bridge",
      kind: "local_bridge",
      branchId: "br-1",
    });
    let captured: any = null;
    (prisma.fiscalDeviceRecord.create as any).mockImplementation(
      async ({ data }: any) => {
        captured = data;
        return { id: "fd-new", ...data };
      },
    );

    await svc.registerDevice(SCOPE, {
      providerId: "fiscal_hugin",
      serial: "HUG-1",
      deviceId: "dev-bridge",
    });
    expect(captured.deviceId).toBe("dev-bridge");
  });

  it("maps a unique-constraint violation (P2002) to a 409 Conflict", async () => {
    registry.get.mockReturnValue(huginProvider as any);
    (prisma.fiscalDeviceRecord.create as any).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    await expect(
      svc.registerDevice(SCOPE, { providerId: "fiscal_hugin", serial: "DUP" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("retireDevice flips status to retired and is idempotent", async () => {
    (prisma.fiscalDeviceRecord.findFirst as any).mockResolvedValueOnce({
      id: "fd-1",
      tenantId: "t1",
      status: "online",
    });
    (prisma.fiscalDeviceRecord.update as any).mockResolvedValue({
      id: "fd-1",
      status: "retired",
    });
    const out = await svc.retireDevice(SCOPE, "fd-1");
    expect(out.status).toBe("retired");

    // Already retired → no second update.
    (prisma.fiscalDeviceRecord.findFirst as any).mockResolvedValueOnce({
      id: "fd-1",
      tenantId: "t1",
      status: "retired",
    });
    (prisma.fiscalDeviceRecord.update as any).mockClear();
    const out2 = await svc.retireDevice(SCOPE, "fd-1");
    expect(out2.status).toBe("retired");
    expect(prisma.fiscalDeviceRecord.update).not.toHaveBeenCalled();
  });

  it("retireDevice 404s an unknown device", async () => {
    (prisma.fiscalDeviceRecord.findFirst as any).mockResolvedValue(null);
    await expect(svc.retireDevice(SCOPE, "nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
