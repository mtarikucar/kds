import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateStockItemDto } from '../dto/create-stock-item.dto';
import { UpdateStockItemDto } from '../dto/update-stock-item.dto';
import { StockItemQueryDto } from '../dto/stock-item-query.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class StockItemsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, query: StockItemQueryDto) {
    const where: Prisma.StockItemWhereInput = { tenantId };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const orderBy: Prisma.StockItemOrderByWithRelationInput = {};
    if (query.sortBy) {
      orderBy[query.sortBy] = query.sortOrder || 'asc';
    } else {
      orderBy.name = 'asc';
    }

    return this.prisma.stockItem.findMany({
      where,
      include: { category: true },
      orderBy,
    });
  }

  async findOne(id: string, tenantId: string) {
    const item = await this.prisma.stockItem.findFirst({
      where: { id, tenantId },
      include: {
        category: true,
        batches: { where: { quantity: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
        supplierStockItems: { include: { supplier: true } },
      },
    });
    if (!item) throw new NotFoundException('Stock item not found');
    return item;
  }

  async create(dto: CreateStockItemDto, tenantId: string) {
    return this.prisma.stockItem.create({
      // Empty-string SKU collides on the @@unique([tenantId, sku])
      // constraint while null is allowed to repeat. Normalise here.
      data: { ...dto, sku: dto.sku ? dto.sku : null, tenantId },
      include: { category: true },
    });
  }

  async update(id: string, dto: UpdateStockItemDto, tenantId: string) {
    await this.findOne(id, tenantId);
    const data =
      'sku' in dto ? { ...dto, sku: dto.sku ? dto.sku : null } : dto;
    return this.prisma.stockItem.update({
      where: { id },
      data,
      include: { category: true },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);

    // Prevent deletion of stock items used in active recipes
    const recipeUsage = await this.prisma.recipeIngredient.findFirst({
      where: { stockItemId: id },
      include: { recipe: { select: { name: true } } },
    });
    if (recipeUsage) {
      throw new BadRequestException(
        `Cannot delete: stock item is used in recipe "${recipeUsage.recipe.name}"`,
      );
    }

    return this.prisma.stockItem.delete({ where: { id } });
  }

  async findLowStockItems(tenantId: string) {
    // Use raw query for comparing two columns
    return this.prisma.$queryRaw`
      SELECT si.*, sic.name as "categoryName"
      FROM stock_items si
      LEFT JOIN stock_item_categories sic ON si."categoryId" = sic.id
      WHERE si."tenantId" = ${tenantId}
        AND si."isActive" = true
        AND si."currentStock" <= si."minStock"
      ORDER BY si."currentStock" ASC
    `;
  }

  async findExpiringSoon(tenantId: string, days: number = 3) {
    const alertDate = new Date();
    alertDate.setDate(alertDate.getDate() + days);

    return this.prisma.stockBatch.findMany({
      where: {
        tenantId,
        quantity: { gt: 0 },
        expiryDate: { lte: alertDate, gte: new Date() },
      },
      include: { stockItem: true },
      orderBy: { expiryDate: 'asc' },
    });
  }
}
