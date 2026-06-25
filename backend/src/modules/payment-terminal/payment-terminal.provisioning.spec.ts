import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PaymentTerminalService } from "./payment-terminal.service";
import { PaymentTerminalProviderRegistry } from "./payment-terminal-provider.registry";
import { SimulatorTerminalProvider } from "./providers/simulator-terminal.provider";
import { Gmp3CardTerminalProvider } from "./providers/gmp3-card-terminal.provider";
import { SoftPosTerminalProvider } from "./providers/softpos-terminal.provider";
import { mockPrismaClient, MockPrismaClient } from "../../common/test/prisma-mock.service";

/**
 * Provisioning + the fail-closed activation gate — the boundary between a
 * "configured" terminal and one that charges real cards.
 */
describe("PaymentTerminalService (provisioning + activation gate)", () => {
  let prisma: MockPrismaClient;
  let svc: PaymentTerminalService;
  let commandQueue: { enqueue: jest.Mock };
  let payments: { create: jest.Mock };
  const scope = { tenantId: "t1", branchId: "b1" };

  beforeEach(() => {
    prisma = mockPrismaClient();
    const registry = new PaymentTerminalProviderRegistry();
    registry.register(new SimulatorTerminalProvider());
    registry.register(new Gmp3CardTerminalProvider(registry));
    registry.register(new SoftPosTerminalProvider(registry));
    commandQueue = { enqueue: jest.fn() };
    payments = { create: jest.fn() };
    svc = new PaymentTerminalService(
      prisma as any,
      commandQueue as any,
      registry,
      payments as any,
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

    it("refuses ACTIVE on a non-activatable provider (SoftPOS — integration not wired)", async () => {
      found({ providerId: "softpos", deviceId: null });
      await expect(svc.setActivation(scope as any, "term-x", "ACTIVE")).rejects.toThrow(
        /not available yet/i,
      );
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

  describe("voidCharge (money-safe pre-settlement reversal)", () => {
    // The guarded flip is an updateMany (status∈{APPROVED,NEEDS_REVIEW},
    // paymentId:null) → count 1 = we won the flip, 0 = a concurrent
    // poll/recovery recorded it first.
    const wins = () =>
      (prisma.paymentTerminalCharge.updateMany as any).mockResolvedValue({ count: 1 });

    it("REFUSES voiding a RECORDED charge (reverse via the order refund flow)", async () => {
      (prisma.paymentTerminalCharge.findFirst as any).mockResolvedValue({
        id: "chg-1",
        status: "RECORDED",
        paymentId: "pay-1",
        providerId: "simulator",
      });
      await expect(svc.voidCharge(scope as any, "chg-1")).rejects.toThrow(ConflictException);
      expect(prisma.paymentTerminalCharge.updateMany).not.toHaveBeenCalled();
    });

    it("voids an APPROVED-but-unrecorded simulator charge (no device command)", async () => {
      (prisma.paymentTerminalCharge.findFirst as any)
        .mockResolvedValueOnce({
          id: "chg-1",
          status: "APPROVED",
          paymentId: null,
          providerId: "simulator",
          terminalRecordId: "term-1",
          idempotencyKey: "k1",
        })
        .mockResolvedValueOnce({ id: "chg-1", status: "VOIDED", amountCents: 1000, orderId: "o1" });
      wins();
      const view = await svc.voidCharge(scope as any, "chg-1");
      expect(view.status).toBe("VOIDED");
      expect(commandQueue.enqueue).not.toHaveBeenCalled();
    });

    it("REFUSES with Conflict when a concurrent record wins the race (V1 guard)", async () => {
      (prisma.paymentTerminalCharge.findFirst as any)
        .mockResolvedValueOnce({
          id: "chg-1",
          status: "APPROVED",
          paymentId: null,
          providerId: "simulator",
          terminalRecordId: "term-1",
          idempotencyKey: "k1",
        })
        // After the guarded flip lost (count 0), the re-read shows it RECORDED.
        .mockResolvedValueOnce({ id: "chg-1", status: "RECORDED", paymentId: "pay-1" });
      (prisma.paymentTerminalCharge.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(svc.voidCharge(scope as any, "chg-1")).rejects.toThrow(ConflictException);
      // Never enqueued a device void for a now-recorded charge.
      expect(commandQueue.enqueue).not.toHaveBeenCalled();
    });

    it("enqueues a void_card ONLY after winning the flip, for a bridge terminal with a device", async () => {
      (prisma.paymentTerminalCharge.findFirst as any)
        .mockResolvedValueOnce({
          id: "chg-1",
          status: "APPROVED",
          paymentId: null,
          providerId: "gmp3_card",
          terminalRecordId: "term-1",
          deviceCommandId: "cmd-1",
          approvalCode: "A1",
          idempotencyKey: "k1",
        })
        .mockResolvedValueOnce({ id: "chg-1", status: "VOIDED", amountCents: 1000, orderId: "o1" });
      wins();
      (prisma.paymentTerminalRecord.findFirst as any).mockResolvedValue({ deviceId: "dev-1" });
      commandQueue.enqueue.mockResolvedValue({ id: "vcmd-1" });
      const view = await svc.voidCharge(scope as any, "chg-1");
      expect(commandQueue.enqueue).toHaveBeenCalledWith(
        "t1",
        "dev-1",
        expect.objectContaining({ kind: "void_card", idempotencyKey: "void:k1" }),
        "b1",
      );
      expect(view.status).toBe("VOIDED");
    });

    it("no-ops a DECLINED charge", async () => {
      (prisma.paymentTerminalCharge.findFirst as any).mockResolvedValue({
        id: "chg-1",
        status: "DECLINED",
        paymentId: null,
        providerId: "simulator",
      });
      const view = await svc.voidCharge(scope as any, "chg-1");
      expect(view.status).toBe("DECLINED");
      expect(prisma.paymentTerminalCharge.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("recoverApprovedUnrecorded (bounded reconciliation)", () => {
    it("parks a charge in NEEDS_REVIEW once the recovery cap is hit", async () => {
      // One stuck charge that's already been retried 4 times.
      (prisma.paymentTerminalCharge.findMany as any).mockResolvedValue([
        {
          id: "chg-stuck",
          tenantId: "t1",
          providerId: "simulator",
          status: "APPROVED",
          paymentId: null,
          recoveryAttempts: 4,
          amountCents: 1000,
          orderId: "o1",
          idempotencyKey: "k1",
        },
      ]);
      // applyResult re-reads the charge (still APPROVED, unrecorded)…
      (prisma.paymentTerminalCharge.findFirst as any).mockResolvedValue({
        id: "chg-stuck",
        status: "APPROVED",
        paymentId: null,
        amountCents: 1000,
        orderId: "o1",
        idempotencyKey: "k1",
      });
      // …and recording still fails (order settled by another tender).
      payments.create.mockRejectedValue(new Error("Order is already paid"));
      // applyResult's record-failure path updates the charge…
      (prisma.paymentTerminalCharge.update as any).mockResolvedValue({
        id: "chg-stuck",
        status: "APPROVED",
        amountCents: 1000,
        orderId: "o1",
        paymentId: null,
      });
      // …then the cron's guarded park is an updateMany (status APPROVED + null).
      (prisma.paymentTerminalCharge.updateMany as any).mockResolvedValue({ count: 1 });

      await svc.recoverApprovedUnrecorded();

      // The 5th failed attempt parks it for operator review (guarded updateMany).
      expect(prisma.paymentTerminalCharge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "chg-stuck", status: "APPROVED", paymentId: null }),
          data: expect.objectContaining({ recoveryAttempts: 5, status: "NEEDS_REVIEW" }),
        }),
      );
    });
  });
});
