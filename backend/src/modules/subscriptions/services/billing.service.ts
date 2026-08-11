import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { InvoiceStatus } from "../../../common/constants/subscription.enum";
import {
  splitGrossAmount,
  DEFAULT_KDV_RATE,
} from "../../../common/helpers/kdv.helper";
import { generateInvoiceNumber } from "../../../common/helpers/invoice-number.helper";

type PrismaLike = Prisma.TransactionClient | PrismaService;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * Effective KDV rate. Defaults to the Turkish standard (20%) but allows
   * an env override (KDV_RATE=0.10 etc.) for jurisdictions that use a
   * different reduced rate, and for testing.
   */
  private get kdvRate(): number {
    const raw = this.config.get<string>("KDV_RATE");
    if (!raw) return DEFAULT_KDV_RATE;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : DEFAULT_KDV_RATE;
  }

  /**
   * Atomically obtain a new invoice number using an InvoiceCounter row.
   *
   * v3.3.0: the implementation moved to common/helpers/invoice-number.helper
   * so the à-la-carte TenantInvoice writer shares the SAME counter. Both
   * tables have a unique invoiceNumber over the same format, so a second,
   * independent sequence would eventually collide — and that collision lands
   * inside settlement, after the card has already been charged.
   */
  private generateInvoiceNumber(tx: PrismaLike): Promise<string> {
    return generateInvoiceNumber(tx);
  }

  /**
   * Create an invoice. Accepts a transaction client so the caller can
   * atomically bind it to a payment + subscription update.
   */
  async createInvoice(
    tx: PrismaLike,
    subscriptionId: string,
    paymentId: string | null,
    amount: Prisma.Decimal | number | string,
    currency: string,
    periodStart: Date,
    periodEnd: Date,
    description?: string,
  ) {
    const invoiceNumber = await this.generateInvoiceNumber(tx);

    // `amount` is the gross (KDV-inclusive) figure the tenant was actually
    // charged. For TRY invoices we reverse-engineer KDV; for non-TRY
    // currencies (INTERNATIONAL tenants on the EMAIL flow) we keep
    // tax at 0 since per-jurisdiction VAT is out of scope.
    const isTurkish = currency.toUpperCase() === "TRY";
    const { subtotal, tax, total } = isTurkish
      ? splitGrossAmount(amount, this.kdvRate)
      : (() => {
          const t = new Prisma.Decimal(amount);
          return { subtotal: t, tax: new Prisma.Decimal(0), total: t };
        })();

    // Snapshot the tenant's taxId at issuance — if they later change it,
    // already-issued invoices remain auditable.
    const taxIdSnapshot = await this.loadTaxIdSnapshot(tx, subscriptionId);

    const invoice = await tx.invoice.create({
      data: {
        subscriptionId,
        paymentId,
        invoiceNumber,
        status: paymentId ? InvoiceStatus.PAID : InvoiceStatus.OPEN,
        subtotal,
        tax,
        total,
        currency,
        periodStart,
        periodEnd,
        dueDate: new Date(),
        paidAt: paymentId ? new Date() : null,
        description:
          description ||
          `Subscription invoice for ${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}`,
        taxIdSnapshot,
      },
    });

    this.logger.log(
      `Invoice created: ${invoice.invoiceNumber} for subscription ${subscriptionId}`,
    );
    return invoice;
  }

  private async loadTaxIdSnapshot(
    tx: PrismaLike,
    subscriptionId: string,
  ): Promise<string | null> {
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      select: { tenant: { select: { taxId: true } } },
    });
    return sub?.tenant?.taxId ?? null;
  }

  async markInvoiceAsPaid(invoiceId: string, paymentId: string) {
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.PAID,
        paidAt: new Date(),
        paymentId,
      },
    });
  }

  async voidInvoice(invoiceId: string) {
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.VOID,
        voidedAt: new Date(),
      },
    });
  }

  /**
   * Get a page of invoices for a subscription, scoped to its tenant so
   * cross-tenant IDOR is impossible. Pass `tenantId` from the caller.
   */
  async getSubscriptionInvoices(
    subscriptionId: string,
    tenantId: string,
    page = 1,
    pageSize = 20,
  ) {
    const take = Math.min(100, Math.max(1, pageSize));
    const skip = Math.max(0, (Math.max(1, page) - 1) * take);
    const where: Prisma.InvoiceWhereInput = {
      subscriptionId,
      subscription: { tenantId },
    };
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { payment: true },
        skip,
        take,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      items,
      meta: {
        total,
        page,
        pageSize: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  /**
   * Get an invoice by number, scoped to the caller's tenant. Prevents
   * cross-tenant IDOR that the prior global-lookup variant allowed.
   */
  async getInvoiceByNumber(invoiceNumber: string, tenantId: string) {
    return this.prisma.invoice.findFirst({
      where: {
        invoiceNumber,
        subscription: { tenantId },
      },
      include: {
        subscription: {
          include: { plan: true, tenant: true },
        },
        payment: true,
      },
    });
  }

  async getTenantInvoices(tenantId: string, page = 1, pageSize = 20) {
    const take = Math.min(100, Math.max(1, pageSize));
    const skip = Math.max(0, (Math.max(1, page) - 1) * take);
    const where: Prisma.InvoiceWhereInput = {
      subscription: { tenantId },
    };
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          subscription: { include: { plan: true } },
          payment: true,
        },
        skip,
        take,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      items,
      meta: {
        total,
        page,
        pageSize: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  /**
   * Proration for plan changes, computed in Decimal so cents don't drift.
   * Returns the difference between "unused portion of current plan" and
   * "cost of the new plan for the remaining days".
   */
  calculateProration(
    currentAmount: Prisma.Decimal | number | string,
    newAmount: Prisma.Decimal | number | string,
    daysRemaining: number,
    totalDaysInPeriod: number,
  ): Prisma.Decimal {
    if (totalDaysInPeriod <= 0) return new Prisma.Decimal(0);
    const ratio = new Prisma.Decimal(daysRemaining).div(totalDaysInPeriod);
    const unusedAmount = new Prisma.Decimal(currentAmount).mul(ratio);
    const newPlanAmount = new Prisma.Decimal(newAmount).mul(ratio);
    return newPlanAmount
      .sub(unusedAmount)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  getDaysRemaining(periodEnd: Date): number {
    const now = new Date();
    const diff = periodEnd.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  getTotalDaysInPeriod(periodStart: Date, periodEnd: Date): number {
    const diff = periodEnd.getTime() - periodStart.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
}
