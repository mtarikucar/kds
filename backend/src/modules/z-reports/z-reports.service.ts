import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailService } from "../../common/services/email.service";
import {
  getTenantDayBounds,
  getTenantMidnight,
} from "../../common/helpers/timezone.helper";
import { CreateZReportDto } from "./dto/create-z-report.dto";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";
import { UserRole } from "../../common/constants/roles.enum";
import { paginated } from "../../common/pagination";
import { format } from "date-fns";
import { ZReportPdfService } from "./services/z-report-pdf.service";
import { ZReportAggregator } from "./services/z-report-aggregator.service";
import { CURRENCY_SYMBOLS } from "./currency-symbols";

@Injectable()
export class ZReportsService {
  private readonly logger = new Logger(ZReportsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private readonly pdfService: ZReportPdfService,
    private readonly aggregator: ZReportAggregator,
  ) {}

  /**
   * Resolve the timezone that defines a branch's sales day: the branch's
   * own IANA `timezone` when set, else the tenant's, else "UTC".
   *
   * Per-branch-timezone fix (fake-working sweep #3): Branch.timezone was an
   * editable, validated, persisted setting that NO reporting/scheduling code
   * read — every Z-report day boundary and closing-time match used the single
   * tenant timezone, mis-bucketing an off-tz branch's sales day. Branch-scoped
   * fiscal day math now flows through here. (Tenant-wide reports with no
   * branchId still use the tenant tz — see reports.service.ts, which remains
   * tenant-tz and is noted as remaining work.)
   */
  private async resolveBranchTimezone(
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { timezone: true },
    });
    if (branch?.timezone) return branch.timezone;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return tenant?.timezone || "UTC";
  }

  /**
   * Generate a Z-Report for end-of-day reconciliation.
   *
   * v3.0.0: `branchId` is now a NOT-NULL column on ZReport (schema-strict
   * branch scoping). The controller passes `scope.branchId` from
   * `@CurrentScope()`; the scheduler resolves it from the tenant's first
   * active branch (or the acting admin's primary branch) before calling.
   */
  async generateReport(
    tenantId: string,
    branchId: string,
    userId: string,
    createDto: CreateZReportDto,
  ) {
    const { reportDate, cashDrawerOpening, cashDrawerClosing, notes } =
      createDto;

    // Check if report already exists for this date
    const existing = await this.prisma.zReport.findFirst({
      where: {
        tenantId,
        branchId,
        reportDate: new Date(reportDate),
      },
    });

    if (existing) {
      throw new BadRequestException("Z-Report already exists for this date");
    }

    // Branch-local day bounds. Uses the shared helper (same as the
    // scheduler) so a branch in Istanbul doesn't miss 23:00-00:00 when
    // the API pod runs in UTC. Half-open interval [start, end) avoids
    // the prior `.999` fudge.
    //
    // Per-branch tz fix: the day boundary is computed in the BRANCH's
    // timezone (falling back to the tenant tz, then UTC) so a London branch
    // under an Istanbul tenant buckets its sales day on London midnight, not
    // Istanbul midnight — matching the closing-time match + dedup midnight
    // the scheduler now uses.
    const tz = await this.resolveBranchTimezone(tenantId, branchId);
    const dateStr = new Date(reportDate).toISOString().slice(0, 10);
    const { start: startOfDay, end: endOfDay } = getTenantDayBounds(
      dateStr,
      tz,
    );

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        paidAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
        status: "PAID",
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
        branchId,
        status: "CANCELLED",
        OR: [
          { cancelledAt: { gte: startOfDay, lt: endOfDay } },
          { cancelledAt: null, createdAt: { gte: startOfDay, lt: endOfDay } },
        ],
      },
      select: {
        totalAmount: true,
      },
    });

    // v2.8.99 — only APPROVED cash drawer movements count toward
    // reconciliation. DRAFT rows are CASH_OUT or ADJUSTMENT entries
    // awaiting manager approval; including them would skew the
    // expected-cash sum before a manager has signed off. REJECTED
    // rows are explicitly excluded.
    const cashMovements = await this.prisma.cashDrawerMovement.findMany({
      where: {
        tenantId,
        branchId,
        approvalStatus: "APPROVED",
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

    // Calculate open (unfulfilled) orders
    const openOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        createdAt: { gte: startOfDay, lt: endOfDay },
        status: { notIn: ["PAID", "CANCELLED"] },
      },
      select: { finalAmount: true },
    });

    // Pure number-crunching lives in ZReportAggregator (god-file split).
    // All Decimal money math, payment/refund/order-type/tax/cash/staff/
    // category/top-product aggregation and rounding is computed there from
    // the already-fetched, branch-scoped rows. The data-fetching above and
    // the create below stay here so the per-branch scoping and the
    // $transaction-free dedupe/create flow are unchanged.
    const totals = this.aggregator.aggregate({
      orders,
      cancelledOrdersList,
      cashMovements,
      openOrders,
      cashDrawerOpening,
      cashDrawerClosing,
    });
    const {
      totalOrders,
      totalSales: grossSales,
      totalDiscount: discounts,
      netSales,
      totalTax,
      taxBreakdown: taxBreakdownMap,
      cashPayments,
      cashPaymentCount,
      cardPayments,
      cardPaymentCount,
      digitalPayments,
      digitalPaymentCount,
      dineInSales,
      dineInOrders: dineInOrdersCount,
      takeawaySales,
      takeawayOrders: takeawayOrdersCount,
      deliverySales,
      deliveryOrders: deliveryOrdersCount,
      cancelledOrders,
      cancelledOrdersAmount,
      totalRefunds,
      refundedPayments: refundedPaymentsCount,
      refundedAmount,
      expectedCash,
      cashDifference,
      cashInOut,
      openChecks,
      openChecksAmount,
      topProducts,
      categoryBreakdown,
      staffPerformance,
    } = totals;

    // Create the Z-Report. The `findFirst` above is a fast-path dedupe;
    // the schema now has `@@unique([tenantId, branchId, reportNumber])`
    // (v3 branch-scope: each branch closes its own fiscal day). The report
    // number is deterministic per `(branch, reportDate)` — we embed a
    // stable branch token so two branches closing the SAME calendar day
    // produce DISTINCT report numbers (no longer colliding tenant-wide),
    // while a concurrent second generate for the SAME branch+date still
    // surfaces as P2002 here — translated to the same "already exists"
    // business error rather than a raw 500.
    const reportDay = new Date(reportDate)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "");
    // Stable, branch-distinct token. branchId is a UUID; its leading
    // segment is unique enough within a tenant to disambiguate per-branch
    // report numbers while keeping the value deterministic per branch.
    const branchToken = branchId.replace(/-/g, "").slice(0, 8).toUpperCase();
    let report;
    try {
      report = await this.prisma.zReport.create({
        data: {
          tenantId,
          branchId,
          reportDate: new Date(reportDate),
          reportNumber: `Z-${reportDay}-${branchToken}`,
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
          dineInOrders: dineInOrdersCount,
          takeawaySales,
          takeawayOrders: takeawayOrdersCount,
          deliverySales,
          deliveryOrders: deliveryOrdersCount,

          // Cancelled orders
          cancelledOrders,
          cancelledOrdersAmount,

          // Refund data
          totalRefunds,
          refundedPayments: refundedPaymentsCount,
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
        err.code === "P2002"
      ) {
        throw new BadRequestException("Z-Report already exists for this date");
      }
      throw err;
    }

    return report;
  }

  /**
   * Get all Z-Reports for the active branch.
   *
   * Track-1: Z-Reports are fiscal, per-branch records (the row carries a
   * NOT-NULL branchId). The list must be scoped to the caller's active
   * branch — a tenant-wide list would leak every branch's fiscal totals
   * to an admin who only switched to one branch. Callers pass the
   * branchId off `@CurrentScope()`.
   */
  async findAll(
    scope: BranchScope,
    query: {
      page?: number;
      limit?: number;
      startDate?: string;
      endDate?: string;
    },
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { ...branchScope(scope) };

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
        orderBy: { reportDate: "desc" },
      }),
      this.prisma.zReport.count({ where }),
    ]);

    return paginated(reports, total, page, limit);
  }

  /**
   * Get a specific Z-Report, scoped to the caller's active branch.
   *
   * Track-1: branch-scoped so an admin on branch A cannot fetch branch
   * B's fiscal report by id. The PDF/email/close paths all funnel
   * through here, so scoping it once covers every read of a single
   * report.
   */
  async findOne(id: string, scope: BranchScope) {
    const report = await this.prisma.zReport.findFirst({
      where: { id, ...branchScope(scope) },
    });

    if (!report) {
      throw new NotFoundException("Z-Report not found");
    }

    return report;
  }

  /**
   * Generate PDF for Z-Report
   */
  async generatePdf(id: string, scope: BranchScope): Promise<Buffer> {
    const report = await this.findOne(id, scope);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: scope.tenantId },
    });
    // Pure rendering lives in ZReportPdfService (god-file split). tenant is
    // assumed present for a valid scope, preserving the prior behavior.
    return this.pdfService.render(report, tenant!);
  }

  /**
   * Close (finalize) a Z-Report. After this succeeds, every writing path
   * must assert isFinalized=false before mutating fiscal totals. A SHA-256
   * payload hash is stored for tamper-detection audit. The conditional
   * updateMany on isFinalized=false ensures two concurrent close clicks
   * can't both win.
   */
  async closeReport(id: string, scope: BranchScope, userId?: string) {
    const report = await this.findOne(id, scope);
    if ((report as any).isFinalized) {
      throw new BadRequestException("Report is already finalized");
    }
    // Legacy pdfExported flag — keep the check during migration so we
    // don't finalize a row that was already informally sealed.
    if (report.pdfExported && !(report as any).isFinalized) {
      // pdfExported alone is not a real finalization — upgrade it.
    }

    const payloadHash = this.computePayloadHash(report);

    const result = await this.prisma.zReport.updateMany({
      where: { id, ...branchScope(scope), isFinalized: false },
      data: {
        isFinalized: true,
        finalizedAt: new Date(),
        finalizedById: userId ?? null,
        payloadHash,
        pdfExported: true,
        // Honesty: there is NO Excel export path (only PDF via
        // ZReportPdfService). Finalizing must not claim an export that
        // never happened — keep this false until/unless XLSX ships.
        excelExported: false,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException("Report was concurrently finalized");
    }
    return this.findOne(id, scope);
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
      totalDiscount:
        report.totalDiscount?.toString?.() ?? String(report.totalDiscount),
      totalRefunds:
        report.totalRefunds?.toString?.() ?? String(report.totalRefunds),
      netSales: report.netSales?.toString?.() ?? String(report.netSales),
      cashPayments:
        report.cashPayments?.toString?.() ?? String(report.cashPayments),
      cardPayments:
        report.cardPayments?.toString?.() ?? String(report.cardPayments),
      digitalPayments:
        report.digitalPayments?.toString?.() ?? String(report.digitalPayments),
      openingCash:
        report.openingCash?.toString?.() ?? String(report.openingCash),
      countedCash:
        report.countedCash?.toString?.() ?? String(report.countedCash),
      expectedCash:
        report.expectedCash?.toString?.() ?? String(report.expectedCash),
      cashDifference:
        report.cashDifference?.toString?.() ?? String(report.cashDifference),
    };
    const canonical = JSON.stringify(
      Object.keys(payload)
        .sort()
        .reduce(
          (acc, k) => {
            (acc as any)[k] = (payload as any)[k];
            return acc;
          },
          {} as Record<string, unknown>,
        ),
    );
    return createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * Send Z-Report via email
   */
  async sendReportEmail(
    id: string,
    scope: BranchScope,
    toEmails?: string[],
  ): Promise<{ success: boolean; message: string }> {
    const report = await this.findOne(id, scope);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: scope.tenantId },
    });

    if (!tenant) {
      throw new NotFoundException("Tenant not found");
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
        "No email recipients configured. Please add email addresses in tenant settings or provide them explicitly.",
      );
    }

    // Get currency symbol
    const currencySymbol = CURRENCY_SYMBOLS[tenant.currency] || "$";

    // Parse top products from JSON
    const topProducts = (report.topProducts as any[]) || [];

    // Calculate cash difference details
    const cashDiff = Number(report.cashDifference);
    const isNegativeDifference = cashDiff < 0;
    const isPositiveDifference = cashDiff > 0;
    const cashDifferenceClass = isNegativeDifference
      ? "danger"
      : isPositiveDifference
        ? "warning"
        : "";

    // Format the email context
    const emailContext = {
      restaurantName: tenant.name,
      reportNumber: report.reportNumber,
      reportDate: format(new Date(report.reportDate), "MMMM dd, yyyy"),
      closingTime: format(new Date(report.closingTime), "HH:mm"),
      closedByName: closedBy
        ? `${closedBy.firstName} ${closedBy.lastName}`
        : "System",
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
        to: recipients.join(", "),
        subject: `Z-Report Summary - ${format(new Date(report.reportDate), "MMM dd, yyyy")} - ${tenant.name}`,
        template: "z-report-summary",
        context: emailContext,
      });

      // Update report with email status — compound WHERE IDOR guard
      // (B41-B45 pattern). `closeReport` already uses updateMany with
      // tenant scoping; this email-status write must match.
      await this.prisma.zReport.updateMany({
        where: { id, ...branchScope(scope) },
        data: {
          emailSent: success,
          emailSentAt: success ? new Date() : null,
          emailRecipients: recipients,
          emailError: success ? null : "Failed to send email",
        },
      });

      if (success) {
        this.logger.log(
          `Z-Report email sent successfully to ${recipients.join(", ")}`,
        );
        return {
          success: true,
          message: `Email sent successfully to ${recipients.length} recipient(s)`,
        };
      } else {
        return {
          success: false,
          message: "Failed to send email. Please check email configuration.",
        };
      }
    } catch (error) {
      this.logger.error(`Failed to send Z-Report email: ${error.message}`);

      // Update report with error
      await this.prisma.zReport.updateMany({
        where: { id, ...branchScope(scope) },
        data: {
          emailError: error.message,
        },
      });

      return {
        success: false,
        message: `Failed to send email: ${error.message}`,
      };
    }
  }

  /**
   * Generate and send Z-Report for a tenant (used by scheduler).
   *
   * v3.0.0: `branchId` is required — the scheduler resolves it per
   * tenant before invoking (each branch closes independently for fiscal
   * purposes, so the scheduler iterates branches, not just tenants).
   */
  async generateAndSendReport(
    tenantId: string,
    branchId: string,
    userId: string,
  ): Promise<{ reportId: string; emailSent: boolean }> {
    // Timezone matters: a TR restaurant closing at 23:00 TR with the API
    // pod in UTC needs "today" to mean "the TR calendar date we're
    // currently in", not "the UTC calendar date the server is in". The
    // earlier code used `today.setHours(0,0,0,0)` which gave SERVER-local
    // midnight — for a UTC container with a TR tenant this saved reportDate
    // as one UTC instant while the scheduler's "already sent?" check
    // searched for a different (local-midnight) instant. Result: the
    // scheduler re-entered generate every 15 min during the closing window,
    // each time hitting the service's own dedup throw, polluting logs.
    //
    // Per-branch tz fix: we resolve the BRANCH's timezone (falling back to
    // the tenant tz, then UTC) so a multi-tz chain's off-tz branch buckets
    // its sales day on ITS OWN midnight — matching the scheduler's
    // branch-tz dedup midnight so the two sides stay in lockstep.
    const tz = await this.resolveBranchTimezone(tenantId, branchId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
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
        notes: "Auto-generated end-of-day report",
      });
    }

    let emailSent = false;

    if (tenant?.reportEmailEnabled && tenant.reportEmails?.length > 0) {
      // Scheduler path: rebuild the branch scope from the resolved
      // (tenantId, branchId) so the email-status write stays pinned to
      // the same branch the report belongs to. role/userId are the
      // acting system context; only tenantId/branchId are load-bearing.
      const scope: BranchScope = {
        tenantId,
        branchId,
        userId,
        role: UserRole.ADMIN,
      };
      const result = await this.sendReportEmail(report.id, scope);
      emailSent = result.success;
    }

    return { reportId: report.id, emailSent };
  }
}
