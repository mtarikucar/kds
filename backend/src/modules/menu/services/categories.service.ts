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

    return this.prisma.category.update({
      where: { id },
      data: updateCategoryDto,
    });
  }

  async remove(id: string, tenantId: string) {
    // Check if category exists and belongs to tenant
    await this.findOne(id, tenantId);

    // Check if category has products
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (category._count.products > 0) {
      throw new ConflictException(
        'Cannot delete category with existing products. Please delete or reassign products first.',
      );
    }

    return this.prisma.category.delete({
      where: { id },
    });
  }
}
