import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { KdsGateway } from '../../kds/kds.gateway';

@Injectable()
export class StockAlertsService {
  private readonly logger = new Logger(StockAlertsService.name);

  constructor(
    private prisma: PrismaService,
    @Optional()
    @Inject(forwardRef(() => KdsGateway))
    private kdsGateway?: KdsGateway,
  ) {}

  async checkLowStock(tenantId: string) {
    const lowStockItems = await this.prisma.$queryRaw<any[]>`
      SELECT si.id, si.name, si.unit, si."currentStock", si."minStock", sic.name as "categoryName"
      FROM stock_items si
      LEFT JOIN stock_item_categories sic ON si."categoryId" = sic.id
      WHERE si."tenantId" = ${tenantId}
        AND si."isActive" = true
        AND si."currentStock" <= si."minStock"
      ORDER BY si."currentStock" ASC
    `;

    if (lowStockItems.length > 0 && this.kdsGateway?.server) {
      this.kdsGateway.server
        .to(`kitchen-${tenantId}`)
        .to(`pos-${tenantId}`)
        .emit('stock:low-alert', {
          count: lowStockItems.length,
          items: lowStockItems.map((i) => ({
            id: i.id,
            name: i.name,
            unit: i.unit,
            currentStock: i.currentStock,
            minStock: i.minStock,
          })),
        });
      this.logger.log(`Low stock alert sent for tenant ${tenantId}: ${lowStockItems.length} items`);
    }

    return lowStockItems;
  }

  async checkExpiringBatches(tenantId: string, days?: number) {
    const settings = await this.prisma.stockSettings.findUnique({
      where: { tenantId },
    });
    const alertDays = days || settings?.lowStockAlertDays || 3;

    const alertDate = new Date();
    alertDate.setDate(alertDate.getDate() + alertDays);

    const expiringBatches = await this.prisma.stockBatch.findMany({
      where: {
        tenantId,
        quantity: { gt: 0 },
        expiryDate: { lte: alertDate, gte: new Date() },
      },
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { expiryDate: 'asc' },
    });

    if (expiringBatches.length > 0 && this.kdsGateway?.server) {
      this.kdsGateway.server
        .to(`kitchen-${tenantId}`)
        .to(`pos-${tenantId}`)
        .emit('stock:expiry-alert', {
          count: expiringBatches.length,
          batches: expiringBatches.map((b) => ({
            id: b.id,
            stockItemName: b.stockItem.name,
            quantity: b.quantity,
            expiryDate: b.expiryDate,
          })),
        });
      this.logger.log(`Expiry alert sent for tenant ${tenantId}: ${expiringBatches.length} batches`);
    }

    return expiringBatches;
  }
}
