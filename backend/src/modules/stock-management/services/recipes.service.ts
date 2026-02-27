import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRecipeDto } from '../dto/create-recipe.dto';
import { UpdateRecipeDto } from '../dto/update-recipe.dto';

@Injectable()
export class RecipesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.recipe.findMany({
      where: { tenantId },
      include: {
        product: { select: { id: true, name: true, price: true } },
        ingredients: {
          include: { stockItem: { select: { id: true, name: true, unit: true, currentStock: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const recipe = await this.prisma.recipe.findFirst({
      where: { id, tenantId },
      include: {
        product: { select: { id: true, name: true, price: true } },
        ingredients: {
          include: { stockItem: { select: { id: true, name: true, unit: true, currentStock: true, costPerUnit: true } } },
        },
      },
    });
    if (!recipe) throw new NotFoundException('Recipe not found');
    return recipe;
  }

  async findByProduct(productId: string, tenantId: string) {
    const recipe = await this.prisma.recipe.findFirst({
      where: { productId, tenantId },
      include: {
        product: { select: { id: true, name: true, price: true } },
        ingredients: {
          include: { stockItem: { select: { id: true, name: true, unit: true, currentStock: true, costPerUnit: true } } },
        },
      },
    });
    if (!recipe) throw new NotFoundException('No recipe found for this product');
    return recipe;
  }

  async create(dto: CreateRecipeDto, tenantId: string) {
    // Verify product exists and belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
    });
    if (!product) throw new BadRequestException('Product not found');

    // Check if recipe already exists for this product
    const existing = await this.prisma.recipe.findUnique({
      where: { productId: dto.productId },
    });
    if (existing) throw new ConflictException('A recipe already exists for this product');

    // Verify all stock items exist
    const stockItemIds = dto.ingredients.map((i) => i.stockItemId);
    const stockItems = await this.prisma.stockItem.findMany({
      where: { id: { in: stockItemIds }, tenantId },
    });
    if (stockItems.length !== stockItemIds.length) {
      throw new BadRequestException('One or more stock items not found');
    }

    return this.prisma.recipe.create({
      data: {
        name: dto.name || product.name,
        notes: dto.notes,
        yield: dto.yield || 1,
        productId: dto.productId,
        tenantId,
        ingredients: {
          create: dto.ingredients.map((i) => ({
            stockItemId: i.stockItemId,
            quantity: i.quantity,
          })),
        },
      },
      include: {
        product: { select: { id: true, name: true, price: true } },
        ingredients: {
          include: { stockItem: { select: { id: true, name: true, unit: true, currentStock: true } } },
        },
      },
    });
  }

  async update(id: string, dto: UpdateRecipeDto, tenantId: string) {
    const recipe = await this.findOne(id, tenantId);

    return this.prisma.$transaction(async (tx) => {
      // Update recipe fields
      await tx.recipe.update({
        where: { id },
        data: {
          name: dto.name,
          notes: dto.notes,
          yield: dto.yield,
        },
      });

      // Replace ingredients if provided
      if (dto.ingredients) {
        // Verify all stock items exist
        const stockItemIds = dto.ingredients.map((i) => i.stockItemId);
        const stockItems = await tx.stockItem.findMany({
          where: { id: { in: stockItemIds }, tenantId },
        });
        if (stockItems.length !== stockItemIds.length) {
          throw new BadRequestException('One or more stock items not found');
        }

        // Delete existing ingredients
        await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });

        // Create new ingredients
        await tx.recipeIngredient.createMany({
          data: dto.ingredients.map((i) => ({
            recipeId: id,
            stockItemId: i.stockItemId,
            quantity: i.quantity,
          })),
        });
      }

      return tx.recipe.findUnique({
        where: { id },
        include: {
          product: { select: { id: true, name: true, price: true } },
          ingredients: {
            include: { stockItem: { select: { id: true, name: true, unit: true, currentStock: true } } },
          },
        },
      });
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.recipe.delete({ where: { id } });
  }

  async checkStock(id: string, tenantId: string, quantity: number = 1) {
    const recipe = await this.findOne(id, tenantId);

    const results = recipe.ingredients.map((ingredient) => {
      const required = (Number(ingredient.quantity) / recipe.yield) * quantity;
      const available = Number(ingredient.stockItem.currentStock);
      return {
        stockItemId: ingredient.stockItem.id,
        name: ingredient.stockItem.name,
        unit: ingredient.stockItem.unit,
        required,
        available,
        sufficient: available >= required,
        shortage: available >= required ? 0 : required - available,
      };
    });

    return {
      canProduce: results.every((r) => r.sufficient),
      maxQuantity: Math.min(
        ...recipe.ingredients.map((ingredient) => {
          const perUnit = Number(ingredient.quantity) / recipe.yield;
          return perUnit > 0 ? Math.floor(Number(ingredient.stockItem.currentStock) / perUnit) : Infinity;
        }),
      ),
      ingredients: results,
    };
  }
}
