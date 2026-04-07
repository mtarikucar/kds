import { Injectable, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountingSettingsService } from './accounting-settings.service';
import { TaxCalculationService } from './tax-calculation.service';
import { AccountingSyncService } from './accounting-sync.service';
import { CreateSalesInvoiceDto, InvoiceQueryDto } from '../dto/create-sales-invoice.dto';
import { InvoiceStatus } from '../constants/accounting.enum';

@Injectable()
export class SalesInvoiceService {
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
        salesInvoice: true,
      },
    });

    if (!order) throw new NotFoundException('Paid order not found');
    if (order.salesInvoice) throw new BadRequestException('Invoice already exists for this order');

    const invoiceNumber = await this.settingsService.getNextInvoiceNumber(tenantId);
    const settings = await this.settingsService.findByTenant(tenantId);

    const invoiceItems = order.orderItems.map((item) => {
      const lineTotal = Number(item.subtotal);
      const taxRate = item.taxRate ?? 10;
      const tax = this.taxService.extractTax(lineTotal, taxRate);

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

    const invoice = await this.prisma.salesInvoice.create({
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

    // Auto-sync if enabled
    if (this.syncService) {
      const accSettings = await this.settingsService.findByTenant(tenantId);
      if (accSettings.autoSync && accSettings.provider !== 'NONE') {
        this.syncService.syncInvoice(invoice.id, tenantId).catch((err) => {
          console.error('Auto-sync failed:', err.message);
        });
      }
    }

    return invoice;
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

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;

    const [items, total] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where,
        include: { items: true },
        orderBy: { issueDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.salesInvoice.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
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
    return this.prisma.salesInvoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
    });
  }
}
