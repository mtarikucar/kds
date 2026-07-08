import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type Num = Prisma.Decimal | number | string | null | undefined;

function dec(v: Num): Prisma.Decimal {
  if (v == null) return new Prisma.Decimal(0);
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}
function round2(d: Prisma.Decimal): number {
  return d.toDecimalPlaces(2).toNumber();
}
function round1(d: Prisma.Decimal): number {
  return d.toDecimalPlaces(1).toNumber();
}

export interface RecipeCostingInput {
  yield?: number | null;
  product?: { price?: Num } | null;
  ingredients: Array<{
    quantity: Num;
    // Base units per 1 recipe unit; null = quantity is already in the base unit.
    conversionFactor?: Num;
    stockItem?: {
      id?: string;
      name?: string;
      unit?: string;
      costPerUnit?: Num;
    } | null;
  }>;
  // Nested BOM: sub-recipe components used by this recipe. Each contributes
  // quantity × the sub-recipe's cost-per-portion (recursively computed).
  components?: Array<{
    quantity: Num;
    conversionFactor?: Num;
    recipeUnit?: string | null;
    name?: string | null;
    subRecipe?: RecipeCostingInput | null;
  }>;
}

export interface RecipeCostingLine {
  stockItemId: string | null;
  name: string | null;
  unit: string | null;
  quantity: number;
  unitCost: number;
  lineCost: number;
}

export interface RecipeCostingResult {
  /** Cost of one produced portion (total recipe cost ÷ yield). */
  costPerPortion: number;
  /** Cost of the whole recipe batch (all portions). */
  totalRecipeCost: number;
  /** Product sell price, or null if the product carries no price. */
  sellPrice: number | null;
  /** costPerPortion / sellPrice × 100, or null when price is missing/zero. */
  foodCostPct: number | null;
  /** sellPrice − costPerPortion, or null when price is missing. */
  grossMargin: number | null;
  ingredients: RecipeCostingLine[];
}

/**
 * Plate costing — rolls RecipeIngredient quantities × StockItem.costPerUnit
 * (the moving-weighted-average cost the purchasing path already maintains) into
 * a per-portion cost, food-cost % and gross margin. Pure, Decimal-based, no I/O
 * — the reusable foundation for the costing report, menu engineering and
 * theoretical-vs-actual variance. An un-costed ingredient (null costPerUnit)
 * contributes zero rather than breaking the roll-up.
 */
@Injectable()
export class RecipeCostingService {
  compute(recipe: RecipeCostingInput, depth = 0): RecipeCostingResult {
    const yieldPortions = recipe?.yield && recipe.yield > 0 ? recipe.yield : 1;
    const MAX_DEPTH = 6; // cycle / runaway-nesting guard

    let total = new Prisma.Decimal(0);
    const ingredients: RecipeCostingLine[] = (recipe?.ingredients ?? []).map(
      (ing) => {
        const qty = dec(ing.quantity);
        // Convert the recipe-unit quantity to the stock base unit for costing
        // (costPerUnit is per base unit). Null/≤0 factor = base-unit (1:1).
        const rawFactor = dec(ing.conversionFactor);
        const factor = rawFactor.gt(0) ? rawFactor : new Prisma.Decimal(1);
        const baseQty = qty.mul(factor);
        const unitCost = dec(ing.stockItem?.costPerUnit);
        const lineCost = baseQty.mul(unitCost);
        total = total.add(lineCost);
        return {
          stockItemId: ing.stockItem?.id ?? null,
          name: ing.stockItem?.name ?? null,
          unit: ing.stockItem?.unit ?? null,
          quantity: qty.toNumber(),
          unitCost: round2(unitCost),
          lineCost: round2(lineCost),
        };
      },
    );

    // Nested BOM: each sub-recipe component contributes (converted quantity) ×
    // (the sub-recipe's cost-per-portion), computed recursively. Depth-capped
    // so a cyclic definition can't recurse forever.
    for (const comp of recipe?.components ?? []) {
      if (depth >= MAX_DEPTH || !comp.subRecipe) continue;
      const sub = this.compute(comp.subRecipe, depth + 1);
      const qty = dec(comp.quantity);
      const rawFactor = dec(comp.conversionFactor);
      const factor = rawFactor.gt(0) ? rawFactor : new Prisma.Decimal(1);
      const baseQty = qty.mul(factor);
      const subUnitCost = new Prisma.Decimal(sub.costPerPortion);
      const lineCost = baseQty.mul(subUnitCost);
      total = total.add(lineCost);
      ingredients.push({
        stockItemId: null,
        name: comp.name ?? (comp.subRecipe as any)?.name ?? "Sub-recipe",
        unit: comp.recipeUnit ?? null,
        quantity: qty.toNumber(),
        unitCost: round2(subUnitCost),
        lineCost: round2(lineCost),
      });
    }

    const perPortion = total.div(yieldPortions);
    const price =
      recipe?.product?.price != null ? dec(recipe.product.price) : null;

    const foodCostPct =
      price && price.gt(0) ? round1(perPortion.div(price).mul(100)) : null;
    const grossMargin = price ? round2(price.sub(perPortion)) : null;

    return {
      costPerPortion: round2(perPortion),
      totalRecipeCost: round2(total),
      sellPrice: price ? round2(price) : null,
      foodCostPct,
      grossMargin,
      ingredients,
    };
  }
}
