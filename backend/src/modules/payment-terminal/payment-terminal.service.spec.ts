import { BadRequestException, ConflictException } from "@nestjs/common";
import { PaymentTerminalService } from "./payment-terminal.service";
import { PaymentTerminalProviderRegistry } from "./payment-terminal-provider.registry";
import { SimulatorTerminalProvider } from "./providers/simulator-terminal.provider";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/**
 * Money-safety specs for the integrated card terminal. Core invariants:
 *  - Payment is recorded ONLY on an APPROVED charge (decline/error ⇒ no Payment).
 *  - START is idempotent (no second charge on a double-click).
 *  - applyResult records at most once (poll race / recovery can't double-book).
 * Uses the in-process simulator so no device/bridge is needed.
 */
describe("PaymentTerminalService (simulator money-safety)", () => {
  let prisma: MockPrismaClient;
  let payments: { create: jest.Mock };
  let commandQueue: { enqueue: jest.Mock };
  let svc: PaymentTerminalService;

  const scope = { tenantId: "t1", branchId: "b1" };
  const simTerminal = {
    id: "term-1",
    tenantId: "t1",
    branchId: "b1",
    providerId: "simulator",
    deviceId: null,
    serial: "SIM-1",
    activationState: "SIMULATOR",
    status: "online",
    config: {},
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    // PaymentsService.create resolves the raw Payment row (id at top level),
    // same shape as production — applyResult reads `.payment?.id ?? .id`.
    payments = { create: jest.fn().mockResolvedValue({ id: "pay-1" }) };
    commandQueue = { enqueue: jest.fn() };
    const registry = new PaymentTerminalProviderRegistry();
    registry.register(new SimulatorTerminalProvider());
    svc = new PaymentTerminalService(
      prisma as any,
      commandQueue as any,
      registry,
      payments as any,
    );

    (prisma.paymentTerminalRecord.findFirst as any).mockResolvedValue(simTerminal);
    (prisma.order.findFirst as any).mockResolvedValue({ id: "o1", status: "SERVED", finalAmount: 100 });
    (prisma.paymentTerminalCharge.findFirst as any).mockResolvedValue(null); // no existing charge
    let chargeRow: any = null;
    (prisma.paymentTerminalCharge.create as any).mockImplementation(async ({ data }: any) => {
      chargeRow = { id: "chg-1", ...data };
      return chargeRow;
    });
    (prisma.paymentTerminalCharge.update as any).mockImplementation(async ({ data }: any) => {
      chargeRow = { ...chargeRow, ...data };
      return chargeRow;
    });
    // applyResult's final RECORD write is a guarded updateMany (so a concurrent
    // void can't be clobbered), followed by a re-read. Honour the status guard
    // so the void-race behaviour is exercised: only mutate while the charge is
    // still recordable (not VOIDED/RECORDED, no paymentId yet).
    (prisma.paymentTerminalCharge.updateMany as any).mockImplementation(async ({ where, data }: any) => {
      if (!chargeRow || (where?.id && chargeRow.id !== where.id)) {
        return { count: 0 };
      }
      if (where?.status?.notIn?.includes(chargeRow.status)) return { count: 0 };
      if (where?.status?.in && !where.status.in.includes(chargeRow.status)) {
        return { count: 0 };
      }
      if (where?.paymentId === null && chargeRow.paymentId != null) {
        return { count: 0 };
      }
      chargeRow = { ...chargeRow, ...data };
      return { count: 1 };
    });
    // applyResult re-reads the charge by id
    (prisma.paymentTerminalCharge.findFirst as any).mockImplementation(async ({ where }: any) => {
      if (where?.idempotencyKey) return null; // idempotent-start lookup: none yet
      return chargeRow;
    });
  });

  it("APPROVED simulator charge records exactly one Payment and flips to RECORDED", async () => {
    const res = await svc.charge(scope as any, "o1", { amount: 100 }, "u1");
    expect(payments.create).toHaveBeenCalledTimes(1);
    const [orderId, dto, tenantId] = payments.create.mock.calls[0];
    expect(orderId).toBe("o1");
    expect(dto).toMatchObject({ amount: 100, method: "CARD" });
    expect(dto.transactionId).toMatch(/^SIM-/); // approval ref threaded to Payment
    expect(tenantId).toBe("t1");
    expect(res.status).toBe("RECORDED");
    expect(res.paymentId).toBe("pay-1");
  });

  it("DECLINED charge records NO Payment and leaves the order open", async () => {
    (prisma.paymentTerminalRecord.findFirst as any).mockResolvedValue({
      ...simTerminal,
      config: { outcome: "DECLINE" },
    });
    const res = await svc.charge(scope as any, "o1", { amount: 100 }, "u1");
    expect(payments.create).not.toHaveBeenCalled();
    expect(res.status).toBe("DECLINED");
    expect(res.paymentId).toBeNull();
  });

  it("rejects when no active terminal is configured (caller falls back to manual card)", async () => {
    (prisma.paymentTerminalRecord.findFirst as any).mockResolvedValue(null);
    await expect(svc.charge(scope as any, "o1", { amount: 100 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("refuses to charge a PAID/CANCELLED order", async () => {
    (prisma.order.findFirst as any).mockResolvedValue({ id: "o1", status: "PAID", finalAmount: 100 });
    await expect(svc.charge(scope as any, "o1", { amount: 100 })).rejects.toThrow(
      ConflictException,
    );
  });

  it("idempotent START: an existing charge for the key returns it without a second charge", async () => {
    (prisma.paymentTerminalCharge.findFirst as any).mockImplementation(async ({ where }: any) => {
      if (where?.idempotencyKey === "dup") {
        return { id: "chg-existing", status: "RECORDED", paymentId: "pay-1", amountCents: 10000, orderId: "o1" };
      }
      return null;
    });
    const res = await svc.charge(scope as any, "o1", { amount: 100, idempotencyKey: "dup" }, "u1");
    expect(res.chargeId).toBe("chg-existing");
    expect(prisma.paymentTerminalCharge.create).not.toHaveBeenCalled();
    expect(payments.create).not.toHaveBeenCalled();
  });

  // Single-live-charge guard: a Retry arrives with a FRESH idempotency key, so
  // the key dedupe can't stop it — the order-level guard must, or the card can
  // be charged twice for one order (second APPROVED parks as
  // APPROVED-unrecorded needing a manual void).
  describe("single-live-charge guard (409 while a live charge exists)", () => {
    const liveGuardFindFirst =
      (liveRow: any) =>
      async ({ where }: any) => {
        if (where?.idempotencyKey) return null; // key dedupe: no match
        if (where?.status?.in) return liveRow; // order-level live-charge probe
        return null;
      };

    it("rejects START with 409 while a PENDING charge exists for the order", async () => {
      (prisma.paymentTerminalCharge.findFirst as any).mockImplementation(
        liveGuardFindFirst({ id: "chg-live", status: "PENDING" }),
      );
      await expect(
        svc.charge(scope as any, "o1", { amount: 100 }, "u1"),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.paymentTerminalCharge.create).not.toHaveBeenCalled();
      expect(payments.create).not.toHaveBeenCalled();
    });

    it("rejects START with 409 while an APPROVED-unrecorded charge awaits reconciliation", async () => {
      (prisma.paymentTerminalCharge.findFirst as any).mockImplementation(
        liveGuardFindFirst({ id: "chg-live", status: "APPROVED" }),
      );
      await expect(
        svc.charge(scope as any, "o1", { amount: 100 }, "u1"),
      ).rejects.toThrow(/reconciliation/);
      expect(prisma.paymentTerminalCharge.create).not.toHaveBeenCalled();
    });

    it("probes only LIVE statuses (terminal states must not block a new charge)", async () => {
      // Wrap the beforeEach implementation: intercept the live-charge probe to
      // capture WHICH statuses it blocks on, delegate everything else so the
      // charge lifecycle (create → applyResult → RECORDED) runs unchanged.
      let probedStatuses: string[] | null = null;
      const prevImpl = (
        prisma.paymentTerminalCharge.findFirst as any
      ).getMockImplementation();
      (prisma.paymentTerminalCharge.findFirst as any).mockImplementation(
        async (args: any) => {
          if (args?.where?.status?.in) {
            probedStatuses = args.where.status.in;
            return null; // no live charge → START proceeds
          }
          return prevImpl(args);
        },
      );
      const res = await svc.charge(scope as any, "o1", { amount: 100 }, "u1");
      expect(res.status).toBe("RECORDED"); // happy path unaffected by the guard
      expect(probedStatuses).toEqual(["PENDING", "APPROVED", "NEEDS_REVIEW"]);
    });
  });
});
