import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/services/email.service';
import { CreateZReportDto } from './dto/create-z-report.dto';
import PDFDocument from 'pdfkit';
import { format } from 'date-fns';

// Currency symbol mapping
const CURRENCY_SYMBOLS: Record<string, string> = {
  TRY: '₺',
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'C$',
  AUD: 'A$',
};

@Injectable()
export class ZReportsService {
  private readonly logger = new Logger(ZReportsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  /**
   * Generate a Z-Report for end-of-day reconciliation
   */
  async generateReport(tenantId: string, userId: string, createDto: CreateZReportDto) {
    const { reportDate, cashDrawerOpening, cashDrawerClosing, notes } = createDto;

    // Check if report already exists for this date
    const existing = await this.prisma.zReport.findFirst({
      where: {
        tenantId,
        reportDate: new Date(reportDate),
      },
    });

    if (existing) {
      throw new BadRequestException('Z-Report already exists for this date');
    }

    // Get orders for the report date
    const startOfDay = new Date(reportDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(reportDate);
    endOfDay.setHours(23, 59, 59, 999);

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        status: 'PAID',
      },
      include: {
        payments: true,
        orderItems: {
          include: {
            product: true,
          },
        },
      },
    });

    // Calculate totals
    const totalOrders = orders.length;
    const grossSales = orders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
    const discounts = orders.reduce((sum, order) => sum + Number(order.discount), 0);
    const netSales = orders.reduce((sum, order) => sum + Number(order.finalAmount), 0);

    // Calculate payment method breakdown
    const allPayments = orders.flatMap((o) => o.payments);

    const cashPaymentsList = allPayments.filter((p) => p.method === 'CASH');
    const cashPayments = cashPaymentsList.reduce((sum, p) => sum + Number(p.amount), 0);
    const cashPaymentCount = cashPaymentsList.length;

    const cardPaymentsList = allPayments.filter((p) => p.method === 'CARD');
    const cardPayments = cardPaymentsList.reduce((sum, p) => sum + Number(p.amount), 0);
    const cardPaymentCount = cardPaymentsList.length;

    const digitalPaymentsList = allPayments.filter((p) => p.method === 'DIGITAL');
    const digitalPayments = digitalPaymentsList.reduce((sum, p) => sum + Number(p.amount), 0);
    const digitalPaymentCount = digitalPaymentsList.length;

    // Order type breakdown
    const dineInOrders = orders.filter((o) => o.type === 'DINE_IN');
    const dineInSales = dineInOrders.reduce((sum, o) => sum + Number(o.finalAmount), 0);

    const takeawayOrders = orders.filter((o) => o.type === 'TAKEAWAY');
    const takeawaySales = takeawayOrders.reduce((sum, o) => sum + Number(o.finalAmount), 0);

    const deliveryOrders = orders.filter((o) => o.type === 'DELIVERY');
    const deliverySales = deliveryOrders.reduce((sum, o) => sum + Number(o.finalAmount), 0);

    // Cancelled orders in the date range
    const cancelledOrdersList = await this.prisma.order.findMany({
      where: {
        tenantId,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        status: 'CANCELLED',
      },
      select: {
        totalAmount: true,
      },
    });
    const cancelledOrders = cancelledOrdersList.length;
    const cancelledOrdersAmount = cancelledOrdersList.reduce(
      (sum, o) => sum + Number(o.totalAmount),
      0,
    );

    // Cash drawer reconciliation
    const expectedCash = cashDrawerOpening + cashPayments;
    const cashDifference = cashDrawerClosing - expectedCash;

    // Get top selling products
    const productSales = new Map<string, { name: string; quantity: number; revenue: number }>();
    orders.forEach((order) => {
      order.orderItems.forEach((item) => {
        const existing = productSales.get(item.productId) || {
          name: item.product.name,
          quantity: 0,
          revenue: 0,
        };
        existing.quantity += item.quantity;
        existing.revenue += Number(item.subtotal);
        productSales.set(item.productId, existing);
      });
    });

