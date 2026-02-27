import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateIngredientMovementDto } from '../dto/create-ingredient-movement.dto';
import { IngredientMovementType } from '../../../common/constants/stock-management.enum';

@Injectable()
export class IngredientMovementsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    filters?: {
      stockItemId?: string;
      type?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    const where: any = { tenantId };

    if (filters?.stockItemId) where.stockItemId = filters.stockItemId;
    if (filters?.type) where.type = filters.type;
    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
      if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
    }

    return this.prisma.ingredientMovement.findMany({
      where,
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateIngredientMovementDto, tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const stockItem = await tx.stockItem.findFirst({
        where: { id: dto.stockItemId, tenantId },
      });
      if (!stockItem) throw new BadRequestException('Stock item not found');

      const quantityChange =
        dto.type === 'OUT'
          ? -Math.abs(dto.quantity)
          : dto.type === 'IN'
            ? Math.abs(dto.quantity)
            : dto.quantity; // ADJUSTMENT can be positive or negative

      const newStock = Number(stockItem.currentStock) + quantityChange;
      if (newStock < 0) {
        throw new BadRequestException(
          `Insufficient stock for ${stockItem.name}. Current: ${stockItem.currentStock}, Requested: ${Math.abs(quantityChange)}`,
        );
      }

      await tx.stockItem.update({
        where: { id: stockItem.id },
        data: { currentStock: newStock },
      });

      return tx.ingredientMovement.create({
        data: {
          type: dto.type,
          quantity: quantityChange,
          costPerUnit: dto.costPerUnit,
          notes: dto.notes,
          stockItemId: dto.stockItemId,
          tenantId,
        },
        include: { stockItem: { select: { id: true, name: true, unit: true } } },
      });
    });
  }
}
