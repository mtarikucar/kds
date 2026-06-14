import { ZReportPdfService } from "./z-report-pdf.service";

/**
 * Pure renderer extracted from ZReportsService.generatePdf (god-file split).
 * The rendering logic moved verbatim, so these specs lock that it still
 * produces a valid PDF for the representative branches (non-zero vs zero cash
 * difference, present vs missing notes, unknown currency fallback) — the
 * behavior the controller's PDF-download endpoint depends on.
 */
describe("ZReportPdfService", () => {
  const svc = new ZReportPdfService();

  const report: any = {
    id: "zr-1",
    reportNumber: "Z-001",
    reportDate: new Date("2026-06-01T00:00:00Z"),
    createdAt: new Date("2026-06-01T20:00:00Z"),
    totalOrders: 12,
    totalSales: 1500,
    totalDiscount: 50,
    netSales: 1450,
    cashPayments: 800,
    cardPayments: 600,
    digitalPayments: 50,
    openingCash: 200,
    expectedCash: 1000,
    countedCash: 990,
    cashDifference: -10,
    notes: "busy night",
  };
  const tenant: any = { name: "Acme Diner", currency: "TRY" };

  const isPdf = (buf: Buffer) => buf.subarray(0, 4).toString("latin1") === "%PDF";

  it("renders a non-empty PDF document (valid %PDF header)", async () => {
    const buf = await svc.render(report, tenant);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    expect(isPdf(buf)).toBe(true);
  });

  it("handles a zero cash difference and missing notes without throwing", async () => {
    const buf = await svc.render(
      { ...report, cashDifference: 0, notes: null },
      tenant,
    );
    expect(isPdf(buf)).toBe(true);
  });

  it("renders an over (positive) cash difference branch", async () => {
    const buf = await svc.render({ ...report, cashDifference: 25 }, tenant);
    expect(isPdf(buf)).toBe(true);
  });

  it("falls back to '$' for an unknown currency code", async () => {
    const buf = await svc.render(report, { name: "X", currency: "XYZ" } as any);
    expect(isPdf(buf)).toBe(true);
  });
});
