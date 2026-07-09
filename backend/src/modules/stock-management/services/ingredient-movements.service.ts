import { Injectable, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { drawDownBatchesFifo } from "../../../common/stock/batch-drawdown";
import { CreateIngredientMovementDto } from "../dto/create-ingredient-movement.dto";
import { IngredientMovementType } from "../../../common/constants/stock-management.enum";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

// Iter-92: same window cap as waste-logs / analytics / reports. Bounds
// the worst-case findMany scan on a chain tenant with years of movement
// history.
const STOCK_LOG_MAX_RANGE_DAYS = 366;
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
    if (windowDays > STOCK_LOG_MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Date range cannot exceed ${STOCK_LOG_MAX_RANGE_DAYS} days. Split the request into smaller windows.`,
      );
    }
  }
  return window;
}

@Injectable()
export class IngredientMovementsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    scope: BranchScope,
    filters?: {
      stockItemId?: string;
      type?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: any = { ...branchScope(scope) };

    if (filters?.stockItemId) where.stockItemId = filters.stockItemId;
    if (filters?.type) where.type = filters.type;
    const window = parseWindow(filters?.startDate, filters?.endDate);
    if (window.gte || window.lte) where.createdAt = window;

    // Hard cap: ingredient movements grow without bound (every order
    // closure can write dozens). A no-filter list call on a year-old
    // tenant streamed 100k+ rows into Node memory before. 500 covers the
    // UI default page; callers needing more pass `limit` explicitly up
    // to the safety ceiling.
    const HARD_MAX = 5000;
    const take = Math.min(filters?.limit ?? 500, HARD_MAX);
    const skip = filters?.offset ?? 0;

    return this.prisma.ingredientMovement.findMany({
      where,
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });
  }

  async create(dto: CreateIngredientMovementDto, scope: BranchScope) {
    return this.prisma.$transaction(async (tx) => {
      const stockItem = await tx.stockItem.findFirst({
        where: { id: dto.stockItemId, ...branchScope(scope) },
      });
      if (!stockItem) throw new BadRequestException("Stock item not found");

      const quantityChange =
        dto.type === "OUT"
          ? -Math.abs(dto.quantity)
          : dto.type === "IN"
            ? Math.abs(dto.quantity)
            : dto.quantity; // ADJUSTMENT can be positive or negative

      const previousStock = Number(stockItem.currentStock);
      const newStock = previousStock + quantityChange;
      if (newStock < 0) {
        throw new BadRequestException(
          `Insufficient stock for ${stockItem.name}. Current: ${stockItem.currentStock}, Requested: ${Math.abs(quantityChange)}`,
        );
      }

      // Conditional write: previously this read currentStock then
      // wrote it back without checking it hadn't changed in flight,
      // so two concurrent OUT movements could each subtract the same
      // amount and oversell. Filter on the observed currentStock so
      // only one wins; the loser retries via the BadRequest below.
      const updated = await tx.stockItem.updateMany({
        where: {
          id: stockItem.id,
          ...branchScope(scope),
          currentStock: stockItem.currentStock,
        },
        data: { currentStock: newStock },
      });
      if (updated.count === 0) {
        throw new BadRequestException(
          `Stock for ${stockItem.name} changed mid-flight; please retry.`,
        );
      }

      // Keep the FIFO batch ledger in sync (mirrors waste/deduction/receive):
      // a manual OUT / negative ADJUSTMENT draws batches down oldest-first; a
      // manual IN / positive ADJUSTMENT adds a batch layer at the supplied or
      // current cost, so batch valuation + FIFO-COGS don't drift.
      if (quantityChange < 0) {
        await drawDownBatchesFifo(
          tx,
          {
            stockItemId: stockItem.id,
            tenantId: scope.tenantId,
            branchId: stockItem.branchId,
          },
          new Prisma.Decimal(Math.abs(quantityChange)),
        );
      } else if (quantityChange > 0) {
        await tx.stockBatch.create({
          data: {
            quantity: new Prisma.Decimal(quantityChange) as any,
            costPerUnit: new Prisma.Decimal(
              dto.costPerUnit ?? stockItem.costPerUnit ?? 0,
            ) as any,
            stockItemId: stockItem.id,
            tenantId: scope.tenantId,
            branchId: stockItem.branchId,
          },
        });
      }

      return tx.ingredientMovement.create({
        data: {
          type: dto.type,
          quantity: quantityChange,
          costPerUnit: dto.costPerUnit,
          notes: dto.notes,
          stockItemId: dto.stockItemId,
          tenantId: scope.tenantId,
          branchId: stockItem.branchId,
        },
        include: {
          stockItem: { select: { id: true, name: true, unit: true } },
        },
      });
    });
  }
}
