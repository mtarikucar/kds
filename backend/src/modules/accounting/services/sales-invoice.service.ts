import { Injectable, Logger, Optional, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountingSettingsService } from './accounting-settings.service';
import { TaxCalculationService } from './tax-calculation.service';
import { AccountingSyncService } from './accounting-sync.service';
import { CreateSalesInvoiceDto, InvoiceQueryDto } from '../dto/create-sales-invoice.dto';
import { InvoiceStatus } from '../constants/accounting.enum';
import { paginated } from '../../../common/pagination';

@Injectable()
export class SalesInvoiceService {
  private readonly logger = new Logger(SalesInvoiceService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: AccountingSettingsService,
    private taxService: TaxCalculationService,
    @Optional() private syncService?: AccountingSyncService,
  ) {}

  async createFromOrder(orderId: string, tenantId: string, dto?: CreateSalesInvoiceDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, status: 'PAID' },
      include: {
        orderItems: { include: { product: true } },
        payments: { where: { status: 'COMPLETED' } },
        // Only the order-level invoice (paymentId null) blocks a
        // second createFromOrder call. Per-payment invoices created
        // by createFromPayment are separate fataralar and don't count
        // against the "one invoice per order" gate.
        salesInvoices: { where: { paymentId: null } },
      },
    });

    if (!order) throw new NotFoundException('Paid order not found');
    if (order.salesInvoices.length > 0) {
      throw new BadRequestException('Invoice already exists for this order');
    }

    // Read the non-secret settings once outside the tx — only the counter
    // mint + invoice create need to share rollback semantics. This keeps
    // the transaction short.
    const settings = await this.settingsService.findByTenant(tenantId);

    const invoiceItems = order.orderItems.map((item) => {
      const lineTotal = Number(item.subtotal);
      const taxRate = item.taxRate ?? 10;
      const tax = this.taxService.extractTax(lineTotal, taxRate);

      // quantity===0 would back-calc unitPrice as NaN and persist into the
      // Decimal column, breaking downstream math and tax-authority XML.
      if (!item.quantity || item.quantity <= 0) {
        throw new BadRequestException(
          `Invoice cannot be generated: order item "${item.product?.name ?? item.id}" has non-positive quantity`,
        );
      }

      return {
        description: item.product?.name || 'Ürün',
        quantity: item.quantity,
        unitPrice: Math.round((tax.subtotalExcludingTax / item.quantity) * 100) / 100,
        taxRate,
        taxAmount: tax.taxAmount,
        subtotal: tax.subtotalExcludingTax,
        total: lineTotal,
      };
    });

    const subtotal = invoiceItems.reduce((s, i) => s + i.subtotal, 0);
    const taxAmount = invoiceItems.reduce((s, i) => s + i.taxAmount, 0);
    const totalAmount = Number(order.finalAmount);
    const discount = Number(order.discount);

    const taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }> = {};
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
    const invoice = await this.prisma.$transaction(async (tx) => {
      const dupe = await tx.salesInvoice.findFirst({
        where: { orderId: order.id, tenantId, paymentId: null },
        select: { id: true },
      });
      if (dupe) {
        throw new ConflictException('Invoice already exists for this order');
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
        subtotal: Math.round(subtotal * 100) / 100,
        taxAmount: Math.round(taxAmount * 100) / 100,
        totalAmount,
        discount,
        taxBreakdown,
        orderId: order.id,
        paymentMethod,
        issueDate: new Date(),
        dueDate: settings.defaultPaymentTermDays > 0
          ? new Date(Date.now() + settings.defaultPaymentTermDays * 86400000)
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Auto-sync if enabled
    if (this.syncService) {
      const accSettings = await this.settingsService.findByTenant(tenantId);
      if (accSettings.autoSync && accSettings.provider !== 'NONE') {
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
      where: { id: paymentId, tenantId, status: 'COMPLETED' },
      include: {
        orderItemPayments: {
          include: { orderItem: { include: { product: true } } },
        },
        order: true,
        salesInvoices: true,
      },
    });

    if (!payment) throw new NotFoundException('Completed payment not found');
    if (payment.salesInvoices.length > 0) return payment.salesInvoices[0];
    if (payment.orderItemPayments.length === 0) {
      throw new BadRequestException(
        'Per-payment invoice requires the Payment to have at least one OrderItemPayment allocation. ' +
          'Use createFromOrder for order-level invoices.',
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
        description: item.product?.name || 'Ürün',
        quantity: alloc.quantity,
        unitPrice: alloc.quantity > 0
          ? Math.round((tax.subtotalExcludingTax / alloc.quantity) * 100) / 100
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

    const taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }> = {};
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
            subtotal: Math.round(subtotal * 100) / 100,
            taxAmount: Math.round(taxAmount * 100) / 100,
            totalAmount,
            // Pro-rata discount portion of this payment, derived from
            // (totalAmount − subtotal − taxAmount). Negative noise is
            // clamped at 0.
            discount: 0,
            taxBreakdown,
            orderId: payment.orderId,
            paymentId: payment.id,
            paymentMethod: payment.method,
            issueDate: new Date(),
            dueDate: settings.defaultPaymentTermDays > 0
              ? new Date(Date.now() + settings.defaultPaymentTermDays * 86400000)
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
        if (accSettings.autoSync && accSettings.provider !== 'NONE') {
          this.syncService.syncInvoice(invoice.id, tenantId).catch((err) => {
            this.logger.error(`Auto-sync failed: ${err.message}`);
          });
        }
      }

      return invoice;
    } catch (err: any) {
      // Idempotency: partial unique on paymentId means a retry hits
      // P2002 and we return the winning row.
      if (err?.code === 'P2002') {
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
        { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
        { customerName: { contains: query.search, mode: 'insensitive' } },
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
        orderBy: { issueDate: 'desc' },
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
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async cancel(id: string, tenantId: string) {
    const invoice = await this.findOne(id, tenantId);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Invoice already cancelled');
    }
    // Compound WHERE on status + tenantId: race-safe against a concurrent
    // cancel from another admin, and defence-in-depth IDOR so a regression
    // of the findOne tenant check can't expose cross-tenant writes.
    const claim = await this.prisma.salesInvoice.updateMany({
      where: { id, tenantId, status: { not: InvoiceStatus.CANCELLED } },
      data: { status: InvoiceStatus.CANCELLED },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Invoice already cancelled');
    }
    return this.prisma.salesInvoice.findUniqueOrThrow({ where: { id } });
  }
}
