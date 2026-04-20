import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { format } from 'date-fns';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/services/email.service';
import { CreateZReportDto } from './dto/create-z-report.dto';

const CURRENCY_SYMBOLS: Record<string, string> = {
  TRY: '₺',
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'C$',
  AUD: 'A$',
};

const ACTIVE_OPEN_ORDER_STATUSES = ['PENDING', 'PREPARING', 'READY', 'SERVED'] as const;

@Injectable()
export class ZReportsService {
  private readonly logger = new Logger(ZReportsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async generateReport(
    tenantId: string,
    userId: string,
    createDto: CreateZReportDto,
    options: { systemGenerated?: boolean } = {},
  ) {
    const { reportDate, cashDrawerOpening, cashDrawerClosing, notes } = createDto;
    const systemGenerated = options.systemGenerated === true;

    // Day boundaries are computed in the tenant's timezone so a UTC server
    // reporting a tenant's "today" doesn't include orders from the last
    // 3 hours of the prior local day (or drop the first 3 hours of the
    // current local day). Falls back to UTC if tenant has no timezone set.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const timezone = tenant?.timezone || 'UTC';
    const { startOfDay, endOfDay } = this.computeDayBoundsInTimezone(
      reportDate,
      timezone,
    );

    const reportNumber = `Z-${this.yyyymmddInTimezone(reportDate, timezone)}`;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.zReport.findFirst({
            where: { tenantId, reportDate: startOfDay },
            select: { id: true },
          });
          if (existing) {
            throw new BadRequestException('Z-Report already exists for this date');
          }

          const orders = await tx.order.findMany({
            where: {
              tenantId,
              createdAt: { gte: startOfDay, lte: endOfDay },
              status: 'PAID',
            },
            include: {
              payments: true,
              orderItems: { include: { product: true } },
            },
          });

          const totalOrders = orders.length;
          let grossSales = new Prisma.Decimal(0);
          let discounts = new Prisma.Decimal(0);
          let netSales = new Prisma.Decimal(0);
          for (const order of orders) {
            grossSales = grossSales.add(order.totalAmount);
            discounts = discounts.add(order.discount);
            netSales = netSales.add(order.finalAmount);
          }

          // Only COMPLETED payments count toward cash/card/digital totals.
          // REFUNDED and FAILED payments are tracked separately so the cash-
          // drawer reconciliation does not over-predict cash on hand.
          const completedPayments = orders
            .flatMap((o) => o.payments)
            .filter((p) => p.status === 'COMPLETED');
          const refundedPaymentsList = orders
            .flatMap((o) => o.payments)
            .filter((p) => p.status === 'REFUNDED');

          const sumBy = (list: typeof completedPayments, method: string) =>
            list
              .filter((p) => p.method === method)
              .reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0));

          const cashPayments = sumBy(completedPayments, 'CASH');
          const cardPayments = sumBy(completedPayments, 'CARD');
          const digitalPayments = sumBy(completedPayments, 'DIGITAL');
          const cashPaymentCount = completedPayments.filter((p) => p.method === 'CASH').length;
          const cardPaymentCount = completedPayments.filter((p) => p.method === 'CARD').length;
          const digitalPaymentCount = completedPayments.filter((p) => p.method === 'DIGITAL').length;

          const refundedAmount = refundedPaymentsList.reduce(
            (sum, p) => sum.add(p.amount),
            new Prisma.Decimal(0),
          );

          const ordersByType = (type: string) => orders.filter((o) => o.type === type);
          const sumFinal = (list: typeof orders) =>
            list.reduce((sum, o) => sum.add(o.finalAmount), new Prisma.Decimal(0));

          const dineInOrders = ordersByType('DINE_IN');
          const takeawayOrders = ordersByType('TAKEAWAY');
          const deliveryOrders = ordersByType('DELIVERY');

          const cancelledOrdersList = await tx.order.findMany({
            where: {
              tenantId,
              createdAt: { gte: startOfDay, lte: endOfDay },
              status: 'CANCELLED',
            },
            select: { totalAmount: true },
          });
          const cancelledOrdersAmount = cancelledOrdersList.reduce(
            (sum, o) => sum.add(o.totalAmount),
            new Prisma.Decimal(0),
          );

