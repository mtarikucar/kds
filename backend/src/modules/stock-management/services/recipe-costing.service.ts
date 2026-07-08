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
    stockItem?: {
      id?: string;
      name?: string;
      unit?: string;
      costPerUnit?: Num;
    } | null;
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
  compute(recipe: RecipeCostingInput): RecipeCostingResult {
    const yieldPortions =
      recipe?.yield && recipe.yield > 0 ? recipe.yield : 1;

    let total = new Prisma.Decimal(0);
    const ingredients: RecipeCostingLine[] = (recipe?.ingredients ?? []).map(
      (ing) => {
        const qty = dec(ing.quantity);
        const unitCost = dec(ing.stockItem?.costPerUnit);
        const lineCost = qty.mul(unitCost);
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
