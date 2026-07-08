import { Prisma } from '@prisma/client';
import { RecipeCostingService } from './recipe-costing.service';

/**
 * Plate costing — the foundation for food-cost %, gross margin, menu
 * engineering and theoretical vs actual variance. Cost data (StockItem
 * .costPerUnit + RecipeIngredient.quantity) already exists; this rolls it up.
 * All arithmetic is Prisma.Decimal so a long ingredient list doesn't bleed
 * IEEE-754 dust into money.
 */
describe('RecipeCostingService', () => {
  const svc = new RecipeCostingService();
  const d = (v: string) => new Prisma.Decimal(v);

  it('sums ingredient line costs and divides by yield for cost-per-portion', () => {
    // 2 kg flour @ 10 + 0.5 kg sugar @ 20 = 20 + 10 = 30 total; yield 4 → 7.5/portion
    const res = svc.compute({
      yield: 4,
      product: { price: d('30.00') },
      ingredients: [
        { quantity: d('2'), stockItem: { id: 'flour', name: 'Flour', unit: 'KG', costPerUnit: d('10') } },
        { quantity: d('0.5'), stockItem: { id: 'sugar', name: 'Sugar', unit: 'KG', costPerUnit: d('20') } },
      ],
    });
    expect(res.totalRecipeCost).toBe(30);
    expect(res.costPerPortion).toBe(7.5);
    // food-cost % = 7.5 / 30 * 100 = 25%
    expect(res.foodCostPct).toBe(25);
    // gross margin per portion = 30 - 7.5 = 22.5
    expect(res.grossMargin).toBe(22.5);
    expect(res.ingredients).toHaveLength(2);
    expect(res.ingredients[0]).toMatchObject({ stockItemId: 'flour', lineCost: 20 });
  });

  it('treats a missing costPerUnit as zero (un-costed ingredient)', () => {
    const res = svc.compute({
      yield: 1,
      product: { price: d('50') },
      ingredients: [
        { quantity: d('1'), stockItem: { id: 'a', name: 'A', unit: 'PCS', costPerUnit: null } },
        { quantity: d('2'), stockItem: { id: 'b', name: 'B', unit: 'PCS', costPerUnit: d('5') } },
      ],
    });
    expect(res.costPerPortion).toBe(10); // only b contributes
    expect(res.ingredients[0].lineCost).toBe(0);
  });

  it('returns null food-cost % and margin when the product has no sell price', () => {
    const res = svc.compute({
      yield: 1,
      product: { price: null },
      ingredients: [{ quantity: d('1'), stockItem: { id: 'a', name: 'A', unit: 'PCS', costPerUnit: d('4') } }],
    });
    expect(res.costPerPortion).toBe(4);
    expect(res.foodCostPct).toBeNull();
    expect(res.grossMargin).toBeNull();
  });

  it('returns null food-cost % when price is zero (avoid divide-by-zero)', () => {
    const res = svc.compute({
      yield: 1,
      product: { price: d('0') },
      ingredients: [{ quantity: d('1'), stockItem: { id: 'a', costPerUnit: d('4') } }],
    });
    expect(res.foodCostPct).toBeNull();
  });

  it('defaults yield to 1 when missing or non-positive', () => {
    const res = svc.compute({
      yield: 0,
      product: { price: d('10') },
      ingredients: [{ quantity: d('3'), stockItem: { costPerUnit: d('2') } }],
    });
    expect(res.costPerPortion).toBe(6); // 3*2 / 1
  });

  it('keeps Decimal precision (no float drift over many small ingredients)', () => {
    const ingredients = Array.from({ length: 3 }, () => ({
      quantity: d('0.1'),
      stockItem: { costPerUnit: d('0.2') },
    }));
    // 3 × (0.1 × 0.2) = 3 × 0.02 = 0.06 exactly (float would give 0.06000000000000001)
    const res = svc.compute({ yield: 1, product: { price: d('1') }, ingredients });
    expect(res.totalRecipeCost).toBe(0.06);
  });
});

describe('RecipeCostingService — recipe-unit conversion', () => {
  const svc = new RecipeCostingService();
  const d = (v: string) => new Prisma.Decimal(v);

  it('converts a recipe-unit quantity to base units for line cost (200 G of a KG item)', () => {
    // 200 G with factor 0.001 (G→KG) = 0.2 KG × 10/KG = 2.00
    const res = svc.compute({
      yield: 1,
      product: { price: d('20') },
      ingredients: [
        { quantity: d('200'), conversionFactor: d('0.001'), stockItem: { id: 'flour', costPerUnit: d('10') } },
      ],
    });
    expect(res.totalRecipeCost).toBe(2);
    expect(res.costPerPortion).toBe(2);
    // displayed quantity stays as entered (recipe unit)
    expect(res.ingredients[0].quantity).toBe(200);
  });

  it('treats a null/zero factor as base-unit (1:1), unchanged', () => {
    const res = svc.compute({
      yield: 1,
      product: { price: d('20') },
      ingredients: [{ quantity: d('2'), stockItem: { costPerUnit: d('10') } }],
    });
    expect(res.totalRecipeCost).toBe(20);
  });
});
