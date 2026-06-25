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
    payments = { create: jest.fn().mockResolvedValue({ payment: { id: "pay-1" } }) };
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
});
