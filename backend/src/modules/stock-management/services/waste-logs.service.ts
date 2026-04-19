import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateWasteLogDto } from '../dto/create-waste-log.dto';
import { IngredientMovementType } from '../../../common/constants/stock-management.enum';

@Injectable()
export class WasteLogsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, filters?: { stockItemId?: string; reason?: string; startDate?: string; endDate?: string }) {
    const where: any = { tenantId };
    if (filters?.stockItemId) where.stockItemId = filters.stockItemId;
    if (filters?.reason) where.reason = filters.reason;
    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
      if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
    }

    return this.prisma.wasteLog.findMany({
      where,
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { createdAt: 'desc' },
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

      const costPerUnit = stockItem.costPerUnit
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
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

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
