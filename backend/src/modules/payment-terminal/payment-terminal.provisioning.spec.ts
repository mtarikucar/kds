import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PaymentTerminalService } from "./payment-terminal.service";
import { PaymentTerminalProviderRegistry } from "./payment-terminal-provider.registry";
import { SimulatorTerminalProvider } from "./providers/simulator-terminal.provider";
import { Gmp3CardTerminalProvider } from "./providers/gmp3-card-terminal.provider";
import { mockPrismaClient, MockPrismaClient } from "../../common/test/prisma-mock.service";

/**
 * Provisioning + the fail-closed activation gate — the boundary between a
 * "configured" terminal and one that charges real cards.
 */
describe("PaymentTerminalService (provisioning + activation gate)", () => {
  let prisma: MockPrismaClient;
  let svc: PaymentTerminalService;
  const scope = { tenantId: "t1", branchId: "b1" };

  beforeEach(() => {
    prisma = mockPrismaClient();
    const registry = new PaymentTerminalProviderRegistry();
    registry.register(new SimulatorTerminalProvider());
    registry.register(new Gmp3CardTerminalProvider(registry));
    svc = new PaymentTerminalService(
      prisma as any,
      { enqueue: jest.fn() } as any,
      registry,
      { create: jest.fn() } as any,
    );
    (prisma.paymentTerminalRecord.create as any).mockImplementation(async ({ data }: any) => ({
      id: "term-new",
      capabilities: data.capabilities ?? [],
      lastSeenAt: null,
      model: null,
      ...data,
    }));
    (prisma.paymentTerminalRecord.update as any).mockImplementation(async ({ data }: any) => ({
      id: "term-x",
      providerId: "gmp3_card",
      capabilities: [],
      serial: "S",
      model: null,
      branchId: "b1",
      deviceId: "dev-1",
      status: "offline",
      activationState: "CONFIGURED_NOT_ACTIVE",
      lastSeenAt: null,
      ...data,
    }));
  });

  describe("registerTerminal", () => {
    it("rejects an unknown provider", async () => {
      await expect(svc.registerTerminal(scope as any, { providerId: "nope", serial: "S" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects a bridge provider with no paired device", async () => {
      await expect(
        svc.registerTerminal(scope as any, { providerId: "gmp3_card", serial: "OKC-1" }),
      ).rejects.toThrow(/pair one/i);
    });

    it("registers a bridge terminal with a valid device as CONFIGURED_NOT_ACTIVE (fail-closed)", async () => {
      (prisma.device.findFirst as any).mockResolvedValue({ id: "dev-1", kind: "yazarkasa" });
      const view = await svc.registerTerminal(scope as any, {
        providerId: "gmp3_card",
        serial: "OKC-1",
        deviceId: "dev-1",
      });
      expect(view.activationState).toBe("CONFIGURED_NOT_ACTIVE");
      expect(view.fiscalCoupled).toBe(true);
    });

    it("rejects a device whose kind cannot drive a terminal", async () => {
      (prisma.device.findFirst as any).mockResolvedValue({ id: "dev-9", kind: "kds_screen" });
      await expect(
        svc.registerTerminal(scope as any, { providerId: "gmp3_card", serial: "OKC-1", deviceId: "dev-9" }),
      ).rejects.toThrow(/cannot drive/i);
    });

    it("registers an in-process simulator without a device", async () => {
      const view = await svc.registerTerminal(scope as any, { providerId: "simulator", serial: "SIM-1" });
      expect(view.providerId).toBe("simulator");
      expect(view.activationState).toBe("CONFIGURED_NOT_ACTIVE");
    });

    it("maps a unique-collision to Conflict", async () => {
      (prisma.device.findFirst as any).mockResolvedValue({ id: "dev-1", kind: "yazarkasa" });
      (prisma.paymentTerminalRecord.create as any).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }),
      );
      await expect(
        svc.registerTerminal(scope as any, { providerId: "gmp3_card", serial: "OKC-1", deviceId: "dev-1" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("setActivation (the gate)", () => {
    const found = (over: any = {}) =>
      (prisma.paymentTerminalRecord.findFirst as any).mockResolvedValue({
        id: "term-x",
        providerId: "gmp3_card",
        deviceId: "dev-1",
        branchId: "b1",
        ...over,
      });

    it("404s an unknown terminal", async () => {
      (prisma.paymentTerminalRecord.findFirst as any).mockResolvedValue(null);
      await expect(svc.setActivation(scope as any, "missing", "ACTIVE")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("refuses SIMULATOR on a non-simulator provider", async () => {
      found();
      await expect(svc.setActivation(scope as any, "term-x", "SIMULATOR")).rejects.toThrow(
        /only valid for the simulator/i,
      );
    });

    it("refuses ACTIVE on the simulator (must use SIMULATOR)", async () => {
      found({ providerId: "simulator", deviceId: null });
      await expect(svc.setActivation(scope as any, "term-x", "ACTIVE")).rejects.toThrow(/never be ACTIVE/i);
    });

    it("refuses ACTIVE on a bridge provider with no device", async () => {
      found({ deviceId: null });
      await expect(svc.setActivation(scope as any, "term-x", "ACTIVE")).rejects.toThrow(/Pair a device/i);
    });

    it("refuses ACTIVE when the provider is not registered", async () => {
      found({ providerId: "ghost_provider", deviceId: "dev-1" });
      await expect(svc.setActivation(scope as any, "term-x", "ACTIVE")).rejects.toThrow(
        /not registered/i,
      );
    });

    it("allows ACTIVE on a bridge provider with a paired device", async () => {
      found();
      const view = await svc.setActivation(scope as any, "term-x", "ACTIVE");
      expect(view.activationState).toBe("ACTIVE");
    });

    it("allows SIMULATOR on the simulator provider", async () => {
      found({ providerId: "simulator", deviceId: null });
      const view = await svc.setActivation(scope as any, "term-x", "SIMULATOR");
      expect(view.activationState).toBe("SIMULATOR");
    });
  });

  describe("removeTerminal", () => {
    it("404s an unknown terminal", async () => {
      (prisma.paymentTerminalRecord.findFirst as any).mockResolvedValue(null);
      await expect(svc.removeTerminal(scope as any, "missing")).rejects.toThrow(NotFoundException);
    });

    it("soft-retires", async () => {
      (prisma.paymentTerminalRecord.findFirst as any).mockResolvedValue({ id: "term-x" });
      const res = await svc.removeTerminal(scope as any, "term-x");
      expect(res).toEqual({ id: "term-x", retired: true });
      expect(prisma.paymentTerminalRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "retired", activationState: "DISABLED" } }),
      );
    });
  });

  it("listProviders exposes the registered providers", () => {
    const ids = svc.listProviders().map((p) => p.id);
    expect(ids).toContain("simulator");
    expect(ids).toContain("gmp3_card");
  });
});
