import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);
  private readonly storagePath: string;

  constructor(private prisma: PrismaService) {
    this.storagePath = path.join(process.cwd(), 'storage', 'invoices');
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  /**
   * Generate a real PDF (via pdfkit) for the given invoice. The file is
   * named from the sanitized invoice number so it can be safely served
   * by filename. The DB row stores only the relative filename (never the
   * full /api path) so we can regenerate URLs freely.
   */
  async generateInvoicePdf(invoiceId: string): Promise<string> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        subscription: { include: { plan: true, tenant: true } },
        payment: true,
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const safeName = this.sanitizeFilename(`invoice-${invoice.invoiceNumber}.pdf`);
    const filepath = path.join(this.storagePath, safeName);

    await this.writePdf(filepath, invoice);

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { pdfUrl: safeName },
    });

    this.logger.log(`Invoice PDF generated: ${safeName}`);
    return safeName;
  }

  private sanitizeFilename(name: string): string {
    // Strip path separators and any non-printable chars.
    return name.replace(/[^A-Za-z0-9._-]/g, '_');
  }

  private writePdf(filepath: string, invoice: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(filepath);
      stream.on('error', reject);
      stream.on('finish', () => resolve());
      doc.pipe(stream);

      const tenant = invoice.subscription.tenant;
      const plan = invoice.subscription.plan;
      const currency = invoice.currency;
      const money = (v: any) => `${currency} ${Number(v).toFixed(2)}`;
      const dateStr = (d?: Date | null) =>
        d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '-';

      // Header
      doc
        .fontSize(22)
        .fillColor('#4F46E5')
        .text('HummyTummy', 50, 50)
        .fontSize(10)
        .fillColor('#666')
        .text('Subscription Management', 50, 78);

      doc
        .fontSize(18)
        .fillColor('#111')
        .text('INVOICE', 400, 50, { align: 'right' })
        .fontSize(10)
        .fillColor('#555')
        .text(invoice.invoiceNumber, 400, 74, { align: 'right' })
        .text(`Status: ${invoice.status}`, 400, 88, { align: 'right' });

      doc.moveTo(50, 110).lineTo(545, 110).strokeColor('#E5E7EB').stroke();

      // Bill-to
      doc
        .fontSize(9)
        .fillColor('#888')
        .text('BILL TO', 50, 130);
      doc.fontSize(12).fillColor('#111').text(tenant.name, 50, 144);
      if (tenant.subdomain) {
        doc.fontSize(10).fillColor('#666').text(tenant.subdomain, 50, 160);
      }

      // Dates
      doc.fontSize(9).fillColor('#888').text('INVOICE DATE', 300, 130);
      doc.fontSize(10).fillColor('#111').text(dateStr(invoice.createdAt), 300, 144);
      doc.fontSize(9).fillColor('#888').text('DUE DATE', 430, 130);
      doc.fontSize(10).fillColor('#111').text(dateStr(invoice.dueDate), 430, 144);
      if (invoice.paidAt) {
        doc.fontSize(9).fillColor('#888').text('PAID DATE', 430, 170);
        doc.fontSize(10).fillColor('#111').text(dateStr(invoice.paidAt), 430, 184);
      }

      // Line items table header
      const tableTop = 230;
      doc
        .rect(50, tableTop, 495, 24)
        .fillColor('#F3F4F6')
        .fill();
      doc
        .fillColor('#111')
        .fontSize(10)
        .text('Description', 60, tableTop + 7)
        .text('Period', 280, tableTop + 7)
        .text('Amount', 470, tableTop + 7, { width: 70, align: 'right' });

      // Line item
      const itemY = tableTop + 32;
      doc
        .fillColor('#111')
        .text(plan.displayName, 60, itemY)
        .fontSize(9)
        .fillColor('#666')
        .text(`${invoice.subscription.billingCycle} Subscription`, 60, itemY + 14);
      doc
        .fontSize(10)
        .fillColor('#111')
        .text(
          `${dateStr(invoice.periodStart)} → ${dateStr(invoice.periodEnd)}`,
          280,
          itemY,
        );
      doc.text(money(invoice.subtotal), 470, itemY, { width: 70, align: 'right' });

      doc
        .moveTo(50, itemY + 40)
        .lineTo(545, itemY + 40)
        .strokeColor('#E5E7EB')
        .stroke();

      // Totals
      const totalsY = itemY + 56;
      const labelX = 380;
      const valueX = 470;
      doc.fontSize(10).fillColor('#555');
      doc.text('Subtotal', labelX, totalsY, { width: 80, align: 'right' });
      doc
        .fillColor('#111')
        .text(money(invoice.subtotal), valueX, totalsY, { width: 70, align: 'right' });
      if (Number(invoice.tax) > 0) {
        doc.fillColor('#555').text('Tax', labelX, totalsY + 18, { width: 80, align: 'right' });
        doc
          .fillColor('#111')
          .text(money(invoice.tax), valueX, totalsY + 18, { width: 70, align: 'right' });
      }
      const grandY = totalsY + 40;
      doc
        .moveTo(labelX, grandY - 4)
        .lineTo(valueX + 70, grandY - 4)
        .strokeColor('#111')
        .stroke();
      doc
        .fontSize(12)
        .fillColor('#111')
        .text('Total', labelX, grandY + 2, { width: 80, align: 'right' });
      doc.text(money(invoice.total), valueX, grandY + 2, { width: 70, align: 'right' });

      // Payment info
      if (invoice.payment) {
        doc
          .fontSize(9)
          .fillColor('#888')
          .text('PAYMENT', 50, grandY + 40);
        doc
          .fontSize(10)
          .fillColor('#111')
          .text(`Provider: ${invoice.payment.paymentProvider}`, 50, grandY + 54);
        if (invoice.payment.externalReference) {
          doc.text(
            `Reference: ${invoice.payment.externalReference}`,
            50,
            grandY + 68,
          );
        }
      }

      doc
        .fontSize(9)
        .fillColor('#888')
        .text(
          'Thank you for your business. For questions about this invoice please contact support.',
          50,
          760,
          { width: 495, align: 'center' },
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
