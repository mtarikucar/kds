import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import PDFDocument from "pdfkit";
import { PrismaService } from "../../../prisma/prisma.service";

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);
  private readonly storagePath: string;

  constructor(private prisma: PrismaService) {
    this.storagePath = path.join(process.cwd(), "storage", "invoices");
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  /**
   * Generate a real PDF (via pdfkit) for the given invoice. The file is
   * named from the sanitized invoice number so it can be safely served
   * by filename. The DB row stores only the relative filename (never the
   * full /api path) so we can regenerate URLs freely.
   *
   * `tenantId` is required for defence-in-depth. Today every caller is
   * the tenant-scoped invoice controller (which already filters by
   * tenant before passing the id), but a future service-layer caller —
   * cron, internal job, gRPC — would have no controller to gate it.
   * Asserting here means any new caller has to be explicit about which
   * tenant's invoice it is, or accept a NotFoundException.
   *
   * Iter-96: tenantId was previously typed optional and the IDOR check
   * was gated on `if (tenantId)`. The type-system loophole meant a
   * caller that omitted the arg silently bypassed the cross-tenant
   * guard. Made required; the IDOR check always runs.
   */
  async generateInvoicePdf(
    invoiceId: string,
    tenantId: string,
  ): Promise<string> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        subscription: { include: { plan: true, tenant: true } },
        payment: true,
      },
    });
    if (!invoice || invoice.subscription?.tenantId !== tenantId) {
      // Hidden behind NotFound rather than Forbidden — we don't want the
      // caller to be able to distinguish "wrong tenant" from "doesn't
      // exist", which would enable invoice-id probing.
      throw new NotFoundException("Invoice not found");
    }

    const safeName = this.sanitizeFilename(
      `invoice-${invoice.invoiceNumber}.pdf`,
    );
    const filepath = path.join(this.storagePath, safeName);

    await this.writePdf(filepath, invoice);

    // Iter-96: defence-in-depth on the metadata write — scope the
    // update by both invoice id AND subscription.tenantId. If a future
    // regression of the check above lets a wrong-tenant invoice through
    // we still don't write to it.
    const claim = await this.prisma.invoice.updateMany({
      where: { id: invoiceId, subscription: { tenantId } },
      data: { pdfUrl: safeName },
    });
    if (claim.count === 0) {
      throw new NotFoundException("Invoice not found");
    }

    this.logger.log(`Invoice PDF generated: ${safeName}`);
    return safeName;
  }

  private sanitizeFilename(name: string): string {
    // Strip path separators and any non-printable chars.
    return name.replace(/[^A-Za-z0-9._-]/g, "_");
  }

  private writePdf(filepath: string, invoice: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const stream = fs.createWriteStream(filepath);
      stream.on("error", reject);
      stream.on("finish", () => resolve());
      doc.pipe(stream);

      const tenant = invoice.subscription.tenant;
      const plan = invoice.subscription.plan;
      const currency = invoice.currency;
      const isTRY = currency.toUpperCase() === "TRY";
      const money = (v: any) => `${currency} ${Number(v).toFixed(2)}`;
      const dateStr = (d?: Date | null) =>
        d
          ? new Date(d).toLocaleDateString(isTRY ? "tr-TR" : "en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "-";
      // TR/EN labels — Turkish invoices need TR copy for KDV compliance.
      const L = isTRY
        ? {
            tagline: "Abonelik Yönetimi",
            invoice: "FATURA",
            status: "Durum",
            billTo: "ALICI",
            taxIdLabel: "Vergi No / TC Kimlik No",
            invoiceDate: "FATURA TARİHİ",
            dueDate: "SON ÖDEME TARİHİ",
            paidDate: "ÖDEME TARİHİ",
            description: "Açıklama",
            period: "Dönem",
            amount: "Tutar",
            subtotal: "Ara toplam",
            kdv: "KDV (%20)",
            total: "Genel toplam",
            subscriptionLine: `${invoice.subscription.billingCycle === "MONTHLY" ? "Aylık" : "Yıllık"} abonelik`,
          }
        : {
            tagline: "Subscription Management",
            invoice: "INVOICE",
            status: "Status",
            billTo: "BILL TO",
            taxIdLabel: "Tax ID",
            invoiceDate: "INVOICE DATE",
            dueDate: "DUE DATE",
            paidDate: "PAID DATE",
            description: "Description",
            period: "Period",
            amount: "Amount",
            subtotal: "Subtotal",
            kdv: "Tax",
            total: "Total",
            subscriptionLine: `${invoice.subscription.billingCycle} Subscription`,
          };

      // Header
      doc
        .fontSize(22)
        .fillColor("#4F46E5")
        .text("HummyTummy", 50, 50)
        .fontSize(10)
        .fillColor("#666")
        .text(L.tagline, 50, 78);

      doc
        .fontSize(18)
        .fillColor("#111")
        .text(L.invoice, 400, 50, { align: "right" })
        .fontSize(10)
        .fillColor("#555")
        .text(invoice.invoiceNumber, 400, 74, { align: "right" })
        .text(`${L.status}: ${invoice.status}`, 400, 88, { align: "right" });

      doc.moveTo(50, 110).lineTo(545, 110).strokeColor("#E5E7EB").stroke();

      // Bill-to
      doc.fontSize(9).fillColor("#888").text(L.billTo, 50, 130);
      doc.fontSize(12).fillColor("#111").text(tenant.name, 50, 144);
      let billToY = 160;
      if (tenant.subdomain) {
        doc.fontSize(10).fillColor("#666").text(tenant.subdomain, 50, billToY);
        billToY += 14;
      }
      // Tax ID printed from the snapshot (frozen at invoice issuance) so
      // future taxId edits don't retroactively rewrite history.
      if (invoice.taxIdSnapshot) {
        doc
          .fontSize(9)
          .fillColor("#888")
          .text(`${L.taxIdLabel}: ${invoice.taxIdSnapshot}`, 50, billToY);
      }

      // Dates
      doc.fontSize(9).fillColor("#888").text(L.invoiceDate, 300, 130);
      doc
        .fontSize(10)
        .fillColor("#111")
        .text(dateStr(invoice.createdAt), 300, 144);
      doc.fontSize(9).fillColor("#888").text(L.dueDate, 430, 130);
      doc
        .fontSize(10)
        .fillColor("#111")
        .text(dateStr(invoice.dueDate), 430, 144);
      if (invoice.paidAt) {
        doc.fontSize(9).fillColor("#888").text(L.paidDate, 430, 170);
        doc
          .fontSize(10)
          .fillColor("#111")
          .text(dateStr(invoice.paidAt), 430, 184);
      }

      // Line items table header
      const tableTop = 230;
      doc.rect(50, tableTop, 495, 24).fillColor("#F3F4F6").fill();
      doc
        .fillColor("#111")
        .fontSize(10)
        .text(L.description, 60, tableTop + 7)
        .text(L.period, 280, tableTop + 7)
        .text(L.amount, 470, tableTop + 7, { width: 70, align: "right" });

      // Line item
      const itemY = tableTop + 32;
      doc
        .fillColor("#111")
        .text(plan.displayName, 60, itemY)
        .fontSize(9)
        .fillColor("#666")
        .text(L.subscriptionLine, 60, itemY + 14);
      doc
        .fontSize(10)
        .fillColor("#111")
        .text(
          `${dateStr(invoice.periodStart)} → ${dateStr(invoice.periodEnd)}`,
          280,
          itemY,
        );
      doc.text(money(invoice.subtotal), 470, itemY, {
        width: 70,
        align: "right",
      });

      doc
        .moveTo(50, itemY + 40)
        .lineTo(545, itemY + 40)
        .strokeColor("#E5E7EB")
        .stroke();

      // Totals
      const totalsY = itemY + 56;
      const labelX = 380;
      const valueX = 470;
      doc.fontSize(10).fillColor("#555");
      doc.text(L.subtotal, labelX, totalsY, { width: 80, align: "right" });
      doc.fillColor("#111").text(money(invoice.subtotal), valueX, totalsY, {
        width: 70,
        align: "right",
      });
      if (Number(invoice.tax) > 0) {
        doc
          .fillColor("#555")
          .text(L.kdv, labelX, totalsY + 18, { width: 80, align: "right" });
        doc.fillColor("#111").text(money(invoice.tax), valueX, totalsY + 18, {
          width: 70,
          align: "right",
        });
      }
      const grandY = totalsY + 40;
      doc
        .moveTo(labelX, grandY - 4)
        .lineTo(valueX + 70, grandY - 4)
        .strokeColor("#111")
        .stroke();
      doc
        .fontSize(12)
        .fillColor("#111")
        .text(L.total, labelX, grandY + 2, { width: 80, align: "right" });
      doc.text(money(invoice.total), valueX, grandY + 2, {
        width: 70,
        align: "right",
      });

      // Payment info
      if (invoice.payment) {
        doc
          .fontSize(9)
          .fillColor("#888")
          .text(isTRY ? "ÖDEME BİLGİSİ" : "PAYMENT", 50, grandY + 40);
        doc
          .fontSize(10)
          .fillColor("#111")
          .text(
            `${isTRY ? "Sağlayıcı" : "Provider"}: ${invoice.payment.paymentProvider}`,
            50,
            grandY + 54,
          );
        if (invoice.payment.externalReference) {
          doc.text(
            `${isTRY ? "Referans" : "Reference"}: ${invoice.payment.externalReference}`,
            50,
            grandY + 68,
          );
        }
      }

      doc
        .fontSize(9)
        .fillColor("#888")
        .text(
          isTRY
            ? "Tercihiniz için teşekkür ederiz. Faturayla ilgili sorularınız için destek ekibimize ulaşabilirsiniz."
            : "Thank you for your business. For questions about this invoice please contact support.",
          50,
          760,
          { width: 495, align: "center" },
        );

      doc.end();
    });
  }

  /**
   * Filesystem path on disk for a given invoice number. Tenant-scoped
   * lookup must happen at the controller layer — this method trusts that
   * the caller has already authorized access.
   */
  getInvoiceFilePath(invoiceNumber: string): string {
    const safe = this.sanitizeFilename(`invoice-${invoiceNumber}.pdf`);
    return path.join(this.storagePath, safe);
  }

  invoicePdfExists(invoiceNumber: string): boolean {
    return fs.existsSync(this.getInvoiceFilePath(invoiceNumber));
  }

  readInvoiceFile(invoiceNumber: string): Buffer {
    return fs.readFileSync(this.getInvoiceFilePath(invoiceNumber));
  }
}
