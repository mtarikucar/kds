import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto, tenantId: string) {
    return this.prisma.category.create({
      data: {
        name: createCategoryDto.name,
        description: createCategoryDto.description,
        displayOrder: createCategoryDto.displayOrder ?? 0,
        isActive: createCategoryDto.isActive ?? true,
        tenantId,
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.category.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const category = await this.prisma.category.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        products: {
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return category;
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto, tenantId: string) {
    // Check if category exists and belongs to tenant
    await this.findOne(id, tenantId);

    // Compound WHERE — IDOR guard (B41-B45 pattern).
    const claim = await this.prisma.category.updateMany({
      where: { id, tenantId },
      data: updateCategoryDto,
    });
    if (claim.count === 0) {
      throw new ConflictException('Category not found');
    }
    return this.prisma.category.findUnique({ where: { id } });
  }

  async remove(id: string, tenantId: string) {
    // Check if category exists and belongs to tenant
    await this.findOne(id, tenantId);

    // Tenant-filtered findFirst — findUnique by id alone was cross-tenant
    // readable, which leaked product counts. Now compound.
    const category = await this.prisma.category.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (category && category._count.products > 0) {
      throw new ConflictException(
        'Cannot delete category with existing products. Please delete or reassign products first.',
      );
    }

    return this.prisma.category.delete({
      where: { id, tenantId },
    });
  }
}
