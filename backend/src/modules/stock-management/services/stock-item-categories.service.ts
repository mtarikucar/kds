import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateStockItemCategoryDto } from '../dto/create-stock-item-category.dto';

@Injectable()
export class StockItemCategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.stockItemCategory.findMany({
      where: { tenantId },
      include: { _count: { select: { stockItems: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const category = await this.prisma.stockItemCategory.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { stockItems: true } } },
    });
    if (!category) throw new NotFoundException('Stock item category not found');
    return category;
  }

  async create(dto: CreateStockItemCategoryDto, tenantId: string) {
    const existing = await this.prisma.stockItemCategory.findUnique({
      where: { tenantId_name: { tenantId, name: dto.name } },
    });
    if (existing) throw new ConflictException('Category with this name already exists');

    return this.prisma.stockItemCategory.create({
      data: { ...dto, tenantId },
    });
  }

  async update(id: string, dto: Partial<CreateStockItemCategoryDto>, tenantId: string) {
    await this.findOne(id, tenantId);

    if (dto.name) {
      const existing = await this.prisma.stockItemCategory.findFirst({
        where: { tenantId, name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException('Category with this name already exists');
    }

    return this.prisma.stockItemCategory.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.stockItemCategory.delete({ where: { id } });
  }
}
