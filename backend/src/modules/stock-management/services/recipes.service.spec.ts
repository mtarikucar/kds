import { BadRequestException } from '@nestjs/common';
import { RecipesService } from './recipes.service';

/**
 * Iter-93 regression for the recipes service. Pre-fix:
 *
 *   - `create` and `update` accepted `ingredients: [{ stockItemId, quantity }]`
 *     and passed the array to Prisma's createMany unchanged. A typo'd
 *     payload listing the same `stockItemId` twice (e.g. `flour` 200g
 *     then `flour` 100g instead of one 300g entry) created two
 *     RecipeIngredient rows. StockDeductionService then walked both
 *     rows on every order and double-deducted the item — silently
 *     drifting stock counts.
 *   - `findAll` returned every recipe for the tenant in one shot with
 *     nested ingredient + product data and no pagination.
 *
 * The fix throws a clear 400 on duplicate stockItemIds (no silent
 * "first wins") and paginates findAll behind a default-500, cap-2000
 * window.
 */
describe('RecipesService (iter-93)', () => {
  const validIngredient = (stockItemId: string, qty: number = 1) => ({
    stockItemId,
    quantity: qty,
  });

  describe('create — duplicate-ingredient guard', () => {
    let prisma: any;
    let svc: RecipesService;

    beforeEach(() => {
      prisma = {
        product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', tenantId: 't1', name: 'Burger' }) },
        // v3 branch-scope: the existing-recipe guard now keys on the
        // compound (productId, branchId) via findUnique, so the mock must
        // expose findUnique (null = no recipe yet for this product+branch).
        recipe: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
        stockItem: { findMany: jest.fn() },
      };
      svc = new RecipesService(prisma);
    });

    it('rejects two ingredient entries for the same stockItemId', async () => {
      await expect(
        svc.create(
          {
            productId: 'p1',
            ingredients: [
              validIngredient('flour-uuid', 200),
              validIngredient('flour-uuid', 100),
            ],
          } as any,
          't1',
          'b1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Never reach the DB writes.
      expect(prisma.recipe.create).not.toHaveBeenCalled();
    });

    it('mentions the offending stockItemId in the error message', async () => {
      await expect(
        svc.create(
          {
            productId: 'p1',
            ingredients: [
              validIngredient('butter-uuid', 50),
              validIngredient('butter-uuid', 50),
            ],
          } as any,
          't1',
          'b1',
        ),
      ).rejects.toThrow(/butter-uuid/);
    });

    it('accepts a recipe with all distinct ingredients (happy path)', async () => {
      prisma.stockItem.findMany.mockResolvedValue([
        { id: 'flour' }, { id: 'butter' }, { id: 'sugar' },
      ]);
      prisma.recipe.create.mockResolvedValue({ id: 'r1' });
      await svc.create(
        {
          productId: 'p1',
          ingredients: [
            validIngredient('flour', 200),
            validIngredient('butter', 50),
            validIngredient('sugar', 30),
          ],
        } as any,
        't1',
        'b1',
      );
      expect(prisma.recipe.create).toHaveBeenCalledTimes(1);
    });

    /**
     * v3 branch-isolation FOUNDATION: a product carries one recipe PER
     * BRANCH (@@unique([productId, branchId])). The existing-recipe guard
     * keys on the compound (productId, branchId).
     */
    it('existing-recipe guard keys on the compound (productId, branchId)', async () => {
      prisma.stockItem.findMany.mockResolvedValue([{ id: 'flour' }]);
      prisma.recipe.create.mockResolvedValue({ id: 'r1' });

      await svc.create(
        { productId: 'p1', ingredients: [validIngredient('flour', 100)] } as any,
        't1',
        'b1',
      );

      expect(prisma.recipe.findUnique).toHaveBeenCalledWith({
        where: { productId_branchId: { productId: 'p1', branchId: 'b1' } },
      });
    });

    it('same product in a DIFFERENT branch is ALLOWED (per-branch recipe)', async () => {
      // Branch b1 already has a recipe for p1; branch b2 has none. The
      // compound-key guard returns null for b2, so the create proceeds.
      prisma.recipe.findUnique.mockImplementation(async ({ where }: any) => {
        return where.productId_branchId.branchId === 'b1'
          ? { id: 'r-b1', productId: 'p1', branchId: 'b1' }
          : null;
      });
      prisma.stockItem.findMany.mockResolvedValue([{ id: 'flour' }]);
      prisma.recipe.create.mockResolvedValue({ id: 'r-b2' });

      await svc.create(
        { productId: 'p1', ingredients: [validIngredient('flour', 100)] } as any,
        't1',
        'b2',
      );

      expect(prisma.recipe.create).toHaveBeenCalledTimes(1);
      const created = prisma.recipe.create.mock.calls[0][0].data;
      expect(created.branchId).toBe('b2');
      expect(created.productId).toBe('p1');
    });

    it('same product in the SAME branch is rejected', async () => {
      const { ConflictException } = require('@nestjs/common');
      prisma.recipe.findUnique.mockResolvedValue({ id: 'r-b1', productId: 'p1', branchId: 'b1' });

      await expect(
        svc.create(
          { productId: 'p1', ingredients: [validIngredient('flour', 100)] } as any,
          't1',
          'b1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.recipe.create).not.toHaveBeenCalled();
    });
  });

  describe('update — duplicate-ingredient guard', () => {
    let prisma: any;
    let svc: RecipesService;

    beforeEach(() => {
      const txMock = {
        recipe: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: 'r1' }),
        },
        recipeIngredient: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        stockItem: { findMany: jest.fn().mockResolvedValue([]) },
      };
      prisma = {
        recipe: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'r1',
            tenantId: 't1',
            productId: 'p1',
            name: 'Burger',
            ingredients: [],
            product: { id: 'p1', name: 'Burger' },
          }),
        },
        $transaction: jest.fn().mockImplementation(async (fn: any) => fn(txMock)),
      };
      svc = new RecipesService(prisma);
    });

    it('rejects duplicate ingredients on update', async () => {
      await expect(
        svc.update(
          'r1',
          {
            ingredients: [
              validIngredient('flour-uuid', 200),
              validIngredient('flour-uuid', 100),
            ],
          } as any,
          't1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows omitting the ingredients array entirely (metadata-only update)', async () => {
      // Metadata-only update should still go through the txn but never
      // touch the dedup gate.
      await svc.update('r1', { name: 'New name' } as any, 't1');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('findAll — pagination', () => {
    let prisma: any;
    let svc: RecipesService;

    beforeEach(() => {
      prisma = {
        recipe: { findMany: jest.fn().mockResolvedValue([]) },
      };
      svc = new RecipesService(prisma);
    });

    it('applies a 500-row default take when no pagination passed', async () => {
      await svc.findAll('t1');
      const call = prisma.recipe.findMany.mock.calls[0][0];
      expect(call.take).toBe(500);
      expect(call.skip).toBe(0);
    });

    it('caps take at the 2000 hard max', async () => {
      await svc.findAll('t1', { limit: 50_000 });
      const call = prisma.recipe.findMany.mock.calls[0][0];
      expect(call.take).toBe(2000);
    });

    it('forwards a custom limit/offset within the cap', async () => {
      await svc.findAll('t1', { limit: 100, offset: 200 });
      const call = prisma.recipe.findMany.mock.calls[0][0];
      expect(call.take).toBe(100);
      expect(call.skip).toBe(200);
    });
  });
});
