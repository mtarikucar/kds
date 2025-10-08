import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto, tenantId: string) {
    // Verify category exists and belongs to tenant
    const category = await this.prisma.category.findFirst({
      where: {
        id: createProductDto.categoryId,
        tenantId,
      },
    });

    if (!category) {
      throw new BadRequestException('Invalid category or category does not belong to your tenant');
    }

    return this.prisma.product.create({
      data: {
        name: createProductDto.name,
        description: createProductDto.description,
        price: createProductDto.price,
        image: createProductDto.image,
        isAvailable: createProductDto.isAvailable ?? true,
        stockTracked: createProductDto.stockTracked ?? false,
        currentStock: createProductDto.currentStock ?? 0,
        categoryId: createProductDto.categoryId,
        tenantId,
      },
      include: {
        category: true,
      },
    });
  }

  async findAll(tenantId: string, categoryId?: string) {
    const where: any = { tenantId };
    if (categoryId) {
      where.categoryId = categoryId;
    }

    return this.prisma.product.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        category: true,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto, tenantId: string) {
    // Check if product exists and belongs to tenant
    await this.findOne(id, tenantId);

    // If category is being updated, verify it exists and belongs to tenant
    if (updateProductDto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: {
          id: updateProductDto.categoryId,
          tenantId,
        },
      });

      if (!category) {
        throw new BadRequestException('Invalid category or category does not belong to your tenant');
      }
    }

    return this.prisma.product.update({
      where: { id },
      data: updateProductDto,
      include: {
        category: true,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    // Check if product exists and belongs to tenant
    await this.findOne(id, tenantId);

    return this.prisma.product.delete({
      where: { id },
    });
  }

  async updateStock(id: string, quantity: number, tenantId: string) {
    // Check if product exists and belongs to tenant
    const product = await this.findOne(id, tenantId);

    if (!product.stockTracked) {
      throw new BadRequestException('Stock tracking is not enabled for this product');
    }

    const newStock = product.currentStock + quantity;

    if (newStock < 0) {
      throw new BadRequestException('Insufficient stock');
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        currentStock: newStock,
        isAvailable: newStock > 0,
      },
      include: {
        category: true,
      },
    });
  }
}
