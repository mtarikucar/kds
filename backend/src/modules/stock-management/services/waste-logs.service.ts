import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateWasteLogDto } from '../dto/create-waste-log.dto';
import { IngredientMovementType } from '../../../common/constants/stock-management.enum';

// Iter-92: hard cap on the explicit date window for the waste log list /
// summary queries. Same memory-bound reasoning as iter-64 (reports) and
// iter-89 (analytics) — 366 days covers calendar-year + leap-year
// reporting while a 1970→2100 query can't scan the whole table.
const STOCK_LOG_MAX_RANGE_DAYS = 366;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TAKE = 500;

/**
 * Parse + validate a [startDate, endDate] window from already-IsDateString-
 * validated query strings. @IsDateString catches obvious garbage upstream;
 * this is defense-in-depth (e.g. 2025-02-30 passes @IsDateString but
 * constructs Invalid Date) plus the range cap that doesn't fit cleanly
 * into the DTO layer.
 */
function parseWindow(startDate?: string, endDate?: string): { gte?: Date; lte?: Date } {
  const window: { gte?: Date; lte?: Date } = {};
  let start: Date | undefined;
  let end: Date | undefined;
  if (startDate) {
    start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('startDate must be a valid ISO-8601 date');
    }
    window.gte = start;
  }
  if (endDate) {
    end = new Date(endDate);
    if (Number.isNaN(end.getTime())) {
      throw new BadRequestException('endDate must be a valid ISO-8601 date');
    }
    window.lte = end;
  }
  if (start && end) {
    if (start > end) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }
    const windowDays = (end.getTime() - start.getTime()) / MILLIS_PER_DAY;
    if (windowDays > STOCK_LOG_MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Date range cannot exceed ${STOCK_LOG_MAX_RANGE_DAYS} days. Split the request into smaller windows.`,
      );
    }
  }
  return window;
}

@Injectable()
export class WasteLogsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    filters?: {
      stockItemId?: string;
      reason?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: any = { tenantId };
    if (filters?.stockItemId) where.stockItemId = filters.stockItemId;
    if (filters?.reason) where.reason = filters.reason;
    const window = parseWindow(filters?.startDate, filters?.endDate);
    if (window.gte || window.lte) where.createdAt = window;

    // Iter-92: paginate. Pre-fix waste-logs returned every row for the
    // tenant in one shot — fine for a fresh tenant, an unbounded payload
    // for a chain doing thousands of waste entries a year.
    const take = filters?.limit ?? DEFAULT_TAKE;
    const skip = filters?.offset ?? 0;

    return this.prisma.wasteLog.findMany({
      where,
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async create(dto: CreateWasteLogDto, tenantId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const stockItem = await tx.stockItem.findFirst({
        where: { id: dto.stockItemId, tenantId },
      });
      if (!stockItem) throw new BadRequestException('Stock item not found');

      const wasteQty = new Prisma.Decimal(dto.quantity);

      // Atomic decrement: the updateMany only fires when
      // currentStock >= wasteQty, so two concurrent waste logs can't
      // both read the same pre-state and drive stock negative.
      const decremented = await tx.stockItem.updateMany({
        where: {
          id: stockItem.id,
          tenantId,
          currentStock: { gte: wasteQty as any },
        },
        data: { currentStock: { decrement: wasteQty as any } },
      });
      if (decremented.count === 0) {
        throw new ConflictException(
          `Cannot waste more than current stock. Current: ${stockItem.currentStock}, Requested: ${dto.quantity}`,
        );
      }

      // v2.8.97 — FIFO batch-weighted cost (same shape as v2.8.93
      // stock-deduction.applyDeduction). Pre-fix the waste log used
      // `stockItem.costPerUnit` which is the rolling average across
      // every receipt; for tenants whose supplier prices have moved
      // since the oldest still-in-stock batch arrived, the rolling
      // average misrepresents the cost of the units actually being
      // wasted (which by FIFO are the oldest). Consuming FIFO
      // batches and weighting by per-batch costPerUnit gives the
      // economically meaningful number.
      let remaining = wasteQty;
      const batches = await tx.stockBatch.findMany({
        where: { stockItemId: stockItem.id, tenantId, quantity: { gt: 0 } },
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
      });
      let consumed = new Prisma.Decimal(0);
      let weightedCostAcc = new Prisma.Decimal(0);
      for (const batch of batches) {
        if (remaining.lte(0)) break;
        const take = Prisma.Decimal.min(remaining, batch.quantity);
        const updated = await tx.stockBatch.updateMany({
          where: { id: batch.id, quantity: { gte: take } },
          data: { quantity: { decrement: take as any } },
        });
        if (updated.count === 0) continue;
        remaining = remaining.sub(take);
        consumed = consumed.add(take);
        if (batch.costPerUnit != null) {
          weightedCostAcc = weightedCostAcc.add(new Prisma.Decimal(batch.costPerUnit).mul(take));
        }
      }

      const costPerUnit =
        consumed.gt(0) && weightedCostAcc.gt(0)
          ? weightedCostAcc.div(consumed)
          : stockItem.costPerUnit
            ? new Prisma.Decimal(stockItem.costPerUnit)
            : null;
      const cost = costPerUnit
        ? wasteQty.mul(costPerUnit).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
        : null;

      const wasteLog = await tx.wasteLog.create({
        data: {
          quantity: wasteQty as any,
          reason: dto.reason,
          notes: dto.notes,
          cost: cost ? (cost as any) : undefined,
          stockItemId: dto.stockItemId,
          tenantId,
          createdById: userId,
        },
        include: { stockItem: { select: { id: true, name: true, unit: true } } },
      });

      await tx.ingredientMovement.create({
        data: {
          type: IngredientMovementType.WASTE,
          quantity: wasteQty.neg() as any,
          costPerUnit: costPerUnit ? (costPerUnit as any) : undefined,
          notes: `Waste: ${dto.reason}${dto.notes ? ` - ${dto.notes}` : ''}`,
          referenceType: 'WASTE_LOG',
          referenceId: wasteLog.id,
          stockItemId: dto.stockItemId,
          tenantId,
          createdById: userId,
        },
      });

      return wasteLog;
    });
  }

  async getSummary(tenantId: string, startDate?: string, endDate?: string) {
    const where: any = { tenantId };
    const window = parseWindow(startDate, endDate);
    if (window.gte || window.lte) where.createdAt = window;

    const [byReason, totalCost, recentLogs] = await Promise.all([
      this.prisma.wasteLog.groupBy({
        by: ['reason'],
        where,
        _sum: { quantity: true, cost: true },
        _count: true,
      }),
      this.prisma.wasteLog.aggregate({
        where,
        _sum: { cost: true },
        _count: true,
      }),
      this.prisma.wasteLog.findMany({
        where,
        include: { stockItem: { select: { id: true, name: true, unit: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      byReason,
      totalCost: totalCost._sum.cost || 0,
      totalCount: totalCost._count,
      recentLogs,
    };
  }
}
