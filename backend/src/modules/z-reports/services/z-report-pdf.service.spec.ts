import PDFDocument from "pdfkit";
import { ZReportPdfService } from "./z-report-pdf.service";
import { EscPosBuilderUzService } from "../../printing-core/escpos-builder-uz.service";
import { EscPosBuilderRegistry } from "../../printing-core/escpos-builder.registry";
import type { ReceiptSnapshotV1 } from "../../orders/services/receipt-snapshot.builder";

/**
 * Pure renderer extracted from ZReportsService.generatePdf (god-file split).
 * The rendering logic moved verbatim, so these specs lock that it still
 * produces a valid PDF for the representative branches (non-zero vs zero cash
 * difference, present vs missing notes) — the behavior the controller's
 * PDF-download endpoint depends on.
 *
 * Task 13: money on this PDF used to hardcode 2 decimals and fall back to
 * "$" for any currency not in a fixed symbol map (UZS included — an Uzbek
 * restaurant's end-of-day report printed a dollar sign). It now derives
 * currency/decimals/symbol from `resolveCountryProfile(tenant.countryCode)`
 * — never from `tenant.currency` directly (that field is a written mirror,
 * never the truth; see country.service.ts's class doc comment) — through
 * the shared money-format.ts formatter. `pdfkit` compresses its output
 * streams, so plain text assertions on the raw buffer don't work; these
 * specs spy on `PDFDocument.prototype.text` to capture the exact strings
 * handed to the renderer instead.
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
  const tenant: any = { name: "Acme Diner", currency: "TRY", countryCode: "TR" };

  const isPdf = (buf: Buffer) => buf.subarray(0, 4).toString("latin1") === "%PDF";

  /** Renders and returns every string handed to `doc.text(...)`, in order. */
  async function renderCapturingText(
    reportArg: any,
    tenantArg: any,
  ): Promise<{ buf: Buffer; texts: string[] }> {
    const texts: string[] = [];
    const spy = jest
      .spyOn(PDFDocument.prototype, "text")
      .mockImplementation(function (this: any, ...args: any[]) {
        if (typeof args[0] === "string") texts.push(args[0]);
        return this;
      });
    try {
      const buf = await svc.render(reportArg, tenantArg);
      return { buf, texts };
    } finally {
      spy.mockRestore();
    }
  }

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

  describe("Task 13 — country-profile-driven money", () => {
    it("a TR tenant's amounts keep their exact pre-existing shape: ₺<amount>, 2dp, ungrouped", async () => {
      const { texts } = await renderCapturingText(report, tenant);
      expect(texts.some((t) => t.includes("Total Sales: ₺1500.00"))).toBe(
        true,
      );
      expect(texts.some((t) => t.includes("Net Sales: ₺1450.00"))).toBe(true);
    });

    it("a UZ tenant's amounts render with ZERO decimals and the real so'm glyph — never '$'", async () => {
      const uzTenant = { name: "Choyxona", currency: "TRY", countryCode: "UZ" };
      const { texts } = await renderCapturingText(report, uzTenant);
      // Root-cause defect: tenant.currency ("TRY", a stale/irrelevant mirror
      // here) must NOT drive this — only the country profile does.
      expect(texts.some((t) => t.includes("$"))).toBe(false);
      expect(texts.some((t) => /Total Sales: 1500\s*so.m/.test(t))).toBe(
        true,
      );
      expect(texts.some((t) => t.includes("1500.00"))).toBe(false);
    });

    it("an unrecognised countryCode falls back to the default country profile (TR), never to '$'", async () => {
      const weirdTenant = { name: "X", currency: "XYZ", countryCode: "XX" };
      const { texts } = await renderCapturingText(report, weirdTenant);
      expect(texts.some((t) => t.includes("$"))).toBe(false);
      expect(texts.some((t) => t.includes("₺1500.00"))).toBe(true);
    });

    it("a negative cash difference keeps its pre-existing TR shape: ₺-10.00", async () => {
      const { texts } = await renderCapturingText(report, tenant);
      expect(texts.some((t) => t.startsWith("Difference: ₺-10.00"))).toBe(
        true,
      );
    });
  });

  describe("Task 13 — agrees with the ESC/POS receipt on the same amount", () => {
    it("the PDF and a UZ receipt render the SAME underlying amount for the SAME input", async () => {
      const uzTenant = { name: "Choyxona", currency: "UZS", countryCode: "UZ" };
      const { texts } = await renderCapturingText(
        { ...report, totalSales: 112000 },
        uzTenant,
      );
      const pdfLine = texts.find((t) => t.startsWith("Total Sales:"));
      expect(pdfLine).toBeDefined();

      const receiptSnapshot: ReceiptSnapshotV1 = {
        version: 1,
        restaurant: { name: "Choyxona", currency: "UZS" },
        order: {
          id: "o1",
          orderNumber: "A-1",
          type: "DINE_IN",
          tableNumber: null,
          notes: null,
        },
        items: [
          {
            name: "Osh",
            quantity: 1,
            unitPrice: "112000.00",
            totalPrice: "112000.00",
            modifiers: [],
            notes: null,
          },
        ],
        totals: {
          subtotal: "112000.00",
          tax: "0.00",
          discount: "0.00",
          total: "112000.00",
        },
        payment: { method: "CASH", transactionId: null, paidAt: new Date().toISOString() },
        printedAt: new Date().toISOString(),
      };
      const receiptJob = new EscPosBuilderUzService(
        {} as EscPosBuilderRegistry,
      ).buildReceipt(receiptSnapshot);
      const receiptText = Buffer.from(receiptJob.bytes).toString("latin1");

      // Both must show "112000" with ZERO fraction digits — the exact
      // root-cause defect (each surface hardcoded its own decimal count
      // independently) this task fixes.
      expect(pdfLine).toMatch(/112000(?!\.00)/);
      expect(receiptText).toMatch(/112(\s|.)000(?!,00)/);
      expect(pdfLine).not.toContain("112000.00");
      expect(receiptText).not.toContain("112000,00");
    });
  });
});