          // Open-checks: orders still in an active lifecycle status at the
          // moment the report is generated. A non-zero value here signals
          // that the day isn't legitimately closeable yet.
          const openChecksAgg = await tx.order.aggregate({
            where: {
              tenantId,
              createdAt: { gte: startOfDay, lte: endOfDay },
              status: { in: [...ACTIVE_OPEN_ORDER_STATUSES] },
            },
            _count: { _all: true },
            _sum: { finalAmount: true },
          });
          const openChecks = openChecksAgg._count._all;
          const openChecksAmount = openChecksAgg._sum.finalAmount
            ? new Prisma.Decimal(openChecksAgg._sum.finalAmount)
            : new Prisma.Decimal(0);

          // For scheduler-generated reports we don't have real counted
          // cash in the drawer — so we zero out the opening/closing/
          // difference rather than writing a phantom shortage equal to
          // the full day's cash takings. Human admins must close the
          // day manually to populate these fields with real numbers;
          // until then the report is an informational snapshot.
          const opening = systemGenerated
            ? new Prisma.Decimal(0)
            : new Prisma.Decimal(cashDrawerOpening);
          const closing = systemGenerated
            ? new Prisma.Decimal(0)
            : new Prisma.Decimal(cashDrawerClosing);
          const expectedCash = systemGenerated
            ? new Prisma.Decimal(0)
            : opening.add(cashPayments);
          const cashDifference = systemGenerated
            ? new Prisma.Decimal(0)
            : closing.sub(expectedCash);

          const productSales = new Map<
            string,
            { name: string; quantity: number; revenue: Prisma.Decimal }
          >();
          for (const order of orders) {
            for (const item of order.orderItems) {
              const existingProd = productSales.get(item.productId) || {
                name: item.product.name,
                quantity: 0,
                revenue: new Prisma.Decimal(0),
              };
              existingProd.quantity += item.quantity;
              existingProd.revenue = existingProd.revenue.add(item.subtotal);
              productSales.set(item.productId, existingProd);
            }
          }
          const topProducts = Array.from(productSales.values())
            .sort((a, b) => b.revenue.comparedTo(a.revenue))
            .slice(0, 10)
            .map((p) => ({
              name: p.name,
              quantity: p.quantity,
              revenue: p.revenue.toString(),
            }));

          const cashMovements = await tx.cashDrawerMovement.findMany({
            where: {
              tenantId,
              createdAt: { gte: startOfDay, lte: endOfDay },
            },
            include: {
              user: {
                select: { firstName: true, lastName: true, email: true },
              },
            },
          });

          return tx.zReport.create({
            data: {
              tenantId,
              reportDate: startOfDay,
              reportNumber,
              closedById: userId,
              systemGenerated,
              closingType: systemGenerated ? 'AUTOMATIC' : 'MANUAL',

              totalOrders,
              totalSales: grossSales,
              totalDiscount: discounts,
              totalRefunds: refundedAmount,
              netSales,

              cashPayments,
              cashPaymentCount,
              cardPayments,
              cardPaymentCount,
              digitalPayments,
              digitalPaymentCount,

              dineInSales: sumFinal(dineInOrders),
              dineInOrders: dineInOrders.length,
              takeawaySales: sumFinal(takeawayOrders),
              takeawayOrders: takeawayOrders.length,
              deliverySales: sumFinal(deliveryOrders),
              deliveryOrders: deliveryOrders.length,

              cancelledOrders: cancelledOrdersList.length,
              cancelledOrdersAmount,
              refundedPayments: refundedPaymentsList.length,
              refundedAmount,

              openChecks,
              openChecksAmount,

              openingCash: opening,
              countedCash: closing,
              expectedCash,
              cashDifference,

              topProducts: topProducts as any,
              staffPerformance: cashMovements.map((m) => ({
                type: m.type,
                amount: m.amount.toString(),
                reason: m.reason,
                performedBy: `${m.user.firstName} ${m.user.lastName}`,
                timestamp: m.createdAt,
              })) as any,

              notes,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      // Translate the Prisma unique-constraint race (two concurrent closes
      // for the same day) into a friendly 400 instead of a 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('Z-Report already exists for this date');
      }
      throw err;
    }
  }

