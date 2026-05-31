import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRecipeDto, RecipeIngredientDto } from '../dto/create-recipe.dto';
import { UpdateRecipeDto } from '../dto/update-recipe.dto';

// Iter-93: pagination cap on recipes list. Most tenants have ~50 distinct
// product recipes; large chains in our pipeline have ~500. 500 is a comfortable
// per-page default that still keeps the nested ingredient + product payload
// bounded.
const RECIPES_DEFAULT_TAKE = 500;
const RECIPES_HARD_MAX_TAKE = 2000;

/**
 * Iter-93: reject duplicate stockItemIds in the ingredients array.
 * Pre-fix, the createMany call passed `ingredients` through unfiltered, so
 * the same stock item appearing twice (e.g. `flour` listed twice with
 * 200g + 100g instead of one 300g entry) created two RecipeIngredient
 * rows. StockDeductionService then walked both rows on every order and
 * double-deducted flour — silently turning a typo into stock drift.
 *
 * Throwing here is the right call: the UI should consolidate duplicates
 * before submitting, and a silent rule (e.g. "keep the first") would
 * mask the user's actual intent.
 */
function assertUniqueIngredients(ingredients: RecipeIngredientDto[]): void {
  const seen = new Set<string>();
  for (const i of ingredients) {
    if (seen.has(i.stockItemId)) {
      throw new BadRequestException(
        `Duplicate ingredient ${i.stockItemId} — combine into one entry with the summed quantity`,
      );
    }
    seen.add(i.stockItemId);
  }
}

@Injectable()
export class RecipesService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    pagination?: { limit?: number; offset?: number },
  ) {
    const take = Math.min(pagination?.limit ?? RECIPES_DEFAULT_TAKE, RECIPES_HARD_MAX_TAKE);
    const skip = pagination?.offset ?? 0;
    return this.prisma.recipe.findMany({
      where: { tenantId },
      include: {
        product: { select: { id: true, name: true, price: true } },
        ingredients: {
          include: { stockItem: { select: { id: true, name: true, unit: true, currentStock: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
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

  async create(dto: CreateRecipeDto, tenantId: string, branchId: string) {
    // Iter-93: reject duplicate ingredients up front — see
    // assertUniqueIngredients comment for the double-deduction bug.
    assertUniqueIngredients(dto.ingredients);

    // Verify product exists and belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
    });
    if (!product) throw new BadRequestException('Product not found');

    // Check if recipe already exists for this product within this tenant
    const existing = await this.prisma.recipe.findFirst({
      where: { productId: dto.productId, tenantId },
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
        branchId,
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
      // Defence-in-depth: even though findOne above checked tenant, the
      // mutation itself must filter by tenantId so a regression that
      // drops the pre-check can't expose cross-tenant writes.
      const updated = await tx.recipe.updateMany({
        where: { id, tenantId },
        data: {
          name: dto.name,
          notes: dto.notes,
          yield: dto.yield,
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException('Recipe not found');
      }

      // Replace ingredients if provided
      if (dto.ingredients) {
        // Iter-93: same dedup gate as create. Update can pass duplicates too.
        assertUniqueIngredients(dto.ingredients);

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
    const recipe = await this.findOne(id, tenantId);
    // Log loudly — deleting a recipe stops ingredient deduction for the
    // bound product without any other signal.
    const logger = new (await import('@nestjs/common')).Logger('RecipesService');
    logger.warn(
      `Recipe ${recipe.name ?? recipe.id} removed for product ${recipe.productId}; ingredient auto-deduction for this product has stopped.`,
    );
    // Compound WHERE — defence-in-depth IDOR (B41-B45 pattern).
    const result = await this.prisma.recipe.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) {
      throw new BadRequestException('Recipe not found');
    }
    return { id };
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
