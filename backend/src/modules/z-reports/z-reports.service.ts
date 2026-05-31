import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/services/email.service';
import { getTenantDayBounds, getTenantMidnight } from '../../common/helpers/timezone.helper';
import { CreateZReportDto } from './dto/create-z-report.dto';
import { paginated } from '../../common/pagination';
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
   * Generate a Z-Report for end-of-day reconciliation.
   *
   * v3.0.0: `branchId` is now a NOT-NULL column on ZReport (schema-strict
   * branch scoping). The controller passes `scope.branchId` from
   * `@CurrentScope()`; the scheduler resolves it from the tenant's first
   * active branch (or the acting admin's primary branch) before calling.
   */
  async generateReport(tenantId: string, branchId: string, userId: string, createDto: CreateZReportDto) {
    const { reportDate, cashDrawerOpening, cashDrawerClosing, notes } = createDto;

    // Check if report already exists for this date
    const existing = await this.prisma.zReport.findFirst({
      where: {
        tenantId,
        branchId,
        reportDate: new Date(reportDate),
      },
    });

    if (existing) {
      throw new BadRequestException('Z-Report already exists for this date');
    }

    // Tenant-local day bounds. Uses the shared helper (same as the
    // scheduler) so a tenant in Istanbul doesn't miss 23:00-00:00 when
    // the API pod runs in UTC. Half-open interval [start, end) avoids
    // the prior `.999` fudge.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true, currency: true },
    });
    const tz = tenant?.timezone || 'UTC';
    const dateStr = new Date(reportDate).toISOString().slice(0, 10);
    const { start: startOfDay, end: endOfDay } = getTenantDayBounds(dateStr, tz);

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        paidAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
        status: 'PAID',
      },
      include: {
        payments: true,
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
        orderItems: {
          include: {
            product: {
              include: { category: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    // v2.8.97 — all money math now goes through Prisma.Decimal so
    // IEEE-754 drift can't accumulate over high-volume tenants
    // (~1000+ orders/day) where Number additions silently round.
    // The final fields are stored as Decimal columns anyway, so
    // converting at the end is the only place precision crosses
    // the boundary back to JS Number.
    const decSum = <T,>(items: T[], pick: (item: T) => Prisma.Decimal | number | string | null | undefined): Prisma.Decimal =>
      items.reduce(
        (acc, item) => acc.add(new Prisma.Decimal(pick(item) ?? 0)),
        new Prisma.Decimal(0),
      );

    // Calculate totals
    const totalOrders = orders.length;
    const grossSales = decSum(orders, (o) => o.totalAmount);
    const discounts = decSum(orders, (o) => o.discount);
    const rawNetSales = decSum(orders, (o) => o.finalAmount);

    // Calculate payment method breakdown (only COMPLETED payments)
    const allPayments = orders.flatMap((o) => o.payments).filter((p) => p.status === 'COMPLETED');

    const cashPaymentsList = allPayments.filter((p) => p.method === 'CASH');
    const cashPayments = decSum(cashPaymentsList, (p) => p.amount);
    const cashPaymentCount = cashPaymentsList.length;

    const cardPaymentsList = allPayments.filter((p) => p.method === 'CARD');
    const cardPayments = decSum(cardPaymentsList, (p) => p.amount);
    const cardPaymentCount = cardPaymentsList.length;

    const digitalPaymentsList = allPayments.filter((p) => p.method === 'DIGITAL');
    const digitalPayments = decSum(digitalPaymentsList, (p) => p.amount);
    const digitalPaymentCount = digitalPaymentsList.length;

    // Calculate refunds
    const refundedPayments = orders.flatMap((o) => o.payments).filter((p) => p.status === 'REFUNDED');
    const refundedAmount = decSum(refundedPayments, (p) => p.amount);
    const totalRefunds = refundedAmount;

    // Net sales accounts for refunds
    const netSales = rawNetSales.sub(totalRefunds);

    // Order type breakdown
    const dineInOrders = orders.filter((o) => o.type === 'DINE_IN');
    const dineInSales = decSum(dineInOrders, (o) => o.finalAmount);

    const takeawayOrders = orders.filter((o) => o.type === 'TAKEAWAY');
    const takeawaySales = decSum(takeawayOrders, (o) => o.finalAmount);

    const deliveryOrders = orders.filter((o) => o.type === 'DELIVERY');
    const deliverySales = decSum(deliveryOrders, (o) => o.finalAmount);

    const counterOrders = orders.filter((o) => o.type === 'COUNTER');
    const counterSales = decSum(counterOrders, (o) => o.finalAmount);

    // Cancelled orders that *closed* during the reporting day. Originally
    // this filtered on createdAt — but PAID orders use paidAt (the event
    // time), so the two halves of the report disagreed on what "today"
    // means (a 23:58 order cancelled at 00:03 leaked into the prior day's
    // cancellation count). Now we use cancelledAt, falling back to
    // createdAt for legacy rows written before the column existed so
    // historical numbers don't suddenly drop to zero.
    const cancelledOrdersList = await this.prisma.order.findMany({
      where: {
        tenantId,
        status: 'CANCELLED',
        OR: [
          { cancelledAt: { gte: startOfDay, lt: endOfDay } },
          { cancelledAt: null, createdAt: { gte: startOfDay, lt: endOfDay } },
        ],
      },
      select: {
        totalAmount: true,
      },
    });
    const cancelledOrders = cancelledOrdersList.length;
    const cancelledOrdersAmount = decSum(cancelledOrdersList, (o) => o.totalAmount);

    // Get top selling products — Decimal accumulation, number on output.
    const productDecSales = new Map<string, { name: string; quantity: number; revenue: Prisma.Decimal }>();
    orders.forEach((order) => {
      order.orderItems.forEach((item) => {
        let existing = productDecSales.get(item.productId);
        if (!existing) {
          existing = { name: item.product.name, quantity: 0, revenue: new Prisma.Decimal(0) };
          productDecSales.set(item.productId, existing);
        }
        existing.quantity += item.quantity;
        existing.revenue = existing.revenue.add(new Prisma.Decimal(item.subtotal));
      });
    });

    const topProducts = Array.from(productDecSales.values())
      .map((p) => ({ name: p.name, quantity: p.quantity, revenue: p.revenue.toDecimalPlaces(2).toNumber() }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Tax breakdown from order items (Decimal arithmetic — same
    // accumulation-precision reason as the sale totals above).
    const allOrderItems = orders.flatMap(o => o.orderItems);
    const taxBreakdownDecMap = new Map<number, { taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal }>();
    let totalTaxDec = new Prisma.Decimal(0);

    for (const item of allOrderItems) {
      const rate = item.taxRate ?? 10;
      const tax = new Prisma.Decimal(item.taxAmount || 0);
      const subtotalDec = new Prisma.Decimal(item.subtotal || 0);
      let bucket = taxBreakdownDecMap.get(rate);
      if (!bucket) {
        bucket = { taxableAmount: new Prisma.Decimal(0), taxAmount: new Prisma.Decimal(0) };
        taxBreakdownDecMap.set(rate, bucket);
      }
      bucket.taxAmount = bucket.taxAmount.add(tax);
      bucket.taxableAmount = bucket.taxableAmount.add(subtotalDec.sub(tax));
      totalTaxDec = totalTaxDec.add(tax);
    }
    // Storage shape stays {number → {taxableAmount: number, taxAmount: number}}
    // for backward compat with downstream consumers.
    const taxBreakdownMap: Record<number, { taxableAmount: number; taxAmount: number }> = {};
    for (const [rate, b] of taxBreakdownDecMap) {
      taxBreakdownMap[rate] = {
        taxableAmount: b.taxableAmount.toDecimalPlaces(2).toNumber(),
        taxAmount: b.taxAmount.toDecimalPlaces(2).toNumber(),
      };
    }
    const totalTax = totalTaxDec.toDecimalPlaces(2).toNumber();

    // v2.8.99 — only APPROVED cash drawer movements count toward
    // reconciliation. DRAFT rows are CASH_OUT or ADJUSTMENT entries
    // awaiting manager approval; including them would skew the
    // expected-cash sum before a manager has signed off. REJECTED
    // rows are explicitly excluded.
    const cashMovements = await this.prisma.cashDrawerMovement.findMany({
      where: {
        tenantId,
        approvalStatus: 'APPROVED',
        createdAt: {
          gte: startOfDay,
          lt: endOfDay,
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

    // Calculate cash in/out movements (Decimal)
    const cashInTotal = decSum(
      cashMovements.filter((m) => m.type === 'CASH_IN'),
      (m) => m.amount,
    );
    const cashOutTotal = decSum(
      cashMovements.filter((m) => m.type === 'CASH_OUT'),
      (m) => m.amount,
    );
    const cashInOut = cashInTotal.sub(cashOutTotal);

    // Cash drawer reconciliation. cashDrawerOpening / cashDrawerClosing
    // arrive as JS numbers from the closing DTO; coerce through Decimal
    // before adding so the final reconciliation row is precision-clean.
    const openingDec = new Prisma.Decimal(cashDrawerOpening);
    const closingDec = new Prisma.Decimal(cashDrawerClosing);
    const expectedCash = openingDec.add(cashPayments).add(cashInOut);
    const cashDifference = closingDec.sub(expectedCash);

    // Calculate staff performance — Decimal accumulation, number on
    // the JSON output (staffPerformance is read by reporting UIs that
    // expect plain numbers).
    const staffDecMap = new Map<string, { name: string; sales: Prisma.Decimal; orders: number; refunds: number }>();
    for (const order of orders) {
      const staffId = order.userId || 'unknown';
      const staffName = order.user ? `${order.user.firstName} ${order.user.lastName}` : 'Unknown';
      let existing = staffDecMap.get(staffId);
      if (!existing) {
        existing = { name: staffName, sales: new Prisma.Decimal(0), orders: 0, refunds: 0 };
        staffDecMap.set(staffId, existing);
      }
      existing.sales = existing.sales.add(new Prisma.Decimal(order.finalAmount));
      existing.orders += 1;
    }
    const staffPerformance = Array.from(staffDecMap.entries()).map(([id, data]) => ({
      staffId: id,
      name: data.name,
      sales: data.sales.toDecimalPlaces(2).toNumber(),
      orders: data.orders,
      refunds: data.refunds,
    }));

    // Calculate open (unfulfilled) orders
    const openOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        createdAt: { gte: startOfDay, lt: endOfDay },
        status: { notIn: ['PAID', 'CANCELLED'] },
      },
      select: { finalAmount: true },
    });
    const openChecks = openOrders.length;
    const openChecksAmount = decSum(openOrders, (o) => o.finalAmount);

    // Calculate category breakdown — Decimal accumulation as above.
    const categoryDecMap = new Map<string, { categoryName: string; sales: Prisma.Decimal; quantity: number }>();
    for (const order of orders) {
      for (const item of order.orderItems) {
        const catId = item.product.categoryId;
        const catName = item.product.category?.name || 'Uncategorized';
        let existing = categoryDecMap.get(catId);
        if (!existing) {
          existing = { categoryName: catName, sales: new Prisma.Decimal(0), quantity: 0 };
          categoryDecMap.set(catId, existing);
        }
        existing.sales = existing.sales.add(new Prisma.Decimal(item.subtotal));
        existing.quantity += item.quantity;
      }
    }
    const categoryBreakdown = Array.from(categoryDecMap.entries()).map(([id, data]) => ({
      categoryId: id,
      categoryName: data.categoryName,
      sales: data.sales.toDecimalPlaces(2).toNumber(),
      quantity: data.quantity,
    }));

    // Create the Z-Report. The `findFirst` above is a fast-path dedupe;
    // the schema has `@@unique([tenantId, reportNumber])` and the report
    // number is deterministic per `(tenant, reportDate)`, so a concurrent
    // second generate surfaces as P2002 here — translate it to the same
    // "already exists" business error rather than a raw 500.
    let report;
    try {
      report = await this.prisma.zReport.create({
      data: {
        tenantId,
        branchId,
        reportDate: new Date(reportDate),
        reportNumber: `Z-${new Date(reportDate).toISOString().slice(0, 10).replace(/-/g, '')}`,
        closedById: userId,

        // Sales data
        totalOrders,
        totalSales: grossSales,
        totalDiscount: discounts,
        netSales,
        totalTax,
        taxBreakdown: taxBreakdownMap,

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

        // Refund data
        totalRefunds,
        refundedPayments: refundedPayments.length,
        refundedAmount,

        // Cash drawer
        openingCash: cashDrawerOpening,
        countedCash: cashDrawerClosing,
        expectedCash,
        cashDifference,
        cashInOut,

        // Open checks
        openChecks,
        openChecksAmount,

        // Additional data
        topProducts: topProducts as any,
        categoryBreakdown: categoryBreakdown as any,
        staffPerformance: staffPerformance as any,

        notes,
      },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('Z-Report already exists for this date');
      }
      throw err;
    }

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

    return paginated(reports, total, page, limit);
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
      doc.text(`Date: ${format(new Date(report.reportDate), 'MMMM dd, yyyy')}`);
      doc.text(`Generated: ${format(new Date(report.createdAt), 'MMMM dd, yyyy HH:mm')}`);
      doc.moveDown();

      // Get currency symbol
      const currencySymbol = CURRENCY_SYMBOLS[tenant.currency] || '$';

      // Sales Summary
      doc.fontSize(14).text('Sales Summary', { underline: true });
      doc.fontSize(10);
      doc.text(`Total Orders: ${report.totalOrders}`);
      doc.text(`Total Sales: ${currencySymbol}${Number(report.totalSales).toFixed(2)}`);
      doc.text(`Discounts: ${currencySymbol}${Number(report.totalDiscount).toFixed(2)}`);
      doc.text(`Net Sales: ${currencySymbol}${Number(report.netSales).toFixed(2)}`);
      doc.moveDown();

      // Payment Methods
      doc.fontSize(14).text('Payment Methods', { underline: true });
      doc.fontSize(10);
      doc.text(`Cash: ${currencySymbol}${Number(report.cashPayments).toFixed(2)}`);
      doc.text(`Card: ${currencySymbol}${Number(report.cardPayments).toFixed(2)}`);
      doc.text(`Digital: ${currencySymbol}${Number(report.digitalPayments).toFixed(2)}`);
      doc.moveDown();

      // Cash Drawer
      doc.fontSize(14).text('Cash Drawer Reconciliation', { underline: true });
      doc.fontSize(10);
      doc.text(`Opening Balance: ${currencySymbol}${Number(report.openingCash).toFixed(2)}`);
      doc.text(`Cash Sales: ${currencySymbol}${Number(report.cashPayments).toFixed(2)}`);
      doc.text(`Expected Cash: ${currencySymbol}${Number(report.expectedCash).toFixed(2)}`);
      doc.text(`Actual Cash: ${currencySymbol}${Number(report.countedCash).toFixed(2)}`);
      doc.text(`Difference: ${currencySymbol}${Number(report.cashDifference).toFixed(2)}`, {
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
   * Close (finalize) a Z-Report. After this succeeds, every writing path
   * must assert isFinalized=false before mutating fiscal totals. A SHA-256
   * payload hash is stored for tamper-detection audit. The conditional
   * updateMany on isFinalized=false ensures two concurrent close clicks
   * can't both win.
   */
  async closeReport(id: string, tenantId: string, userId?: string) {
    const report = await this.findOne(id, tenantId);
    if ((report as any).isFinalized) {
      throw new BadRequestException('Report is already finalized');
    }
    // Legacy pdfExported flag — keep the check during migration so we
    // don't finalize a row that was already informally sealed.
    if (report.pdfExported && !(report as any).isFinalized) {
      // pdfExported alone is not a real finalization — upgrade it.
    }

    const payloadHash = this.computePayloadHash(report);

    const result = await this.prisma.zReport.updateMany({
      where: { id, tenantId, isFinalized: false },
      data: {
        isFinalized: true,
        finalizedAt: new Date(),
        finalizedById: userId ?? null,
        payloadHash,
        pdfExported: true,
        excelExported: true,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException('Report was concurrently finalized');
    }
    return this.findOne(id, tenantId);
  }

  /**
   * Canonical sha256 over the fiscal-critical fields. Sorted-key JSON so
   * the digest is stable across Prisma return-object property order
   * changes. If audit re-runs compute this hash over the row's current
   * state, any post-finalization tampering shows up as a mismatch.
   */
  private computePayloadHash(report: any): string {
    const payload = {
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
    };
    const canonical = JSON.stringify(
      Object.keys(payload).sort().reduce((acc, k) => {
        (acc as any)[k] = (payload as any)[k];
        return acc;
      }, {} as Record<string, unknown>),
    );
    return createHash('sha256').update(canonical).digest('hex');
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

      // Update report with email status — compound WHERE IDOR guard
      // (B41-B45 pattern). `closeReport` already uses updateMany with
      // tenant scoping; this email-status write must match.
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
   * Generate and send Z-Report for a tenant (used by scheduler).
   *
   * v3.0.0: `branchId` is required — the scheduler resolves it per
   * tenant before invoking (each branch closes independently for fiscal
   * purposes, so the scheduler iterates branches, not just tenants).
   */
  async generateAndSendReport(tenantId: string, branchId: string, userId: string): Promise<{ reportId: string; emailSent: boolean }> {
    // Tenant timezone matters: a TR restaurant closing at 23:00 TR with
    // the API pod in UTC needs "today" to mean "the TR calendar date
    // we're currently in", not "the UTC calendar date the server is in".
    // The earlier code used `today.setHours(0,0,0,0)` which gave SERVER-
    // local midnight — for a UTC container with a TR tenant this saved
    // reportDate as one UTC instant while the scheduler's "already
    // sent?" check searched for a different (tenant-local-midnight)
    // instant. Result: the scheduler re-entered generate every 15 min
    // during the closing window, each time hitting the service's own
    // dedup throw, polluting logs. Same getTenantMidnight helper the
    // scheduler uses keeps the two sides in lockstep.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    const tz = tenant?.timezone || 'UTC';
    const today = getTenantMidnight(new Date(), tz);

    // Check if report already exists for today
    const existing = await this.prisma.zReport.findFirst({
      where: {
        tenantId,
        branchId,
        reportDate: today,
      },
    });

    let report;

    if (existing) {
      report = existing;
    } else {
      // Generate report for today with default values
      report = await this.generateReport(tenantId, branchId, userId, {
        reportDate: today.toISOString(),
        cashDrawerOpening: 0,
        cashDrawerClosing: 0,
        notes: 'Auto-generated end-of-day report',
      });
    }

    let emailSent = false;

    if (tenant?.reportEmailEnabled && tenant.reportEmails?.length > 0) {
      const result = await this.sendReportEmail(report.id, tenantId);
      emailSent = result.success;
    }

    return { reportId: report.id, emailSent };
  }
}
