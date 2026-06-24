import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { StockAlertsService } from "./stock-alerts.service";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

// Iter-95: same window cap reasoning as iter-92 (waste-logs +
// ingredient-movements) and iter-89 (analytics). 366 days covers
// calendar-year + leap-year reporting while a 1970→2100 query can't
// scan the entire IngredientMovement table on the dashboard endpoint.
const STOCK_DASHBOARD_MAX_RANGE_DAYS = 366;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function parseWindow(
  startDate?: string,
  endDate?: string,
): { gte?: Date; lte?: Date } {
  const window: { gte?: Date; lte?: Date } = {};
  let start: Date | undefined;
  let end: Date | undefined;
  if (startDate) {
    start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException("startDate must be a valid ISO-8601 date");
    }
    window.gte = start;
  }
  if (endDate) {
    end = new Date(endDate);
    if (Number.isNaN(end.getTime())) {
      throw new BadRequestException("endDate must be a valid ISO-8601 date");
    }
    window.lte = end;
  }
  if (start && end) {
    if (start > end) {
      throw new BadRequestException(
        "startDate must be before or equal to endDate",
      );
    }
    const windowDays = (end.getTime() - start.getTime()) / MILLIS_PER_DAY;
    if (windowDays > STOCK_DASHBOARD_MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Date range cannot exceed ${STOCK_DASHBOARD_MAX_RANGE_DAYS} days. Split the request into smaller windows.`,
      );
    }
  }
  return window;
}

@Injectable()
export class StockDashboardService {
  constructor(
    private prisma: PrismaService,
    private stockAlerts: StockAlertsService,
  ) {}

  async getDashboard(scope: BranchScope) {
    const [
      totalItems,
      activeItems,
      lowStockItems,
      expiringBatches,
      recentMovements,
      recentWaste,
      pendingPOs,
    ] = await Promise.all([
      this.prisma.stockItem.count({ where: { ...branchScope(scope) } }),
      this.prisma.stockItem.count({
        where: { ...branchScope(scope), isActive: true },
      }),
      // Pass branchId so the dashboard's low-stock + expiry feeds are
      // fenced to the caller's branch. The hourly scheduler likewise calls
      // these per active branch (so its realtime emit fires).
      this.stockAlerts.checkLowStock(scope.tenantId, scope.branchId),
      this.stockAlerts.checkExpiringBatches(
        scope.tenantId,
        undefined,
        scope.branchId,
      ),
      this.prisma.ingredientMovement.findMany({
        where: { ...branchScope(scope) },
        include: {
          stockItem: { select: { id: true, name: true, unit: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      this.prisma.wasteLog.aggregate({
        where: {
          ...branchScope(scope),
          createdAt: {
            gte: new Date(new Date().setDate(new Date().getDate() - 30)),
          },
        },
        _sum: { cost: true },
        _count: true,
      }),
      this.prisma.purchaseOrder.count({
        where: {
          ...branchScope(scope),
          status: { in: ["DRAFT", "SUBMITTED", "PARTIALLY_RECEIVED"] },
        },
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

  async getValuation(scope: BranchScope) {
    const items = await this.prisma.stockItem.findMany({
      where: { ...branchScope(scope), isActive: true },
      select: {
        id: true,
        name: true,
        unit: true,
        currentStock: true,
        costPerUnit: true,
      },
    });

    const itemValuations = items.map((item) => ({
      ...item,
      totalValue: Number(item.currentStock) * Number(item.costPerUnit),
    }));

    const totalValue = itemValuations.reduce(
      (sum, item) => sum + item.totalValue,
      0,
    );

    return {
      totalValue,
      itemCount: items.length,
      items: itemValuations.sort((a, b) => b.totalValue - a.totalValue),
    };
  }

  async getMovementSummary(
    scope: BranchScope,
    startDate?: string,
    endDate?: string,
  ) {
    const where: any = { ...branchScope(scope) };
    const window = parseWindow(startDate, endDate);
    if (window.gte || window.lte) where.createdAt = window;

    const byType = await this.prisma.ingredientMovement.groupBy({
      by: ["type"],
      where,
      _sum: { quantity: true },
      _count: true,
    });

    return { byType };
  }
}
