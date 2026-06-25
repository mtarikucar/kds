import { BankEcrTerminalProvider } from "./bank-ecr-terminal.provider";
import { PaymentTerminalProviderRegistry } from "../payment-terminal-provider.registry";
import { TerminalChargeRequest } from "../payment-terminal-provider.interface";

describe("BankEcrTerminalProvider", () => {
  let provider: BankEcrTerminalProvider;

  const req: TerminalChargeRequest = {
    tenantId: "t1",
    branchId: "b1",
    orderId: "o1",
    amountCents: 5000,
    terminal: { id: "term-1", providerId: "bank_ecr", deviceId: "dev-1", serial: "ECR-7", config: null },
    idempotencyKey: "idem-1",
  };

  beforeEach(() => {
    provider = new BankEcrTerminalProvider(new PaymentTerminalProviderRegistry());
  });

  it("is a charge-only bridge provider (NOT fiscal_coupled)", () => {
    expect(provider.kind).toBe("bridge");
    expect(provider.capabilities).toContain("sale");
    expect(provider.capabilities).not.toContain("fiscal_coupled");
  });

  it("buildSaleCommand enqueues a charge_card with NO fiscal context", () => {
    const cmd = provider.buildSaleCommand(req);
    expect(cmd.kind).toBe("charge_card");
    expect((cmd.payload as any).protocol).toBe("ECR");
    expect((cmd.payload as any).amountCents).toBe(5000);
    expect((cmd.payload as any).fiscal).toBeUndefined();
  });

  it("approves only on explicit approved===true", () => {
    expect(
      provider.mapAck({ status: "done", result: { approved: true, approvalCode: "A1" }, error: null }).status,
    ).toBe("APPROVED");
    expect(provider.mapAck({ status: "done", result: { approved: false }, error: null }).status).toBe(
      "DECLINED",
    );
    expect(provider.mapAck({ status: "done", result: {}, error: null }).status).toBe("ERROR");
    expect(provider.mapAck({ status: "expired", result: null, error: null }).status).toBe("TIMEOUT");
  });
});
