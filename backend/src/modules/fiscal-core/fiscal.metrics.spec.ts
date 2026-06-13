const mockCapture = jest.fn();
jest.mock("../../sentry.config", () => ({
  captureException: (...args: unknown[]) => mockCapture(...args),
}));

import { FiscalService } from "./fiscal.service";

/**
 * Observability for the compliance-critical fiscal path: every receipt
 * outcome is counted (fiscal_receipts_issued_total{status}) and a provider
 * dispatch failure is surfaced to Sentry instead of being logged-only.
 */
function build(providerOutcome: { status: string; fiscalNo?: string } | Error) {
  const device = {
    id: "d-1",
    tenantId: "t-1",
    branchId: "b-1",
    providerId: "prov",
    status: "active",
  };
  const prisma: any = {
    fiscalDeviceRecord: { findFirst: jest.fn().mockResolvedValue(device) },
    fiscalReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "r-1" }),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve({ id: "r-1", status: data.status }),
        ),
    },
  };
  const provider = {
    issueReceipt:
      providerOutcome instanceof Error
        ? jest.fn().mockRejectedValue(providerOutcome)
        : jest.fn().mockResolvedValue(providerOutcome),
  };
  const registry: any = { get: jest.fn().mockReturnValue(provider) };
  const outbox: any = { append: jest.fn().mockResolvedValue(undefined) };
  const metrics = { incCounter: jest.fn() };
  const svc = new FiscalService(prisma, registry, outbox, metrics as any);
  return { svc, metrics };
}

const req = {
  tenantId: "t-1",
  fiscalDeviceId: "d-1",
  idempotencyKey: "idem-1",
  branchId: "b-1",
  lines: [{ qty: 1, unitPriceCents: 1000, vatRate: 20 }],
} as any;

describe("FiscalService observability", () => {
  beforeEach(() => mockCapture.mockClear());

  it("counts an issued receipt and does not alert Sentry", async () => {
    const { svc, metrics } = build({ status: "issued", fiscalNo: "F1" });
    await svc.issueReceipt(req);
    expect(metrics.incCounter).toHaveBeenCalledWith(
      "fiscal_receipts_issued_total",
      expect.any(String),
      { status: "issued" },
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("counts a failure and captures the provider error to Sentry", async () => {
    const { svc, metrics } = build(new Error("device offline"));
    await svc.issueReceipt(req);
    expect(metrics.incCounter).toHaveBeenCalledWith(
      "fiscal_receipts_issued_total",
      expect.any(String),
      { status: "failed" },
    );
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ op: "issueReceipt", tenantId: "t-1" }),
    );
  });
});
