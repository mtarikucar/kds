import {
  Injectable,
  Logger,
  Optional,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { AccountingSettingsService } from "./accounting-settings.service";
import { TaxCalculationService } from "./tax-calculation.service";
import { AccountingSyncService } from "./accounting-sync.service";
import {
  CreateSalesInvoiceDto,
  InvoiceQueryDto,
} from "../dto/create-sales-invoice.dto";
import { InvoiceStatus } from "../constants/accounting.enum";
import { paginated } from "../../../common/pagination";

@Injectable()
export class SalesInvoiceService {
  private readonly logger = new Logger(SalesInvoiceService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: AccountingSettingsService,
    private taxService: TaxCalculationService,
    @Optional() private syncService?: AccountingSyncService,
  ) {}

  /**
   * Snapshot the issuer/seller (satıcı) identity from the tenant's
   * AccountingSettings "Company Info" onto the invoice at build time.
   *
   * fake-working sweep #3: these six fields were collected + persisted in
   * settings but never placed on any generated SalesInvoice nor in the
   * provider-sync payload — the operator's configured invoice issuer
   * identity appeared on nothing the system issued. Snapshotting (rather
   * than joining at read time) keeps the historical document stable if the
   * operator later edits their company info. Returns only set fields so an
   * empty-Company-Info tenant leaves the columns null (unchanged behaviour).
   */
  private static sellerSnapshot(settings: {
    companyName?: string | null;
    companyTaxId?: string | null;
    companyTaxOffice?: string | null;
    companyAddress?: string | null;
    companyPhone?: string | null;
    companyEmail?: string | null;
  }) {
    return {
      sellerName: settings.companyName || null,
      sellerTaxId: settings.companyTaxId || null,
      sellerTaxOffice: settings.companyTaxOffice || null,
      sellerAddress: settings.companyAddress || null,
      sellerPhone: settings.companyPhone || null,
      sellerEmail: settings.companyEmail || null,
    };
  }

  async createFromOrder(
    orderId: string,
    tenantId: string,
    dto?: CreateSalesInvoiceDto,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, status: "PAID" },
      include: {
        orderItems: { include: { product: true } },
        payments: { where: { status: "COMPLETED" } },
        // Only the order-level invoice (paymentId null) blocks a
        // second createFromOrder call. Per-payment invoices created
        // by createFromPayment are separate fataralar and don't count
        // against the "one invoice per order" gate.
        salesInvoices: { where: { paymentId: null } },
      },
    });

    if (!order) throw new NotFoundException("Paid order not found");
    if (order.salesInvoices.length > 0) {
      throw new BadRequestException("Invoice already exists for this order");
    }

    // Read the non-secret settings once outside the tx — only the counter
    // mint + invoice create need to share rollback semantics. This keeps
    // the transaction short.
    const settings = await this.settingsService.findByTenant(tenantId);

    // deep-review M11: the order may carry an order-level discount
    // (order.totalAmount = gross, order.finalAmount = net, the delta is
    // order.discount). Pre-fix we built each line from its GROSS subtotal
    // but persisted header totalAmount = finalAmount (net). That made the
    // invoice internally inconsistent: sum(line totals) == gross while the
    // header total == net, so e-fatura providers that validate
    // sum(lines)==total reject the document or mis-book the net.
    //
    // Fix: apportion the order-level discount across the lines pro-rata by
    // each line's gross share, in Decimal, so sum(net line totals) ==
    // finalAmount EXACTLY (the rounding remainder is pushed onto the
    // largest line). Each line's subtotal/taxAmount are then re-extracted
    // from its NET gross at the line's own KDV rate, and the header
    // subtotal/taxAmount/taxBreakdown are recomputed from the adjusted
    // lines — never the pre-discount ones.
    const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);
    const round2 = (d: Prisma.Decimal) =>
      d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const orderGross = D(order.totalAmount);
    const orderDiscount = D(order.discount);
    // Guard div-by-zero: a fully-comped (gross 0) order with a discount is
    // nonsensical, but if gross is 0 there is nothing to apportion against.
    const hasDiscount = orderDiscount.gt(0) && orderGross.gt(0);

    // Combo lines: the 0₺ parent is a grouping row (money + KDV live on its
    // children). Exclude parents from the invoice so no bogus 0₺/0% line is
    // written — children + standalone items still reconcile to finalAmount
    // (the parent contributes 0 to every sum). Same leaf-filter as the fiş.
    const comboParentIds = new Set(
      order.orderItems
        .filter((it) => it.parentOrderItemId)
        .map((it) => it.parentOrderItemId),
    );
    const leafItems = order.orderItems.filter(
      (it) => !comboParentIds.has(it.id),
    );

    // First pass: validate quantities and capture each line's gross.
    const lineGross = leafItems.map((item) => {
      // quantity===0 would back-calc unitPrice as NaN and persist into the
      // Decimal column, breaking downstream math and tax-authority XML.
      if (!item.quantity || item.quantity <= 0) {
        throw new BadRequestException(
          `Invoice cannot be generated: order item "${item.product?.name ?? item.id}" has non-positive quantity`,
        );
      }
      return D(item.subtotal);
    });

    // Apportion the discount across lines pro-rata by gross share, rounding
    // each apportioned discount to 2dp. Track the largest line so the
    // rounding remainder lands there and the net lines sum to finalAmount
    // to the cent.
    const netLineGross: Prisma.Decimal[] = lineGross.map((g) => g);
    if (hasDiscount) {
      let allocated = D(0);
      let largestIdx = 0;
      for (let i = 0; i < lineGross.length; i++) {
        const share = round2(lineGross[i].div(orderGross).mul(orderDiscount));
        netLineGross[i] = lineGross[i].sub(share);
        allocated = allocated.add(share);
        if (lineGross[i].gt(lineGross[largestIdx])) largestIdx = i;
      }
      // Push the rounding remainder (orderDiscount − Σ apportioned) onto the
      // largest line so Σ(net line gross) == finalAmount exactly.
      const remainder = orderDiscount.sub(allocated);
      if (!remainder.isZero()) {
        netLineGross[largestIdx] = netLineGross[largestIdx].sub(remainder);
      }
    }

    const invoiceItems = leafItems.map((item, i) => {
      const taxRate = item.taxRate ?? 10;
      // extractTax pulls the KDV component out of the (now net) inclusive
      // line gross, so subtotal/taxAmount reconcile to the discounted total.
      const netGross = round2(netLineGross[i]).toNumber();
      const tax = this.taxService.extractTax(netGross, taxRate);

      return {
        description: item.product?.name || "Ürün",
        quantity: item.quantity,
        unitPrice:
          Math.round((tax.subtotalExcludingTax / item.quantity) * 100) / 100,
        taxRate,
        taxAmount: tax.taxAmount,
        subtotal: tax.subtotalExcludingTax,
        total: netGross,
      };
    });

    const totalAmount = Number(order.finalAmount);
    const discount = Number(order.discount);

    // CONCERN B-fiscal (delivery reconciliation): the header total is
    // order.finalAmount. For DELIVERY orders the external platform folds a
    // delivery fee (and the value of any items it never mapped to our
    // catalogue, which delivery-order.service drops) into finalAmount, so
    // Σ(line.total) lands BELOW the header total. An e-Arşiv/e-fatura
    // document whose lines don't sum to its header total is rejected by the
    // provider. When the computed line sum is short, append ONE reconciling
    // "Teslimat / Diğer" line for the difference so Σ(lines) == totalAmount.
    // Dine-in/takeaway lines already reconcile (Σ == finalAmount), so the
    // gap is zero and nothing is appended — their behaviour is unchanged.
    const lineTotalSum = invoiceItems.reduce((s, i) => s.add(D(i.total)), D(0));
    const reconcileGap = round2(D(totalAmount).sub(lineTotalSum));
    // Only positive gaps are reconciled. A line sum ABOVE the header total
    // is a different (discount-side) concern handled by the M11 apportioning
    // above; we never silently trim real lines here.
    if (reconcileGap.gt(0)) {
      // Treat the delivery/other amount as KDV-inclusive at the standard
      // rate so the header subtotal/taxAmount/taxBreakdown also reconcile.
      const reconcileRate = 20;
      const reconcileGross = reconcileGap.toNumber();
      const tax = this.taxService.extractTax(reconcileGross, reconcileRate);
      invoiceItems.push({
        description: "Teslimat / Diğer",
        quantity: 1,
        unitPrice: tax.subtotalExcludingTax,
        taxRate: reconcileRate,
        taxAmount: tax.taxAmount,
        subtotal: tax.subtotalExcludingTax,
        total: reconcileGross,
      });
    }

    const subtotal = invoiceItems.reduce((s, i) => s + i.subtotal, 0);
    const taxAmount = invoiceItems.reduce((s, i) => s + i.taxAmount, 0);

    const taxBreakdown: Record<
      number,
      { taxableAmount: number; taxAmount: number }
    > = {};
    for (const item of invoiceItems) {
      if (!taxBreakdown[item.taxRate]) {
        taxBreakdown[item.taxRate] = { taxableAmount: 0, taxAmount: 0 };
      }
      taxBreakdown[item.taxRate].taxableAmount += item.subtotal;
      taxBreakdown[item.taxRate].taxAmount += item.taxAmount;
    }

    const paymentMethod = order.payments[0]?.method || null;

    // Mint the invoice number inside the same transaction as the create.
    // If the create fails (e.g. DTO validation upstream of the DB) the
    // number-increment is rolled back too — no audit gap.
    //
    // Serializable isolation + an in-tx re-check on existing order-level
    // invoices closes the duplicate-fatura race. The partial unique on
    // (paymentId WHERE paymentId IS NOT NULL) only protects per-payment
    // invoices; order-level invoices (paymentId IS NULL) have no DB-level
    // unique, so two concurrent createFromOrder calls would both pass the
    // length===0 check above and both create. Issuing two fataralar for
    // one order violates Turkish e-fatura compliance.
    const invoice = await this.prisma.$transaction(
      async (tx) => {
        const dupe = await tx.salesInvoice.findFirst({
          where: { orderId: order.id, tenantId, paymentId: null },
          select: { id: true },
        });
        if (dupe) {
          throw new ConflictException("Invoice already exists for this order");
        }
        const invoiceNumber = await this.settingsService.getNextInvoiceNumber(
          tenantId,
          tx,
        );
        return tx.salesInvoice.create({
          data: {
            invoiceNumber,
            status: InvoiceStatus.ISSUED,
            customerName: dto?.customerName || order.customerName,
            customerPhone: dto?.customerPhone || order.customerPhone,
            customerEmail: dto?.customerEmail,
            customerTaxId: dto?.customerTaxId,
            customerTaxOffice: dto?.customerTaxOffice,
            // Issuer identity from Company Info (fake-working sweep #3).
            ...SalesInvoiceService.sellerSnapshot(settings),
            subtotal: Math.round(subtotal * 100) / 100,
            taxAmount: Math.round(taxAmount * 100) / 100,
            totalAmount,
            discount,
            taxBreakdown,
            orderId: order.id,
            paymentMethod,
            issueDate: new Date(),
            dueDate:
              settings.defaultPaymentTermDays > 0
                ? new Date(
                    Date.now() + settings.defaultPaymentTermDays * 86400000,
                  )
                : new Date(),
            tenantId,
            items: {
              create: invoiceItems.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                taxRate: item.taxRate,
                taxAmount: item.taxAmount,
                subtotal: item.subtotal,
                total: item.total,
              })),
            },
          },
          include: { items: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Auto-sync if enabled
    if (this.syncService) {
      const accSettings = await this.settingsService.findByTenant(tenantId);
      if (accSettings.autoSync && accSettings.provider !== "NONE") {
        this.syncService.syncInvoice(invoice.id, tenantId).catch((err) => {
          this.logger.error(`Auto-sync failed: ${err.message}`);
        });
      }
    }

    return invoice;
  }

  /**
   * Create a fatura scoped to a single Payment (progressive payment
   * flow). Line items are derived from the Payment's OrderItemPayment
   * allocations so each customer's invoice shows exactly what they
   * paid for, with the right unit count and KDV breakdown. Method on
   * the invoice = this Payment's method (CASH / CARD / DIGITAL /
   * HOUSE), which is what Turkish e-fatura needs.
   *
   * Idempotent against the partial unique index
   * `sales_invoices_paymentId_notnull_key` — a retry returns the
   * existing invoice instead of duplicating it.
   */
  async createFromPayment(paymentId: string, tenantId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, status: "COMPLETED" },
      include: {
        orderItemPayments: {
          include: { orderItem: { include: { product: true } } },
        },
        order: true,
        salesInvoices: true,
      },
    });

    if (!payment) throw new NotFoundException("Completed payment not found");
    if (payment.salesInvoices.length > 0) return payment.salesInvoices[0];
    if (payment.orderItemPayments.length === 0) {
      throw new BadRequestException(
        "Per-payment invoice requires the Payment to have at least one OrderItemPayment allocation. " +
          "Use createFromOrder for order-level invoices.",
      );
    }

    const settings = await this.settingsService.findByTenant(tenantId);

    // Build invoice lines from the per-item allocations. Each
    // allocation row carries (orderItemId, quantity, amount). We
    // derive unitPrice and tax from the parent OrderItem at its
    // captured rate.
    const invoiceItems = payment.orderItemPayments.map((alloc) => {
      const item = alloc.orderItem;
      if (!item.quantity || item.quantity <= 0) {
        throw new BadRequestException(
          `Invoice cannot be generated: order item "${item.product?.name ?? item.id}" has non-positive quantity`,
        );
      }
      const lineTotal = Number(alloc.amount);
      const taxRate = item.taxRate ?? 10;
      const tax = this.taxService.extractTax(lineTotal, taxRate);
      return {
        description: item.product?.name || "Ürün",
        quantity: alloc.quantity,
        unitPrice:
          alloc.quantity > 0
            ? Math.round((tax.subtotalExcludingTax / alloc.quantity) * 100) /
              100
            : 0,
        taxRate,
        taxAmount: tax.taxAmount,
        subtotal: tax.subtotalExcludingTax,
        total: lineTotal,
      };
    });

    const subtotal = invoiceItems.reduce((s, i) => s + i.subtotal, 0);
    const taxAmount = invoiceItems.reduce((s, i) => s + i.taxAmount, 0);
    const totalAmount = Number(payment.amount);

    const taxBreakdown: Record<
      number,
      { taxableAmount: number; taxAmount: number }
    > = {};
    for (const item of invoiceItems) {
      if (!taxBreakdown[item.taxRate]) {
        taxBreakdown[item.taxRate] = { taxableAmount: 0, taxAmount: 0 };
      }
      taxBreakdown[item.taxRate].taxableAmount += item.subtotal;
      taxBreakdown[item.taxRate].taxAmount += item.taxAmount;
    }

    try {
      const invoice = await this.prisma.$transaction(async (tx) => {
        const invoiceNumber = await this.settingsService.getNextInvoiceNumber(
          tenantId,
          tx,
        );
        return tx.salesInvoice.create({
          data: {
            invoiceNumber,
            status: InvoiceStatus.ISSUED,
            customerName: payment.order.customerName,
            customerPhone: payment.order.customerPhone,
            // Issuer identity from Company Info (fake-working sweep #3).
            ...SalesInvoiceService.sellerSnapshot(settings),
            subtotal: Math.round(subtotal * 100) / 100,
            taxAmount: Math.round(taxAmount * 100) / 100,
            totalAmount,
            // deep-review M11: no order-level discount line here. Each
            // OrderItemPayment.amount is, by definition, "this allocation's
            // contribution to Payment.amount" — i.e. already net of any
            // order discount that was distributed at payment time. The
            // lines are derived from those allocation amounts, so
            // Σ(line totals) == Σ(alloc.amount) == payment.amount ==
            // totalAmount, and there is nothing left to discount on the
            // invoice. (Pre-fix this carried a misleading comment claiming
            // a pro-rata discount it never actually computed.)
            discount: 0,
            taxBreakdown,
            orderId: payment.orderId,
            paymentId: payment.id,
            paymentMethod: payment.method,
            issueDate: new Date(),
            dueDate:
              settings.defaultPaymentTermDays > 0
                ? new Date(
                    Date.now() + settings.defaultPaymentTermDays * 86400000,
                  )
                : new Date(),
            tenantId,
            items: {
              create: invoiceItems.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                taxRate: item.taxRate,
                taxAmount: item.taxAmount,
                subtotal: item.subtotal,
                total: item.total,
              })),
            },
          },
          include: { items: true },
        });
      });

      if (this.syncService) {
        const accSettings = await this.settingsService.findByTenant(tenantId);
        if (accSettings.autoSync && accSettings.provider !== "NONE") {
          this.syncService.syncInvoice(invoice.id, tenantId).catch((err) => {
            this.logger.error(`Auto-sync failed: ${err.message}`);
          });
        }
      }

      return invoice;
    } catch (err: any) {
      // Idempotency: partial unique on paymentId means a retry hits
      // P2002 and we return the winning row.
      if (err?.code === "P2002") {
        const existing = await this.prisma.salesInvoice.findFirst({
          where: { paymentId, tenantId },
          include: { items: true },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async findAll(tenantId: string, query: InvoiceQueryDto) {
    const where: any = { tenantId };
    if (query.status) where.status = query.status;
    if (query.startDate || query.endDate) {
      where.issueDate = {};
      if (query.startDate) where.issueDate.gte = new Date(query.startDate);
      if (query.endDate) where.issueDate.lte = new Date(query.endDate);
    }
    if (query.search) {
      where.OR = [
        { invoiceNumber: { contains: query.search, mode: "insensitive" } },
        { customerName: { contains: query.search, mode: "insensitive" } },
      ];
    }

    // DTO already caps these (iter-33), but a service-side Math.min is
    // cheap defence-in-depth: if a future caller bypasses the DTO (a
    // worker, a cron, an internal RPC) we still don't pull arbitrarily
    // large pages of invoice rows + nested items.
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(Math.max(1, Number(query.limit) || 20), 200);

    const [invoices, total] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where,
        include: { items: true },
        orderBy: { issueDate: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.salesInvoice.count({ where }),
    ]);

    return paginated(invoices, total, page, limit);
  }

  async findOne(id: string, tenantId: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, tenantId },
      include: { items: true, order: true },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    return invoice;
  }

  async cancel(id: string, tenantId: string) {
    const invoice = await this.findOne(id, tenantId);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException("Invoice already cancelled");
    }
    // Compound WHERE on status + tenantId: race-safe against a concurrent
    // cancel from another admin, and defence-in-depth IDOR so a regression
    // of the findOne tenant check can't expose cross-tenant writes.
    const claim = await this.prisma.salesInvoice.updateMany({
      where: { id, tenantId, status: { not: InvoiceStatus.CANCELLED } },
      data: { status: InvoiceStatus.CANCELLED },
    });
    if (claim.count === 0) {
      throw new BadRequestException("Invoice already cancelled");
    }
    return this.prisma.salesInvoice.findUniqueOrThrow({ where: { id } });
  }
}
