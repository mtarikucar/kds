import { PaygoEcrTerminalProvider } from "./paygo-ecr-terminal.provider";
import { PaymentTerminalProviderRegistry } from "../payment-terminal-provider.registry";
import { TerminalChargeRequest } from "../payment-terminal-provider.interface";

describe("PaygoEcrTerminalProvider", () => {
  let provider: PaygoEcrTerminalProvider;

  const baseReq: TerminalChargeRequest = {
    tenantId: "t1",
    branchId: "b1",
    orderId: "o1",
    amountCents: 12345,
    terminal: {
      id: "term-1",
      providerId: "paygo_ecr",
      deviceId: "dev-1",
      serial: "5B0024050735", // SP630 serial style
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
    provider = new PaygoEcrTerminalProvider(
      new PaymentTerminalProviderRegistry(),
    );
  });

  it("is a fiscal_coupled bridge provider", () => {
    expect(provider.id).toBe("paygo_ecr");
    expect(provider.kind).toBe("bridge");
    expect(provider.capabilities).toContain("fiscal_coupled");
    expect(provider.capabilities).toContain("sale");
  });

  it("is NOT activatable — ships INERT until the Paygo GMP-3 handshake is certified", () => {
    // The activation gate (payment-terminal.service.setActivation) refuses ACTIVE
    // when activatable === false, so a paygo_ecr record can never move real money
    // in Phase 0. This is the honest CONFIGURED_NOT_ACTIVE boundary at the
    // provider level; do not flip it without the certified Phase-1 driver.
    expect(provider.activatable).toBe(false);
  });

  it("self-registers on module init", () => {
    const registry = new PaymentTerminalProviderRegistry();
    const p = new PaygoEcrTerminalProvider(registry);
    p.onModuleInit();
    expect(registry.has("paygo_ecr")).toBe(true);
  });

  it("buildSaleCommand emits a GMP3 charge_card pinned to the paygo.sp630 profile", () => {
    const cmd = provider.buildSaleCommand(baseReq);
    expect(cmd.kind).toBe("charge_card");
    expect(cmd.idempotencyKey).toBe("idem-1");
    expect(cmd.payload).toMatchObject({
      protocol: "GMP3",
      vendorProfile: "paygo.sp630",
      fiscalSerial: "5B0024050735",
      orderId: "o1",
      amountCents: 12345,
      currency: "TRY",
    });
    // The coupled fiş context rides along so the SP630 prints the fiş atomically.
    expect((cmd.payload as any).fiscal.lines).toHaveLength(1);
    // No `target` — the bridge routes GMP3-protocol commands to the gmp3 driver.
    expect((cmd.payload as any).target).toBeUndefined();
  });

  it("honours per-device vendorProfile/sdkVersion overrides from config", () => {
    const cmd = provider.buildSaleCommand({
      ...baseReq,
      terminal: {
        ...baseReq.terminal,
        config: { vendorProfile: "paygo.sp730", sdkVersion: "4.0.0" },
      },
    });
    expect((cmd.payload as any).vendorProfile).toBe("paygo.sp730");
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
      result: { approved: false, error: "Yetersiz bakiye" },
      error: null,
    });
    expect(r.status).toBe("DECLINED");
    expect(r.fiscalNo).toBeUndefined();
    expect(r.error).toBe("Yetersiz bakiye");
  });

  it("treats a done ack with no explicit approval as ERROR (never books money)", () => {
    const r = provider.mapAck({
      status: "done",
      result: { rrn: "X" },
      error: null,
    });
    expect(r.status).toBe("ERROR");
    expect(r.approvalCode).toBeUndefined();
  });

  it("maps expired → TIMEOUT and failed → ERROR", () => {
    expect(
      provider.mapAck({ status: "expired", result: null, error: "no ack" })
        .status,
    ).toBe("TIMEOUT");
    expect(
      provider.mapAck({ status: "failed", result: null, error: "serial down" })
        .status,
    ).toBe("ERROR");
  });
});
