import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateStockCountDto } from '../dto/create-stock-count.dto';
import { UpdateStockCountItemDto } from '../dto/update-stock-count-item.dto';
import { StockCountStatus, IngredientMovementType } from '../../../common/constants/stock-management.enum';

@Injectable()
export class StockCountsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, status?: string) {
    const where: any = { tenantId };
    if (status !== undefined) {
      // Iter-94: allowlist the status filter. Pre-fix the controller
      // accepted any string and forwarded it straight to Prisma; an
      // unknown value (typo `?status=DONE`) would silently match no
      // rows and the caller saw an empty list. Reject at the boundary
      // with a clear 400.
      const allowed = Object.values(StockCountStatus) as string[];
      if (!allowed.includes(status)) {
        throw new BadRequestException(
          `status must be one of: ${allowed.join(', ')}`,
        );
      }
      where.status = status;
    }

    return this.prisma.stockCount.findMany({
      where,
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const count = await this.prisma.stockCount.findFirst({
      where: { id, tenantId },
      include: {
        items: {
          include: { stockItem: { select: { id: true, name: true, unit: true, currentStock: true, branchId: true } } },
        },
      },
    });
    if (!count) throw new NotFoundException('Stock count not found');
    return count;
  }

  async create(dto: CreateStockCountDto, tenantId: string, branchId: string, userId?: string) {
    const itemsWhere: Prisma.StockItemWhereInput = { tenantId, isActive: true };
    if (dto.stockItemIds?.length) {
      itemsWhere.id = { in: dto.stockItemIds };
    }

    const stockItems = await this.prisma.stockItem.findMany({
      where: itemsWhere,
      select: { id: true, currentStock: true },
    });
    if (stockItems.length === 0) {
      throw new BadRequestException('No stock items found for counting');
    }

    // Refuse to start a second IN_PROGRESS count that overlaps with an
    // existing one — two parallel counts against the same items would
    // apply each other's stale variances on finalize.
    const existing = await this.prisma.stockCount.findFirst({
      where: {
        tenantId,
        status: StockCountStatus.IN_PROGRESS,
        items: { some: { stockItemId: { in: stockItems.map((s) => s.id) } } },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'Another stock count is already in progress for one or more of these items',
      );
    }

    return this.prisma.stockCount.create({
      data: {
        name: dto.name,
        notes: dto.notes,
        tenantId,
        branchId,
        createdById: userId,
        items: {
          create: stockItems.map((item) => ({
            stockItemId: item.id,
            expectedQty: item.currentStock,
          })),
        },
      },
      include: {
        items: {
          include: { stockItem: { select: { id: true, name: true, unit: true, currentStock: true } } },
        },
      },
    });
  }

  async updateItem(countId: string, itemId: string, dto: UpdateStockCountItemDto, tenantId: string) {
    const count = await this.findOne(countId, tenantId);
    if (count.status !== StockCountStatus.IN_PROGRESS) {
      throw new BadRequestException('Can only update items in an in-progress count');
    }

    const countItem = count.items.find((i) => i.id === itemId);
    if (!countItem) throw new NotFoundException('Stock count item not found');

    const variance = dto.countedQty - Number(countItem.expectedQty);

    // Defence-in-depth: stockCountItem doesn't carry tenantId directly,
    // but the parent `count` row does — scope by both the row id and
    // its parent count's tenantId so a regression of the pre-check
    // above can't be exploited cross-tenant.
    const result = await this.prisma.stockCountItem.updateMany({
      where: { id: itemId, stockCount: { tenantId } },
      data: { countedQty: dto.countedQty, variance },
    });
    if (result.count === 0) {
      throw new NotFoundException('Stock count item not found');
    }
    return this.prisma.stockCountItem.findUnique({
      where: { id: itemId },
      include: { stockItem: { select: { id: true, name: true, unit: true, branchId: true } } },
    });
  }

  async finalize(id: string, tenantId: string) {
    const count = await this.findOne(id, tenantId);
    if (count.status !== StockCountStatus.IN_PROGRESS) {
      throw new BadRequestException('Can only finalize an in-progress count');
    }

    // Ensure all items have been counted
    const uncounted = count.items.filter((i) => i.countedQty === null);
    if (uncounted.length > 0) {
      throw new BadRequestException(
        `${uncounted.length} items have not been counted yet`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Iter-94: claim the count atomically by flipping IN_PROGRESS →
      // COMPLETED *before* applying any per-item adjustment. Pre-fix
      // the status flip lived at the END of the loop with no compound
      // WHERE on the current status, so two concurrent finalize calls
      // both passed the pre-check above and double-applied every
      // adjustment. Claim-first means the second caller's updateMany
      // returns count===0 and the txn aborts before any increment is
      // emitted.
      const claim = await tx.stockCount.updateMany({
        where: { id, tenantId, status: StockCountStatus.IN_PROGRESS },
        data: { status: StockCountStatus.COMPLETED, completedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new ConflictException(
          'Stock count was finalized or cancelled concurrently — refresh and retry.',
        );
      }

      for (const item of count.items) {
        if (item.countedQty === null) continue;
        const countedQty = new Prisma.Decimal(item.countedQty);

        // Tenant-scoped lookup so a poisoned stockItemId from some
        // other tenant cannot be overwritten here.
        const current = await tx.stockItem.findFirst({
          where: { id: item.stockItemId, tenantId },
        });
        if (!current) continue;

        // Compare against the CURRENT stock (not the stale
        // expectedQty snapshot taken at count creation) so order
        // deductions that happened during the count are correctly
        // netted out. `variance` stays as reporting metadata.
        const adjustment = countedQty.sub(current.currentStock);
        if (adjustment.isZero()) continue;

        // Iter-94: write as a DELTA, not as an absolute set. Pre-fix
        // the update set `currentStock: countedQty` outright — a
        // concurrent order-deduction that committed between this txn's
        // read above and write below was silently reversed (the count
        // overwrote whatever currentStock the order had decremented
        // to). With increment, the adjustment composes with concurrent
        // changes: if 5 more units were sold mid-finalize, the final
        // stock = (current - 5) + adjustment = countedQty - 5, which
        // correctly reflects both events.
        await tx.stockItem.updateMany({
          where: { id: item.stockItemId, tenantId },
          data: { currentStock: { increment: adjustment as any } },
        });

        await tx.ingredientMovement.create({
          data: {
            type: IngredientMovementType.COUNT_ADJUSTMENT,
            quantity: adjustment as any,
            notes: `Stock count adjustment: ${count.name || `Count #${count.id.slice(0, 8)}`}`,
            referenceType: 'STOCK_COUNT',
            referenceId: count.id,
            stockItemId: item.stockItemId,
            branchId: item.stockItem.branchId,
            tenantId,
          },
        });
      }

      return tx.stockCount.findUnique({
        where: { id },
        include: {
          items: {
            include: { stockItem: { select: { id: true, name: true, unit: true, currentStock: true } } },
          },
        },
      });
    });
  }

  async cancel(id: string, tenantId: string) {
    const count = await this.findOne(id, tenantId);
    if (count.status !== StockCountStatus.IN_PROGRESS) {
      throw new BadRequestException('Can only cancel an in-progress count');
    }

    // Defence-in-depth IDOR — tenantId in the WHERE.
    await this.prisma.stockCount.updateMany({
      where: { id, tenantId },
      data: { status: StockCountStatus.CANCELLED },
    });
    return this.prisma.stockCount.findFirstOrThrow({ where: { id, tenantId } });
  }
}
