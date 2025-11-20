import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateZReportDto } from './dto/create-z-report.dto';
import { ZReportStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';

@Injectable()
export class ZReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate a Z-Report for end-of-day reconciliation
   */
  async generateReport(tenantId: string, createDto: CreateZReportDto) {
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
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    // Calculate totals
    const totalOrders = orders.length;
    const grossSales = orders.reduce((sum, order) => sum + order.totalAmount, 0);
    const discounts = orders.reduce((sum, order) => sum + order.discount, 0);
    const netSales = orders.reduce((sum, order) => sum + order.finalAmount, 0);

    // Calculate payment method breakdown
    const cashPayments = orders
      .flatMap((o) => o.payments)
      .filter((p) => p.method === 'CASH')
      .reduce((sum, p) => sum + p.amount, 0);

    const cardPayments = orders
      .flatMap((o) => o.payments)
      .filter((p) => p.method === 'CARD')
      .reduce((sum, p) => sum + p.amount, 0);

    const digitalPayments = orders
      .flatMap((o) => o.payments)
      .filter((p) => p.method === 'DIGITAL')
      .reduce((sum, p) => sum + p.amount, 0);

    // Calculate tax (assuming 10% for simplicity - should be configurable)
    const taxRate = 0.10;
    const taxAmount = netSales * taxRate;

    // Cash drawer reconciliation
    const expectedCash = cashDrawerOpening + cashPayments;
    const cashDifference = cashDrawerClosing - expectedCash;

    // Get top selling products
    const productSales = new Map<string, { name: string; quantity: number; revenue: number }>();
    orders.forEach((order) => {
      order.items.forEach((item) => {
        const existing = productSales.get(item.productId) || {
          name: item.product.name,
          quantity: 0,
          revenue: 0,
        };
        existing.quantity += item.quantity;
        existing.revenue += item.subtotal;
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
            name: true,
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
        closedById: 'system', // TODO: Get from authenticated user context

        // Sales data
        totalOrders,
        totalSales: grossSales,
        totalDiscount: discounts,
        netSales,

        // Payment breakdown
        cashPayments,
        cardPayments,
        digitalPayments,

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
          performedBy: m.user.name,
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

      // Sales Summary
      doc.fontSize(14).text('Sales Summary', { underline: true });
      doc.fontSize(10);
      doc.text(`Total Orders: ${report.totalOrders}`);
      doc.text(`Total Sales: $${report.totalSales.toFixed(2)}`);
      doc.text(`Discounts: $${report.totalDiscount.toFixed(2)}`);
      doc.text(`Net Sales: $${report.netSales.toFixed(2)}`);
      doc.moveDown();

      // Payment Methods
      doc.fontSize(14).text('Payment Methods', { underline: true });
      doc.fontSize(10);
      doc.text(`Cash: $${report.cashPayments.toFixed(2)}`);
      doc.text(`Card: $${report.cardPayments.toFixed(2)}`);
      doc.text(`Digital: $${report.digitalPayments.toFixed(2)}`);
      doc.moveDown();

      // Cash Drawer
      doc.fontSize(14).text('Cash Drawer Reconciliation', { underline: true });
      doc.fontSize(10);
      doc.text(`Opening Balance: $${report.openingCash.toFixed(2)}`);
      doc.text(`Cash Sales: $${report.cashPayments.toFixed(2)}`);
      doc.text(`Expected Cash: $${report.expectedCash.toFixed(2)}`);
      doc.text(`Actual Cash: $${report.countedCash.toFixed(2)}`);
      doc.text(`Difference: $${report.cashDifference.toFixed(2)}`, {
        continued: true,
      });

      if (report.cashDifference !== 0) {
        doc.fillColor(report.cashDifference > 0 ? 'green' : 'red')
          .text(` (${report.cashDifference > 0 ? 'Over' : 'Short'})`)
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
}
