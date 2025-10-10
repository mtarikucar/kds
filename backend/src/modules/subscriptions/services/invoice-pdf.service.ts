import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);
  private readonly storagePath: string;

  constructor(private prisma: PrismaService) {
    this.storagePath = path.join(process.cwd(), 'storage', 'invoices');
    // Ensure storage directory exists
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  /**
   * Generate PDF for an invoice
   * Using simple HTML template for now - can be enhanced with puppeteer or pdfkit
   */
  async generateInvoicePdf(invoiceId: string): Promise<string> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          subscription: {
            include: {
              plan: true,
              tenant: true,
            },
          },
          payment: true,
        },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      // Generate HTML content
      const htmlContent = this.generateInvoiceHtml(invoice);

      // Save HTML as temporary file (in production, use puppeteer to convert to PDF)
      const filename = `invoice-${invoice.invoiceNumber}.html`;
      const filepath = path.join(this.storagePath, filename);

      fs.writeFileSync(filepath, htmlContent);

      // Return URL to access the invoice
      const invoiceUrl = `/api/invoices/${invoiceId}/download`;

      // Update invoice with PDF URL
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { pdfUrl: invoiceUrl },
      });

      this.logger.log(`Invoice PDF generated: ${filename}`);
      return invoiceUrl;
    } catch (error) {
      this.logger.error(`Failed to generate invoice PDF: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate HTML content for invoice
   */
  private generateInvoiceHtml(invoice: any): string {
    const tenant = invoice.subscription.tenant;
    const plan = invoice.subscription.plan;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Invoice ${invoice.invoiceNumber}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
        }
        .header {
            display: flex;
            justify-content: space-between;
            border-bottom: 3px solid #4F46E5;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .company-name {
            font-size: 28px;
            font-weight: bold;
            color: #4F46E5;
        }
        .invoice-title {
            font-size: 24px;
            color: #666;
        }
        .invoice-number {
            font-size: 18px;
            color: #888;
            margin-top: 5px;
        }
        .section {
            margin-bottom: 30px;
        }
        .section-title {
            font-size: 14px;
            font-weight: bold;
            color: #666;
            text-transform: uppercase;
            margin-bottom: 10px;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
        }
        .table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        .table th {
            background-color: #F3F4F6;
            padding: 12px;
            text-align: left;
            font-weight: 600;
            border-bottom: 2px solid #E5E7EB;
        }
        .table td {
            padding: 12px;
            border-bottom: 1px solid #E5E7EB;
        }
        .totals {
            margin-top: 30px;
            text-align: right;
        }
        .total-row {
            display: flex;
            justify-content: flex-end;
            padding: 8px 0;
        }
        .total-label {
            width: 200px;
            text-align: right;
            padding-right: 20px;
        }
        .total-value {
            width: 150px;
            text-align: right;
        }
        .grand-total {
            font-size: 20px;
            font-weight: bold;
            padding-top: 10px;
            border-top: 2px solid #333;
            margin-top: 10px;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }
        .status-paid {
            background-color: #DEF7EC;
            color: #03543F;
        }
        .status-open {
            background-color: #FEF3C7;
            color: #92400E;
        }
        .footer {
            margin-top: 50px;
            padding-top: 20px;
            border-top: 1px solid #E5E7EB;
            text-align: center;
            color: #888;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <div class="company-name">Restaurant POS</div>
            <div style="color: #666; margin-top: 5px;">Subscription Management</div>
        </div>
        <div style="text-align: right;">
            <div class="invoice-title">INVOICE</div>
            <div class="invoice-number">${invoice.invoiceNumber}</div>
            <div style="margin-top: 10px;">
                <span class="status-badge status-${invoice.status.toLowerCase()}">
                    ${invoice.status}
                </span>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Bill To</div>
        <div style="font-size: 16px; font-weight: 600;">${tenant.name}</div>
        ${tenant.email ? `<div style="color: #666;">${tenant.email}</div>` : ''}
        ${tenant.address ? `<div style="color: #666;">${tenant.address}</div>` : ''}
    </div>

    <div class="section">
        <div class="info-row">
            <div>
                <div class="section-title">Invoice Date</div>
                <div>${new Date(invoice.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
            <div>
                <div class="section-title">Due Date</div>
                <div>${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Due on receipt'}</div>
            </div>
            ${invoice.paidAt ? `
            <div>
                <div class="section-title">Paid Date</div>
                <div>${new Date(invoice.paidAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
            ` : ''}
        </div>
    </div>

    <table class="table">
        <thead>
            <tr>
                <th>Description</th>
                <th>Period</th>
                <th style="text-align: right;">Amount</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>
                    <strong>${plan.displayName}</strong>
                    <div style="color: #666; font-size: 14px;">
                        ${invoice.subscription.billingCycle} Subscription
                    </div>
                </td>
                <td>
                    ${new Date(invoice.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} -
                    ${new Date(invoice.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
                <td style="text-align: right;">${invoice.currency} ${Number(invoice.subtotal).toFixed(2)}</td>
            </tr>
        </tbody>
    </table>

    <div class="totals">
        <div class="total-row">
            <div class="total-label">Subtotal:</div>
            <div class="total-value">${invoice.currency} ${Number(invoice.subtotal).toFixed(2)}</div>
        </div>
        ${Number(invoice.tax) > 0 ? `
        <div class="total-row">
            <div class="total-label">Tax:</div>
            <div class="total-value">${invoice.currency} ${Number(invoice.tax).toFixed(2)}</div>
        </div>
        ` : ''}
        <div class="total-row grand-total">
            <div class="total-label">Total:</div>
            <div class="total-value">${invoice.currency} ${Number(invoice.total).toFixed(2)}</div>
        </div>
    </div>

    ${invoice.description ? `
    <div class="section">
        <div class="section-title">Notes</div>
        <div>${invoice.description}</div>
    </div>
    ` : ''}

    ${invoice.payment ? `
    <div class="section">
        <div class="section-title">Payment Information</div>
        <div class="info-row">
            <div>
                <strong>Payment Method:</strong> ${invoice.payment.paymentProvider}
            </div>
            <div>
                <strong>Payment Date:</strong> ${invoice.payment.paidAt ? new Date(invoice.payment.paidAt).toLocaleDateString() : 'Pending'}
            </div>
        </div>
    </div>
    ` : ''}

    <div class="footer">
        <p>Thank you for your business!</p>
        <p>For questions about this invoice, please contact support@restaurant-pos.com</p>
    </div>
</body>
</html>
    `;
  }

  /**
   * Get invoice file path
   */
  getInvoiceFilePath(invoiceNumber: string): string {
    return path.join(this.storagePath, `invoice-${invoiceNumber}.html`);
  }

  /**
   * Check if invoice PDF exists
   */
  invoicePdfExists(invoiceNumber: string): boolean {
    const filepath = this.getInvoiceFilePath(invoiceNumber);
    return fs.existsSync(filepath);
  }

  /**
   * Read invoice file content
   */
  readInvoiceFile(invoiceNumber: string): Buffer {
    const filepath = this.getInvoiceFilePath(invoiceNumber);
    return fs.readFileSync(filepath);
  }
}