  async findAll(
    tenantId: string,
    query: { page?: number; limit?: number; startDate?: string; endDate?: string },
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.ZReportWhereInput = { tenantId };
    if (query.startDate || query.endDate) {
      where.reportDate = {};
      if (query.startDate) (where.reportDate as any).gte = new Date(query.startDate);
      if (query.endDate) (where.reportDate as any).lte = new Date(query.endDate);
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

  async findOne(id: string, tenantId: string) {
    const report = await this.prisma.zReport.findFirst({
      where: { id, tenantId },
    });
    if (!report) throw new NotFoundException('Z-Report not found');
    return report;
  }

  async generatePdf(id: string, tenantId: string): Promise<Buffer> {
    const report = await this.findOne(id, tenantId);

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).text('Z-REPORT', { align: 'center' });
      doc.fontSize(12).text(tenant.name, { align: 'center' });
      doc.moveDown();

      doc.fontSize(12).text(`Report Number: ${report.reportNumber}`);
      doc.text(`Date: ${report.reportDate.toLocaleDateString()}`);
      doc.text(`Generated: ${report.createdAt.toLocaleString()}`);
      if (report.isFinalized) {
        doc.text(`Finalized: ${report.finalizedAt?.toLocaleString() ?? '-'}`);
        if (report.payloadHash) doc.text(`Hash: ${report.payloadHash}`);
      }
      doc.moveDown();

      const currencySymbol = CURRENCY_SYMBOLS[tenant.currency] || '$';
      const fmt = (v: any) => Number(v).toFixed(2);

      doc.fontSize(14).text('Sales Summary', { underline: true });
      doc.fontSize(10);
      doc.text(`Total Orders: ${report.totalOrders}`);
      doc.text(`Total Sales: ${currencySymbol}${fmt(report.totalSales)}`);
      doc.text(`Discounts: ${currencySymbol}${fmt(report.totalDiscount)}`);
      doc.text(`Refunds: ${currencySymbol}${fmt(report.totalRefunds)}`);
      doc.text(`Net Sales: ${currencySymbol}${fmt(report.netSales)}`);
      if (report.openChecks > 0) {
        doc.fillColor('red')
          .text(`Open Checks: ${report.openChecks} (${currencySymbol}${fmt(report.openChecksAmount)})`)
          .fillColor('black');
      }
      doc.moveDown();

      doc.fontSize(14).text('Payment Methods', { underline: true });
      doc.fontSize(10);
      doc.text(`Cash: ${currencySymbol}${fmt(report.cashPayments)}`);
      doc.text(`Card: ${currencySymbol}${fmt(report.cardPayments)}`);
      doc.text(`Digital: ${currencySymbol}${fmt(report.digitalPayments)}`);
      doc.moveDown();

      doc.fontSize(14).text('Cash Drawer Reconciliation', { underline: true });
      doc.fontSize(10);
      doc.text(`Opening Balance: ${currencySymbol}${fmt(report.openingCash)}`);
      doc.text(`Cash Sales: ${currencySymbol}${fmt(report.cashPayments)}`);
      doc.text(`Expected Cash: ${currencySymbol}${fmt(report.expectedCash)}`);
      doc.text(`Actual Cash: ${currencySymbol}${fmt(report.countedCash)}`);

      const cashDiff = Number(report.cashDifference);
      doc.text(`Difference: ${currencySymbol}${cashDiff.toFixed(2)}`, { continued: true });
      if (cashDiff !== 0) {
        doc.fillColor(cashDiff > 0 ? 'green' : 'red')
          .text(` (${cashDiff > 0 ? 'Over' : 'Short'})`)
          .fillColor('black');
      }
      doc.moveDown();

      if (report.notes) {
        doc.fontSize(14).text('Notes', { underline: true });
        doc.fontSize(10).text(report.notes);
        doc.moveDown();
      }

      doc.fontSize(8)
        .text(`Generated by ${tenant.name} POS System`, { align: 'center' })
        .text(`Report ID: ${report.id}`, { align: 'center' });

      doc.end();
    });
  }

  /**
   * Finalize a Z-Report. After this succeeds every writing path must assert
   * `isFinalized === false` before mutating fiscal totals. A SHA-256 payload
   * hash is stored for tamper-detection audit.
   */
  async closeReport(id: string, tenantId: string, userId: string) {
    const report = await this.findOne(id, tenantId);
    if (report.isFinalized) {
      throw new BadRequestException('Report is already finalized');
    }
    if (report.systemGenerated) {
      // Auto-generated snapshots don't have real cash-drawer numbers;
      // finalizing one would lock in zeroes as the fiscal record. Admin
      // must regenerate via the manual close-of-day flow with actual
      // opening/closing counted cash before finalization is allowed.
      throw new BadRequestException(
        'System-generated reports cannot be finalized. Create a manual close-of-day instead.',
      );
    }

    const payloadHash = this.computePayloadHash(report);

    const result = await this.prisma.zReport.updateMany({
      where: { id, tenantId, isFinalized: false },
      data: {
        isFinalized: true,
        finalizedAt: new Date(),
        finalizedById: userId,
        payloadHash,
        pdfExported: true,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException('Report was concurrently finalized');
    }
    return this.findOne(id, tenantId);
  }

  /**
   * Compute the UTC instants that bound a given local date in a tenant's
   * timezone. "YYYY-MM-DD in Istanbul" maps to the 24-hour window starting
   * at 00:00 Istanbul time (which is 21:00 UTC the previous day) and
   * ending at 23:59:59.999 Istanbul time. Built with Intl.DateTimeFormat
   * to avoid pulling in a TZ library; falls back to server-local on
   * unknown tz strings.
   */
  private computeDayBoundsInTimezone(
    reportDateIso: string,
    timezone: string,
  ): { startOfDay: Date; endOfDay: Date } {
    try {
      const ymd = this.yyyymmddInTimezone(reportDateIso, timezone);
      const year = parseInt(ymd.slice(0, 4), 10);
      const month = parseInt(ymd.slice(4, 6), 10);
      const day = parseInt(ymd.slice(6, 8), 10);

      const startOfDay = this.zonedMoment(year, month, day, 0, 0, 0, timezone);
      const endOfDay = new Date(
        this.zonedMoment(year, month, day, 23, 59, 59, timezone).getTime() + 999,
      );
      return { startOfDay, endOfDay };
    } catch {
      const fallback = new Date(reportDateIso);
      const startOfDay = new Date(fallback);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(fallback);
      endOfDay.setHours(23, 59, 59, 999);
      return { startOfDay, endOfDay };
    }
  }

  /** YYYYMMDD string for a date as rendered in a specific timezone. */
  private yyyymmddInTimezone(iso: string, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(iso));
    const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${y}${m}${d}`;
  }

  /**
   * Resolve a tenant-local wall-clock (year, month, day, hour, minute, second)
   * to the UTC Date that represents that instant. We iterate once because
   * tz offsets can differ by DST around the target date.
   */
  private zonedMoment(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timezone: string,
  ): Date {
    // Approximate via UTC then correct for the zone offset.
    const approx = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(approx);
    const get = (t: string) =>
      parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
    const zonedAsUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    const offset = zonedAsUtc - approx.getTime();
    return new Date(approx.getTime() - offset);
  }

  private computePayloadHash(report: any): string {
    // Canonical subset of fields that matter for audit. Sort keys so the
    // digest is stable across Prisma return-object property order changes.
    const canonical = JSON.stringify(
      {
        reportNumber: report.reportNumber,
        reportDate: report.reportDate,
        totalOrders: report.totalOrders,
        totalSales: report.totalSales?.toString?.() ?? String(report.totalSales),
        totalDiscount: report.totalDiscount?.toString?.() ?? String(report.totalDiscount),
        totalRefunds: report.totalRefunds?.toString?.() ?? String(report.totalRefunds),
        netSales: report.netSales?.toString?.() ?? String(report.netSales),
        cashPayments: report.cashPayments?.toString?.() ?? String(report.cashPayments),
        cardPayments: report.cardPayments?.toString?.() ?? String(report.cardPayments),
        digitalPayments: report.digitalPayments?.toString?.() ?? String(report.digitalPayments),
        openingCash: report.openingCash?.toString?.() ?? String(report.openingCash),
        countedCash: report.countedCash?.toString?.() ?? String(report.countedCash),
        expectedCash: report.expectedCash?.toString?.() ?? String(report.expectedCash),
        cashDifference: report.cashDifference?.toString?.() ?? String(report.cashDifference),
        refundedAmount: report.refundedAmount?.toString?.() ?? String(report.refundedAmount),
        openChecks: report.openChecks,
        openChecksAmount: report.openChecksAmount?.toString?.() ?? String(report.openChecksAmount),
      },
      Object.keys({}).sort(),
    );
    return createHash('sha256').update(canonical).digest('hex');
  }

  async sendReportEmail(
    id: string,
    tenantId: string,
    toEmails?: string[],
  ): Promise<{ success: boolean; message: string }> {
    const report = await this.findOne(id, tenantId);

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const closedBy = await this.prisma.user.findFirst({
      where: { id: report.closedById, tenantId },
      select: { firstName: true, lastName: true },
    });

    const recipients = toEmails?.length ? toEmails : tenant.reportEmails || [];
    if (recipients.length === 0) {
      throw new BadRequestException(
        'No email recipients configured. Please add email addresses in tenant settings or provide them explicitly.',
      );
    }

    const currencySymbol = CURRENCY_SYMBOLS[tenant.currency] || '$';
    const topProducts = (report.topProducts as any[]) || [];
    const cashDiff = Number(report.cashDifference);
    const isNegativeDifference = cashDiff < 0;
    const isPositiveDifference = cashDiff > 0;
    const cashDifferenceClass = isNegativeDifference
      ? 'danger'
      : isPositiveDifference
        ? 'warning'
        : '';
    const fmt = (v: any) => Number(v).toFixed(2);

    const emailContext = {
      restaurantName: tenant.name,
      reportNumber: report.reportNumber,
      reportDate: format(new Date(report.reportDate), 'MMMM dd, yyyy'),
      closingTime: format(new Date(report.closingTime), 'HH:mm'),
      closedByName: closedBy ? `${closedBy.firstName} ${closedBy.lastName}` : 'System',
      currencySymbol,
      totalSales: fmt(report.totalSales),
      totalDiscount: fmt(report.totalDiscount),
      totalRefunds: fmt(report.totalRefunds),
      netSales: fmt(report.netSales),
      totalOrders: report.totalOrders,
      dineInSales: fmt(report.dineInSales),
      dineInOrders: report.dineInOrders,
      takeawaySales: fmt(report.takeawaySales),
      takeawayOrders: report.takeawayOrders,
      deliverySales: fmt(report.deliverySales),
      deliveryOrders: report.deliveryOrders,
      cashPayments: fmt(report.cashPayments),
      cashPaymentCount: report.cashPaymentCount,
      cardPayments: fmt(report.cardPayments),
      cardPaymentCount: report.cardPaymentCount,
      digitalPayments: fmt(report.digitalPayments),
      digitalPaymentCount: report.digitalPaymentCount,
      openingCash: fmt(report.openingCash),
      expectedCash: fmt(report.expectedCash),
      countedCash: fmt(report.countedCash),
      cashInOut: fmt(report.cashInOut),
      cashDifference: cashDiff.toFixed(2),
      cashDifferenceAbs: Math.abs(cashDiff).toFixed(2),
      cashDifferenceClass,
      isNegativeDifference,
      isPositiveDifference,
      cancelledOrders: report.cancelledOrders,
      cancelledOrdersAmount: fmt(report.cancelledOrdersAmount),
      openChecks: report.openChecks,
      openChecksAmount: fmt(report.openChecksAmount),
      refundedPayments: report.refundedPayments,
      refundedAmount: fmt(report.refundedAmount),
      topProducts: topProducts.slice(0, 5).map((p: any) => ({
        name: p.name || p.productName,
        quantity: p.quantity,
        revenue: fmt(p.revenue),
      })),
      currentYear: new Date().getFullYear(),
    };

    try {
      const success = await this.emailService.sendEmail({
        to: recipients.join(', '),
        subject: `Z-Report Summary - ${format(new Date(report.reportDate), 'MMM dd, yyyy')} - ${tenant.name}`,
        template: 'z-report-summary',
        context: emailContext,
      });

      // emailSent / emailError are audit-side-channel fields, not fiscal,
      // so updating them post-finalization is safe. Every fiscal-totals
      // write path is gated by isFinalized elsewhere.
      await this.prisma.zReport.updateMany({
        where: { id, tenantId },
        data: {
          emailSent: success,
          emailSentAt: success ? new Date() : null,
          emailRecipients: recipients,
          emailError: success ? null : 'Failed to send email',
        },
      });

      if (success) {
        this.logger.log(`Z-Report email sent to ${recipients.join(', ')}`);
        return { success: true, message: `Email sent to ${recipients.length} recipient(s)` };
      }
      return { success: false, message: 'Failed to send email. Please check email configuration.' };
    } catch (error: any) {
      this.logger.error(`Failed to send Z-Report email: ${error.message}`);
      await this.prisma.zReport.updateMany({
        where: { id, tenantId },
        data: { emailError: error.message },
      });
      return { success: false, message: `Failed to send email: ${error.message}` };
    }
  }

  async generateAndSendReport(
    tenantId: string,
    userId: string,
  ): Promise<{ reportId: string; emailSent: boolean }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.prisma.zReport.findFirst({
      where: { tenantId, reportDate: today },
    });

    let report = existing;
    if (!report) {
      report = await this.generateReport(
        tenantId,
        userId,
        {
          reportDate: today.toISOString(),
          cashDrawerOpening: 0,
          cashDrawerClosing: 0,
          notes: 'Auto-generated end-of-day report (system-generated; manual close-of-day required for fiscal finalization)',
        },
        { systemGenerated: true },
      );
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    let emailSent = false;
    if (tenant?.reportEmailEnabled && tenant.reportEmails?.length > 0) {
      const result = await this.sendReportEmail(report.id, tenantId);
      emailSent = result.success;
    }

    return { reportId: report.id, emailSent };
  }
}
