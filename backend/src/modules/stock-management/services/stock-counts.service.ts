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
    if (status) where.status = status;

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
          include: { stockItem: { select: { id: true, name: true, unit: true, currentStock: true } } },
        },
      },
    });
    if (!count) throw new NotFoundException('Stock count not found');
    return count;
  }

  async create(dto: CreateStockCountDto, tenantId: string, userId?: string) {
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

    return this.prisma.stockCountItem.update({
      where: { id: itemId },
      data: { countedQty: dto.countedQty, variance },
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
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
      for (const item of count.items) {
        if (item.countedQty === null) continue;
        const countedQty = new Prisma.Decimal(item.countedQty);

        // Tenant-scoped updateMany so a poisoned stockItemId from some
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

        await tx.stockItem.updateMany({
          where: { id: item.stockItemId, tenantId },
          data: { currentStock: countedQty as any },
        });

        await tx.ingredientMovement.create({
          data: {
            type: IngredientMovementType.COUNT_ADJUSTMENT,
            quantity: adjustment as any,
            notes: `Stock count adjustment: ${count.name || `Count #${count.id.slice(0, 8)}`}`,
            referenceType: 'STOCK_COUNT',
            referenceId: count.id,
            stockItemId: item.stockItemId,
            tenantId,
          },
        });
      }

      return tx.stockCount.update({
        where: { id },
        data: { status: StockCountStatus.COMPLETED, completedAt: new Date() },
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

    return this.prisma.stockCount.update({
      where: { id },
      data: { status: StockCountStatus.CANCELLED },
    });
  }
}
