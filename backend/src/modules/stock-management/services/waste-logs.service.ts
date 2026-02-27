import { Injectable, BadRequestException } from '@nestjs/common';
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

  async create(dto: CreateWasteLogDto, tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const stockItem = await tx.stockItem.findFirst({
        where: { id: dto.stockItemId, tenantId },
      });
      if (!stockItem) throw new BadRequestException('Stock item not found');

      const newStock = Number(stockItem.currentStock) - dto.quantity;
      if (newStock < 0) {
        throw new BadRequestException(
          `Cannot waste more than current stock. Current: ${stockItem.currentStock}, Requested: ${dto.quantity}`,
        );
      }

      // Deduct stock
      await tx.stockItem.update({
        where: { id: stockItem.id },
        data: { currentStock: newStock },
      });

      // Calculate waste cost
      const cost = dto.quantity * Number(stockItem.costPerUnit);

      // Create waste log
      const wasteLog = await tx.wasteLog.create({
        data: {
          quantity: dto.quantity,
          reason: dto.reason,
          notes: dto.notes,
          cost,
          stockItemId: dto.stockItemId,
          tenantId,
        },
        include: { stockItem: { select: { id: true, name: true, unit: true } } },
      });

      // Create movement record
      await tx.ingredientMovement.create({
        data: {
          type: IngredientMovementType.WASTE,
          quantity: -dto.quantity,
          costPerUnit: Number(stockItem.costPerUnit),
          notes: `Waste: ${dto.reason}${dto.notes ? ` - ${dto.notes}` : ''}`,
          referenceType: 'WASTE_LOG',
          referenceId: wasteLog.id,
          stockItemId: dto.stockItemId,
          tenantId,
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