    const topProducts = Array.from(productSales.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Get cash drawer movements for the day
    const cashMovements = await this.prisma.cashDrawerMovement.findMany({
      where: {
        tenantId,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Create the Z-Report
    const report = await this.prisma.zReport.create({
      data: {
        tenantId,
        reportDate: new Date(reportDate),
        reportNumber: `Z-${new Date(reportDate).toISOString().slice(0, 10).replace(/-/g, '')}`,
        closedById: userId,

        // Sales data
        totalOrders,
        totalSales: grossSales,
        totalDiscount: discounts,
        netSales,

        // Payment breakdown
        cashPayments,
        cashPaymentCount,
        cardPayments,
        cardPaymentCount,
        digitalPayments,
        digitalPaymentCount,

        // Order type breakdown
        dineInSales,
        dineInOrders: dineInOrders.length,
        takeawaySales,
        takeawayOrders: takeawayOrders.length,
        deliverySales,
        deliveryOrders: deliveryOrders.length,

        // Cancelled orders
        cancelledOrders,
        cancelledOrdersAmount,

        // Cash drawer
        openingCash: cashDrawerOpening,
        countedCash: cashDrawerClosing,
        expectedCash,
        cashDifference,

        // Additional data
        topProducts: topProducts as any,
        staffPerformance: cashMovements.map((m) => ({
          type: m.type,
          amount: m.amount,
          reason: m.reason,
          performedBy: `${m.user.firstName} ${m.user.lastName}`,
          timestamp: m.createdAt,
        })) as any,

        notes,
      },
    });

    return report;
  }

  /**
   * Get all Z-Reports for a tenant
   */
  async findAll(tenantId: string, query: { page?: number; limit?: number; startDate?: string; endDate?: string }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (query.startDate || query.endDate) {
      where.reportDate = {};
      if (query.startDate) {
        where.reportDate.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.reportDate.lte = new Date(query.endDate);
      }
    }

    const [reports, total] = await Promise.all([
      this.prisma.zReport.findMany({
        where,
        skip,
        take: limit,
        orderBy: { reportDate: 'desc' },
      }),
      this.prisma.zReport.count({ where }),
    ]);

    return {
      data: reports,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a specific Z-Report
   */
  async findOne(id: string, tenantId: string) {
    const report = await this.prisma.zReport.findFirst({
      where: { id, tenantId },
    });

    if (!report) {
      throw new NotFoundException('Z-Report not found');
    }

    return report;
  }

  /**
   * Generate PDF for Z-Report
   */
  async generatePdf(id: string, tenantId: string): Promise<Buffer> {
    const report = await this.findOne(id, tenantId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).text('Z-REPORT', { align: 'center' });
      doc.fontSize(12).text(tenant.name, { align: 'center' });
      doc.moveDown();

      doc.fontSize(12).text(`Report Number: ${report.reportNumber}`);
      doc.text(`Date: ${report.reportDate.toLocaleDateString()}`);
      doc.text(`Generated: ${report.createdAt.toLocaleString()}`);
      doc.moveDown();

      // Get currency symbol
      const currencySymbol = CURRENCY_SYMBOLS[tenant.currency] || '$';

      // Sales Summary
      doc.fontSize(14).text('Sales Summary', { underline: true });
      doc.fontSize(10);
      doc.text(`Total Orders: ${report.totalOrders}`);
      doc.text(`Total Sales: ${currencySymbol}${report.totalSales.toFixed(2)}`);
      doc.text(`Discounts: ${currencySymbol}${report.totalDiscount.toFixed(2)}`);
      doc.text(`Net Sales: ${currencySymbol}${report.netSales.toFixed(2)}`);
      doc.moveDown();

      // Payment Methods
      doc.fontSize(14).text('Payment Methods', { underline: true });
      doc.fontSize(10);
      doc.text(`Cash: ${currencySymbol}${report.cashPayments.toFixed(2)}`);
      doc.text(`Card: ${currencySymbol}${report.cardPayments.toFixed(2)}`);
      doc.text(`Digital: ${currencySymbol}${report.digitalPayments.toFixed(2)}`);
      doc.moveDown();

      // Cash Drawer
      doc.fontSize(14).text('Cash Drawer Reconciliation', { underline: true });
      doc.fontSize(10);
      doc.text(`Opening Balance: ${currencySymbol}${report.openingCash.toFixed(2)}`);
      doc.text(`Cash Sales: ${currencySymbol}${report.cashPayments.toFixed(2)}`);
      doc.text(`Expected Cash: ${currencySymbol}${report.expectedCash.toFixed(2)}`);
      doc.text(`Actual Cash: ${currencySymbol}${report.countedCash.toFixed(2)}`);
      doc.text(`Difference: ${currencySymbol}${report.cashDifference.toFixed(2)}`, {
        continued: true,
      });

      const cashDiff = Number(report.cashDifference);
      if (cashDiff !== 0) {
        doc.fillColor(cashDiff > 0 ? 'green' : 'red')
          .text(` (${cashDiff > 0 ? 'Over' : 'Short'})`)
          .fillColor('black');
      }
      doc.moveDown();

      // Notes
      if (report.notes) {
        doc.fontSize(14).text('Notes', { underline: true });
        doc.fontSize(10).text(report.notes);
        doc.moveDown();
      }

      // Footer
      doc.fontSize(8)
        .text(`Generated by ${tenant.name} POS System`, { align: 'center' })
        .text(`Report ID: ${report.id}`, { align: 'center' });

      doc.end();
    });
  }

  /**
   * Close (finalize) a Z-Report
   */
  async closeReport(id: string, tenantId: string) {
    const report = await this.findOne(id, tenantId);

    // Check if report is already exported (indicates it's finalized)
    if (report.pdfExported) {
      throw new BadRequestException('Report is already finalized');
    }

    // Mark report as exported/finalized
    return this.prisma.zReport.update({
      where: { id },
      data: {
        pdfExported: true,
        excelExported: true,
      },
    });
  }

  /**
   * Send Z-Report via email
   */
  async sendReportEmail(
    id: string,
    tenantId: string,
    toEmails?: string[],
  ): Promise<{ success: boolean; message: string }> {
    const report = await this.findOne(id, tenantId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Get user who closed the report
    const closedBy = await this.prisma.user.findUnique({
      where: { id: report.closedById },
      select: { firstName: true, lastName: true },
    });

    // Determine recipients
    const recipients = toEmails?.length ? toEmails : tenant.reportEmails || [];

    if (recipients.length === 0) {
      throw new BadRequestException(
        'No email recipients configured. Please add email addresses in tenant settings or provide them explicitly.',
      );
    }

    // Get currency symbol
    const currencySymbol = CURRENCY_SYMBOLS[tenant.currency] || '$';

    // Parse top products from JSON
    const topProducts = (report.topProducts as any[]) || [];

    // Calculate cash difference details
    const cashDiff = Number(report.cashDifference);
    const isNegativeDifference = cashDiff < 0;
    const isPositiveDifference = cashDiff > 0;
    const cashDifferenceClass = isNegativeDifference ? 'danger' : isPositiveDifference ? 'warning' : '';

    // Format the email context
    const emailContext = {
      restaurantName: tenant.name,
      reportNumber: report.reportNumber,
      reportDate: format(new Date(report.reportDate), 'MMMM dd, yyyy'),
      closingTime: format(new Date(report.closingTime), 'HH:mm'),
      closedByName: closedBy ? `${closedBy.firstName} ${closedBy.lastName}` : 'System',
      currencySymbol,

      // Sales summary
      totalSales: Number(report.totalSales).toFixed(2),
      totalDiscount: Number(report.totalDiscount).toFixed(2),
      totalRefunds: Number(report.totalRefunds).toFixed(2),
      netSales: Number(report.netSales).toFixed(2),
      totalOrders: report.totalOrders,

      // Order types
      dineInSales: Number(report.dineInSales).toFixed(2),
      dineInOrders: report.dineInOrders,
      takeawaySales: Number(report.takeawaySales).toFixed(2),
      takeawayOrders: report.takeawayOrders,
      deliverySales: Number(report.deliverySales).toFixed(2),
      deliveryOrders: report.deliveryOrders,

      // Payment methods
      cashPayments: Number(report.cashPayments).toFixed(2),
      cashPaymentCount: report.cashPaymentCount,
      cardPayments: Number(report.cardPayments).toFixed(2),
      cardPaymentCount: report.cardPaymentCount,
      digitalPayments: Number(report.digitalPayments).toFixed(2),
      digitalPaymentCount: report.digitalPaymentCount,

      // Cash drawer
      openingCash: Number(report.openingCash).toFixed(2),
      expectedCash: Number(report.expectedCash).toFixed(2),
      countedCash: Number(report.countedCash).toFixed(2),
      cashInOut: Number(report.cashInOut).toFixed(2),
      cashDifference: cashDiff.toFixed(2),
      cashDifferenceAbs: Math.abs(cashDiff).toFixed(2),
      cashDifferenceClass,
      isNegativeDifference,
      isPositiveDifference,

      // Cancelled orders
      cancelledOrders: report.cancelledOrders,
      cancelledOrdersAmount: Number(report.cancelledOrdersAmount).toFixed(2),

      // Top products
      topProducts: topProducts.slice(0, 5).map((p: any) => ({
        name: p.name || p.productName,
        quantity: p.quantity,
        revenue: Number(p.revenue).toFixed(2),
      })),

      currentYear: new Date().getFullYear(),
    };

    try {
      // Send email to all recipients
      const success = await this.emailService.sendEmail({
        to: recipients.join(', '),
        subject: `Z-Report Summary - ${format(new Date(report.reportDate), 'MMM dd, yyyy')} - ${tenant.name}`,
        template: 'z-report-summary',
        context: emailContext,
      });

      // Update report with email status
      await this.prisma.zReport.update({
        where: { id },
        data: {
          emailSent: success,
          emailSentAt: success ? new Date() : null,
          emailRecipients: recipients,
          emailError: success ? null : 'Failed to send email',
        },
      });

      if (success) {
        this.logger.log(`Z-Report email sent successfully to ${recipients.join(', ')}`);
        return { success: true, message: `Email sent successfully to ${recipients.length} recipient(s)` };
      } else {
        return { success: false, message: 'Failed to send email. Please check email configuration.' };
      }
    } catch (error) {
      this.logger.error(`Failed to send Z-Report email: ${error.message}`);

      // Update report with error
      await this.prisma.zReport.update({
        where: { id },
        data: {
          emailError: error.message,
        },
      });

      return { success: false, message: `Failed to send email: ${error.message}` };
    }
  }

  /**
   * Generate and send Z-Report for a tenant (used by scheduler)
   */
  async generateAndSendReport(tenantId: string, userId: string): Promise<{ reportId: string; emailSent: boolean }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if report already exists for today
    const existing = await this.prisma.zReport.findFirst({
      where: {
        tenantId,
        reportDate: today,
      },
    });

    let report;

    if (existing) {
      report = existing;
    } else {
      // Generate report for today with default values
      report = await this.generateReport(tenantId, userId, {
        reportDate: today.toISOString(),
        cashDrawerOpening: 0,
        cashDrawerClosing: 0,
        notes: 'Auto-generated end-of-day report',
      });
    }

    // Send email if configured
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    let emailSent = false;

    if (tenant?.reportEmailEnabled && tenant.reportEmails?.length > 0) {
      const result = await this.sendReportEmail(report.id, tenantId);
      emailSent = result.success;
    }

    return { reportId: report.id, emailSent };
  }
}
