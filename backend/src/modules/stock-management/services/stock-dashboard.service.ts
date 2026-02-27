import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StockAlertsService } from './stock-alerts.service';

@Injectable()
export class StockDashboardService {
  constructor(
    private prisma: PrismaService,
    private stockAlerts: StockAlertsService,
  ) {}

  async getDashboard(tenantId: string) {
    const [
      totalItems,
      activeItems,
      lowStockItems,
      expiringBatches,
      recentMovements,
      recentWaste,
      pendingPOs,
    ] = await Promise.all([
      this.prisma.stockItem.count({ where: { tenantId } }),
      this.prisma.stockItem.count({ where: { tenantId, isActive: true } }),
      this.stockAlerts.checkLowStock(tenantId),
      this.stockAlerts.checkExpiringBatches(tenantId),
      this.prisma.ingredientMovement.findMany({
        where: { tenantId },
        include: { stockItem: { select: { id: true, name: true, unit: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.wasteLog.aggregate({
        where: {
          tenantId,
          createdAt: { gte: new Date(new Date().setDate(new Date().getDate() - 30)) },
        },
        _sum: { cost: true },
        _count: true,
      }),
      this.prisma.purchaseOrder.count({
        where: { tenantId, status: { in: ['DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED'] } },
      }),
    ]);

    return {
      totalItems,
      activeItems,
      lowStockCount: lowStockItems.length,
      lowStockItems,
      expiringBatchCount: expiringBatches.length,
      expiringBatches,
      recentMovements,
      wasteLast30Days: {
        totalCost: recentWaste._sum.cost || 0,
        count: recentWaste._count,
      },
      pendingPurchaseOrders: pendingPOs,
    };
  }

  async getValuation(tenantId: string) {
    const items = await this.prisma.stockItem.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, unit: true, currentStock: true, costPerUnit: true },
    });

    const itemValuations = items.map((item) => ({
      ...item,
      totalValue: Number(item.currentStock) * Number(item.costPerUnit),
    }));

    const totalValue = itemValuations.reduce((sum, item) => sum + item.totalValue, 0);

    return {
      totalValue,
      itemCount: items.length,
      items: itemValuations.sort((a, b) => b.totalValue - a.totalValue),
    };
  }

  async getMovementSummary(tenantId: string, startDate?: string, endDate?: string) {
    const where: any = { tenantId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const byType = await this.prisma.ingredientMovement.groupBy({
      by: ['type'],
      where,
      _sum: { quantity: true },
      _count: true,
    });

    return { byType };
  }
}
