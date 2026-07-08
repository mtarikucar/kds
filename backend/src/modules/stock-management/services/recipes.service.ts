import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { CreateRecipeDto, RecipeIngredientDto } from "../dto/create-recipe.dto";
import { UpdateRecipeDto } from "../dto/update-recipe.dto";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";
import { RecipeCostingService } from "./recipe-costing.service";

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
  constructor(
    private prisma: PrismaService,
    private costing: RecipeCostingService,
  ) {}

  async findAll(
    scope: BranchScope,
    pagination?: { limit?: number; offset?: number },
  ) {
    const take = Math.min(
      pagination?.limit ?? RECIPES_DEFAULT_TAKE,
      RECIPES_HARD_MAX_TAKE,
    );
    const skip = pagination?.offset ?? 0;
    const recipes = await this.prisma.recipe.findMany({
      where: { ...branchScope(scope) },
      include: {
        product: { select: { id: true, name: true, price: true } },
        ingredients: {
          include: {
            stockItem: {
              select: {
                id: true,
                name: true,
                unit: true,
                currentStock: true,
                costPerUnit: true,
              },
            },
          },
        },
        // Nested BOM: sub-recipe components with their own stock ingredients, so
        // plate costing rolls the sub-recipe cost into the parent.
        components: {
          include: {
            subRecipe: {
              include: {
                ingredients: {
                  include: {
                    stockItem: { select: { costPerUnit: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });
    // Attach plate costing (cost/portion, food-cost %, margin) to every recipe.
    return recipes.map((r) => ({ ...r, costing: this.costing.compute(r) }));
  }

  async findOne(id: string, scope: BranchScope) {
    const recipe = await this.prisma.recipe.findFirst({
      where: { id, ...branchScope(scope) },
      include: {
        product: { select: { id: true, name: true, price: true } },
        ingredients: {
          include: {
            stockItem: {
              select: {
                id: true,
                name: true,
                unit: true,
                currentStock: true,
                costPerUnit: true,
              },
            },
          },
        },
        // Nested BOM: sub-recipe components with their own stock ingredients, so
        // plate costing rolls the sub-recipe cost into the parent.
        components: {
          include: {
            subRecipe: {
              include: {
                ingredients: {
                  include: {
                    stockItem: { select: { costPerUnit: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!recipe) throw new NotFoundException("Recipe not found");
    return { ...recipe, costing: this.costing.compute(recipe) };
  }

  async findByProduct(productId: string, scope: BranchScope) {
    const recipe = await this.prisma.recipe.findFirst({
      where: { productId, ...branchScope(scope) },
      include: {
        product: { select: { id: true, name: true, price: true } },
        ingredients: {
          include: {
            stockItem: {
              select: {
                id: true,
                name: true,
                unit: true,
                currentStock: true,
                costPerUnit: true,
              },
            },
          },
        },
        // Nested BOM: sub-recipe components with their own stock ingredients, so
        // plate costing rolls the sub-recipe cost into the parent.
        components: {
          include: {
            subRecipe: {
              include: {
                ingredients: {
                  include: {
                    stockItem: { select: { costPerUnit: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!recipe)
      throw new NotFoundException("No recipe found for this product");
    return { ...recipe, costing: this.costing.compute(recipe) };
  }

  /** Plate costing only (cost/portion, food-cost %, gross margin, breakdown). */
  async getCosting(id: string, scope: BranchScope) {
    const recipe = await this.findOne(id, scope);
    return {
      recipeId: recipe.id,
      productId: recipe.productId,
      productName: recipe.product?.name ?? null,
      yield: recipe.yield,
      ...recipe.costing,
    };
  }

  async create(dto: CreateRecipeDto, tenantId: string, branchId: string) {
    // Iter-93: reject duplicate ingredients up front — see
    // assertUniqueIngredients comment for the double-deduction bug.
    assertUniqueIngredients(dto.ingredients);

    // Verify product exists and belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
    });
    if (!product) throw new BadRequestException("Product not found");

    // v3 branch-scope: a product carries one recipe PER BRANCH (the
    // unique key is now [productId, branchId]). Branch A and branch B may
    // each define their own recipe for the same product — so the
    // "already exists" guard must include branchId, otherwise the second
    // branch would be wrongly rejected.
    const existing = await this.prisma.recipe.findUnique({
      where: {
        productId_branchId: { productId: dto.productId, branchId },
      },
    });
    if (existing)
      throw new ConflictException(
        "A recipe already exists for this product in this branch",
      );

    // deep-review H12: scope the stock-item existence check to the
    // recipe's branch (mirrors update() and PO create). A recipe whose
    // ingredient referenced another branch's stock item would, on order
    // deduction, drive down the WRONG branch's stock/batches/cost basis
    // — silent cross-branch inventory corruption. Filtering on branchId
    // here makes the length check below reject any ingredient not in the
    // recipe's branch.
    const stockItemIds = dto.ingredients.map((i) => i.stockItemId);
    const stockItems = await this.prisma.stockItem.findMany({
      where: { id: { in: stockItemIds }, tenantId, branchId },
    });
    if (stockItems.length !== stockItemIds.length) {
      throw new BadRequestException("One or more stock items not found");
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
            recipeUnit: i.recipeUnit ?? null,
            conversionFactor: i.conversionFactor ?? null,
          })),
        },
        components: dto.components?.length
          ? {
              create: dto.components.map((c) => ({
                subRecipeId: c.subRecipeId,
                quantity: c.quantity,
                recipeUnit: c.recipeUnit ?? null,
                conversionFactor: c.conversionFactor ?? null,
              })),
            }
          : undefined,
      },
      include: {
        product: { select: { id: true, name: true, price: true } },
        ingredients: {
          include: {
            stockItem: {
              select: { id: true, name: true, unit: true, currentStock: true },
            },
          },
        },
      },
    });
  }

  async update(id: string, dto: UpdateRecipeDto, scope: BranchScope) {
    const recipe = await this.findOne(id, scope);

    return this.prisma.$transaction(async (tx) => {
      // Defence-in-depth: even though findOne above checked scope, the
      // mutation itself must filter by (tenantId, branchId) so a
      // regression that drops the pre-check can't expose cross-branch
      // writes.
      const updated = await tx.recipe.updateMany({
        where: { id, ...branchScope(scope) },
        data: {
          name: dto.name,
          notes: dto.notes,
          yield: dto.yield,
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException("Recipe not found");
      }

      // Replace ingredients if provided
      if (dto.ingredients) {
        // Iter-93: same dedup gate as create. Update can pass duplicates too.
        assertUniqueIngredients(dto.ingredients);

        // Verify all stock items exist within this branch — ingredients
        // can only reference stock items in the same branch as the recipe.
        const stockItemIds = dto.ingredients.map((i) => i.stockItemId);
        const stockItems = await tx.stockItem.findMany({
          where: { id: { in: stockItemIds }, ...branchScope(scope) },
        });
        if (stockItems.length !== stockItemIds.length) {
          throw new BadRequestException("One or more stock items not found");
        }

        // Delete existing ingredients
        await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });

        // Create new ingredients
        await tx.recipeIngredient.createMany({
          data: dto.ingredients.map((i) => ({
            recipeId: id,
            stockItemId: i.stockItemId,
            quantity: i.quantity,
            recipeUnit: i.recipeUnit ?? null,
            conversionFactor: i.conversionFactor ?? null,
          })),
        });
      }

      // Replace sub-recipe components if provided (nested BOM).
      if (dto.components) {
        if (dto.components.some((c) => c.subRecipeId === id)) {
          throw new BadRequestException("A recipe cannot include itself");
        }
        await tx.recipeSubComponent.deleteMany({ where: { recipeId: id } });
        if (dto.components.length > 0) {
          await tx.recipeSubComponent.createMany({
            data: dto.components.map((c) => ({
              recipeId: id,
              subRecipeId: c.subRecipeId,
              quantity: c.quantity,
              recipeUnit: c.recipeUnit ?? null,
              conversionFactor: c.conversionFactor ?? null,
            })),
          });
        }
      }

      return tx.recipe.findUnique({
        where: { id },
        include: {
          product: { select: { id: true, name: true, price: true } },
          ingredients: {
            include: {
              stockItem: {
                select: {
                  id: true,
                  name: true,
                  unit: true,
                  currentStock: true,
                },
              },
            },
          },
        },
      });
    });
  }

  async remove(id: string, scope: BranchScope) {
    const recipe = await this.findOne(id, scope);
    // Log loudly — deleting a recipe stops ingredient deduction for the
    // bound product without any other signal.
    const logger = new (await import("@nestjs/common")).Logger(
      "RecipesService",
    );
    logger.warn(
      `Recipe ${recipe.name ?? recipe.id} removed for product ${recipe.productId}; ingredient auto-deduction for this product has stopped.`,
    );
    // Compound WHERE — defence-in-depth IDOR (B41-B45 pattern), now
    // branch-fenced so a cross-branch recipe id can't be deleted.
    const result = await this.prisma.recipe.deleteMany({
      where: { id, ...branchScope(scope) },
    });
    if (result.count === 0) {
      throw new BadRequestException("Recipe not found");
    }
    return { id };
  }

  async checkStock(id: string, scope: BranchScope, quantity: number = 1) {
    const recipe = await this.findOne(id, scope);

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
          return perUnit > 0
            ? Math.floor(Number(ingredient.stockItem.currentStock) / perUnit)
            : Infinity;
        }),
      ),
      ingredients: results,
    };
  }
}
