import { SoftPosTerminalProvider } from "./softpos-terminal.provider";
import { PaymentTerminalProviderRegistry } from "../payment-terminal-provider.registry";
import { TerminalChargeRequest } from "../payment-terminal-provider.interface";

describe("SoftPosTerminalProvider", () => {
  let provider: SoftPosTerminalProvider;

  beforeEach(() => {
    provider = new SoftPosTerminalProvider(new PaymentTerminalProviderRegistry());
  });

  it("is an in-process, non-activatable, charge-only provider", () => {
    expect(provider.kind).toBe("in_process");
    expect(provider.activatable).toBe(false);
    expect(provider.capabilities).not.toContain("fiscal_coupled");
  });

  it("charge is fail-closed: returns ERROR, never fabricates an approval", async () => {
    const req: TerminalChargeRequest = {
      tenantId: "t1",
      orderId: "o1",
      amountCents: 1000,
      terminal: {
        id: "term-1",
        providerId: "softpos",
        deviceId: null,
        serial: "SP-1",
        config: { apiKey: "anything" },
      },
      idempotencyKey: "k1",
    };
    const res = await provider.charge(req);
    expect(res.status).toBe("ERROR");
    expect(res.approvalCode).toBeUndefined();
  });
});
