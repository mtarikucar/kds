import { NotFoundException } from "@nestjs/common";
import { Request, Response } from "express";
import { InvoiceController } from "./invoice.controller";
import { BillingService } from "../services/billing.service";
import { InvoicePdfService } from "../services/invoice-pdf.service";

/**
 * Long-tail spec for the tenant-scoped invoice controller. Load-bearing
 * contracts: every lookup is filtered by req.tenantId (IDOR fix), a missing
 * invoice → 404, download streams the PDF with the right headers and only
 * regenerates the PDF when it doesn't already exist (caching branch).
 */
describe("InvoiceController", () => {
  let billing: { getInvoiceByNumber: jest.Mock };
  let pdf: {
    invoicePdfExists: jest.Mock;
    generateInvoicePdf: jest.Mock;
    readInvoiceFile: jest.Mock;
  };
  let ctrl: InvoiceController;

  const req = { tenantId: "t1" } as unknown as Request;
  const invoice = { id: "inv-id", invoiceNumber: "INV-001" };

  beforeEach(() => {
    billing = { getInvoiceByNumber: jest.fn().mockResolvedValue(invoice) };
    pdf = {
      invoicePdfExists: jest.fn().mockReturnValue(true),
      generateInvoicePdf: jest.fn().mockResolvedValue("invoice-INV-001.pdf"),
      readInvoiceFile: jest.fn().mockReturnValue(Buffer.from("PDF")),
    };
    ctrl = new InvoiceController(
      billing as unknown as BillingService,
      pdf as unknown as InvoicePdfService,
    );
  });

  it("getInvoice scopes the lookup by tenantId", async () => {
    await ctrl.getInvoice("INV-001", req);
    expect(billing.getInvoiceByNumber).toHaveBeenCalledWith("INV-001", "t1");
  });

  it("getInvoice throws 404 when the invoice is absent", async () => {
    billing.getInvoiceByNumber.mockResolvedValue(null);
    await expect(ctrl.getInvoice("nope", req)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("downloadInvoice streams the cached PDF with inline headers", async () => {
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
    } as unknown as Response;
    await ctrl.downloadInvoice("INV-001", req, res);
    expect(pdf.generateInvoicePdf).not.toHaveBeenCalled(); // already exists
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/pdf",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'inline; filename="invoice-INV-001.pdf"',
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("downloadInvoice generates the PDF first when it is not yet cached", async () => {
    pdf.invoicePdfExists.mockReturnValue(false);
    const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;
    await ctrl.downloadInvoice("INV-001", req, res);
    expect(pdf.generateInvoicePdf).toHaveBeenCalledWith("inv-id", "t1");
  });

  it("generatePdf returns success + filename and forwards tenantId", async () => {
    const out = await ctrl.generatePdf("INV-001", req);
    expect(pdf.generateInvoicePdf).toHaveBeenCalledWith("inv-id", "t1");
    expect(out).toEqual({ success: true, filename: "invoice-INV-001.pdf" });
  });
});
