import { Gmp3CardTerminalProvider } from "./gmp3-card-terminal.provider";
import { PaymentTerminalProviderRegistry } from "../payment-terminal-provider.registry";
import { TerminalChargeRequest } from "../payment-terminal-provider.interface";

describe("Gmp3CardTerminalProvider", () => {
  let provider: Gmp3CardTerminalProvider;

  const baseReq: TerminalChargeRequest = {
    tenantId: "t1",
    branchId: "b1",
    orderId: "o1",
    amountCents: 12345,
    terminal: {
      id: "term-1",
      providerId: "gmp3_card",
      deviceId: "dev-1",
      serial: "OKC-9",
      config: null,
    },
    idempotencyKey: "idem-1",
    fiscalContext: {
      kind: "cash_receipt",
      lines: [
        {
          productCode: "p1",
          name: "Burger",
          qty: 1,
          unitPriceCents: 12345,
          vatRate: 20,
          discountCents: 0,
        },
      ],
      payments: [{ method: "card", amountCents: 12345 }],
      customer: null,
    },
  };

  beforeEach(() => {
    provider = new Gmp3CardTerminalProvider(new PaymentTerminalProviderRegistry());
  });

  it("is a fiscal_coupled bridge provider", () => {
    expect(provider.id).toBe("gmp3_card");
    expect(provider.kind).toBe("bridge");
    expect(provider.capabilities).toContain("fiscal_coupled");
    expect(provider.capabilities).toContain("sale");
  });

  it("self-registers on module init", () => {
    const registry = new PaymentTerminalProviderRegistry();
    const p = new Gmp3CardTerminalProvider(registry);
    p.onModuleInit();
    expect(registry.has("gmp3_card")).toBe(true);
  });

  it("buildSaleCommand enqueues a charge_card carrying amount + fiscal context", () => {
    const cmd = provider.buildSaleCommand(baseReq);
    expect(cmd.kind).toBe("charge_card");
    expect(cmd.idempotencyKey).toBe("idem-1");
    expect(cmd.payload).toMatchObject({
      protocol: "GMP3",
      fiscalSerial: "OKC-9",
      orderId: "o1",
      amountCents: 12345,
      currency: "TRY",
    });
    expect((cmd.payload as any).fiscal.lines).toHaveLength(1);
  });

  it("honours per-device vendorProfile/sdkVersion overrides from config", () => {
    const cmd = provider.buildSaleCommand({
      ...baseReq,
      terminal: { ...baseReq.terminal, config: { vendorProfile: "beko.gmp3", sdkVersion: "4.0.0" } },
    });
    expect((cmd.payload as any).vendorProfile).toBe("beko.gmp3");
    expect((cmd.payload as any).sdkVersion).toBe("4.0.0");
  });

  it("maps a done ack with approval + fiscalNo to APPROVED (coupled fiş printed)", () => {
    const r = provider.mapAck({
      status: "done",
      result: {
        approved: true,
        approvalCode: "APP123",
        rrn: "RRN9",
        cardBrand: "VISA",
        maskedPan: "**** 1234",
        fiscalNo: "FN-77",
      },
      error: null,
    });
    expect(r.status).toBe("APPROVED");
    expect(r.approvalCode).toBe("APP123");
    expect(r.fiscalNo).toBe("FN-77");
    expect(r.cardBrand).toBe("VISA");
  });

  it("maps a done-but-refused ack to DECLINED (no Payment, no fiş)", () => {
    const r = provider.mapAck({
      status: "done",
      result: { approved: false, error: "Insufficient funds" },
      error: null,
    });
    expect(r.status).toBe("DECLINED");
    expect(r.fiscalNo).toBeUndefined();
    expect(r.error).toBe("Insufficient funds");
  });

  it("treats a done ack with no explicit approval as ERROR (never books money)", () => {
    const r = provider.mapAck({ status: "done", result: { rrn: "X" }, error: null });
    expect(r.status).toBe("ERROR");
    expect(r.approvalCode).toBeUndefined();
  });

  it("maps expired → TIMEOUT and failed → ERROR", () => {
    expect(provider.mapAck({ status: "expired", result: null, error: "no ack" }).status).toBe(
      "TIMEOUT",
    );
    expect(provider.mapAck({ status: "failed", result: null, error: "serial down" }).status).toBe(
      "ERROR",
    );
  });
});
