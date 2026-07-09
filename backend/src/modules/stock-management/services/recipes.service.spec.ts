import { BadRequestException } from "@nestjs/common";
import { RecipesService } from "./recipes.service";
import { RecipeCostingService } from "./recipe-costing.service";

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
describe("RecipesService (iter-93)", () => {
  // v3 branch-scope: read/update/remove/checkStock take a BranchScope.
  // branchScope(scope) fences every where on (tenantId, branchId).
  const SCOPE = {
    tenantId: "t1",
    branchId: "b1",
    userId: "u1",
    role: "ADMIN",
  } as const;
  const validIngredient = (stockItemId: string, qty: number = 1) => ({
    stockItemId,
    quantity: qty,
  });

  describe("create — duplicate-ingredient guard", () => {
    let prisma: any;
    let svc: RecipesService;

    beforeEach(() => {
      prisma = {
        product: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: "p1", tenantId: "t1", name: "Burger" }),
        },
        // v3 branch-scope: the existing-recipe guard now keys on the
        // compound (productId, branchId) via findUnique, so the mock must
        // expose findUnique (null = no recipe yet for this product+branch).
        recipe: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
        stockItem: { findMany: jest.fn() },
      };
      svc = new RecipesService(prisma, new RecipeCostingService());
    });

    it("rejects two ingredient entries for the same stockItemId", async () => {
      await expect(
        svc.create(
          {
            productId: "p1",
            ingredients: [
              validIngredient("flour-uuid", 200),
              validIngredient("flour-uuid", 100),
            ],
          } as any,
          "t1",
          "b1",
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Never reach the DB writes.
      expect(prisma.recipe.create).not.toHaveBeenCalled();
    });

    it("mentions the offending stockItemId in the error message", async () => {
      await expect(
        svc.create(
          {
            productId: "p1",
            ingredients: [
              validIngredient("butter-uuid", 50),
              validIngredient("butter-uuid", 50),
            ],
          } as any,
          "t1",
          "b1",
        ),
      ).rejects.toThrow(/butter-uuid/);
    });

    it("accepts a recipe with all distinct ingredients (happy path)", async () => {
      prisma.stockItem.findMany.mockResolvedValue([
        { id: "flour" },
        { id: "butter" },
        { id: "sugar" },
      ]);
      prisma.recipe.create.mockResolvedValue({ id: "r1" });
      await svc.create(
        {
          productId: "p1",
          ingredients: [
            validIngredient("flour", 200),
            validIngredient("butter", 50),
            validIngredient("sugar", 30),
          ],
        } as any,
        "t1",
        "b1",
      );
      expect(prisma.recipe.create).toHaveBeenCalledTimes(1);
    });

    /**
     * v3 branch-isolation FOUNDATION: a product carries one recipe PER
     * BRANCH (@@unique([productId, branchId])). The existing-recipe guard
     * keys on the compound (productId, branchId).
     */
    it("existing-recipe guard keys on the compound (productId, branchId)", async () => {
      prisma.stockItem.findMany.mockResolvedValue([{ id: "flour" }]);
      prisma.recipe.create.mockResolvedValue({ id: "r1" });

      await svc.create(
        {
          productId: "p1",
          ingredients: [validIngredient("flour", 100)],
        } as any,
        "t1",
        "b1",
      );

      expect(prisma.recipe.findUnique).toHaveBeenCalledWith({
        where: { productId_branchId: { productId: "p1", branchId: "b1" } },
      });
    });

    it("same product in a DIFFERENT branch is ALLOWED (per-branch recipe)", async () => {
      // Branch b1 already has a recipe for p1; branch b2 has none. The
      // compound-key guard returns null for b2, so the create proceeds.
      prisma.recipe.findUnique.mockImplementation(async ({ where }: any) => {
        return where.productId_branchId.branchId === "b1"
          ? { id: "r-b1", productId: "p1", branchId: "b1" }
          : null;
      });
      prisma.stockItem.findMany.mockResolvedValue([{ id: "flour" }]);
      prisma.recipe.create.mockResolvedValue({ id: "r-b2" });

      await svc.create(
        {
          productId: "p1",
          ingredients: [validIngredient("flour", 100)],
        } as any,
        "t1",
        "b2",
      );

      expect(prisma.recipe.create).toHaveBeenCalledTimes(1);
      const created = prisma.recipe.create.mock.calls[0][0].data;
      expect(created.branchId).toBe("b2");
      expect(created.productId).toBe("p1");
    });

    /**
     * deep-review H12: the stock-item existence check on create MUST be
     * branch-scoped. Pre-fix it filtered only on tenantId, so a recipe
     * could reference another branch's stock item — and order deduction
     * would then drive down the WRONG branch's stock. The findMany WHERE
     * must carry branchId so a cross-branch ingredient is rejected.
     */
    it("scopes the stock-item existence check to the recipe branch (H12)", async () => {
      prisma.stockItem.findMany.mockResolvedValue([{ id: "flour" }]);
      prisma.recipe.create.mockResolvedValue({ id: "r1" });

      await svc.create(
        {
          productId: "p1",
          ingredients: [validIngredient("flour", 100)],
        } as any,
        "t1",
        "b1",
      );

      expect(prisma.stockItem.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ["flour"] },
        tenantId: "t1",
        branchId: "b1",
      });
    });

    it("rejects an ingredient that belongs to another branch (H12)", async () => {
      // The cross-branch stock item is not returned by the branch-scoped
      // findMany, so the length check fails and create is rejected.
      prisma.stockItem.findMany.mockResolvedValue([]); // none in branch b1
      await expect(
        svc.create(
          {
            productId: "p1",
            ingredients: [validIngredient("flour-from-b2", 100)],
          } as any,
          "t1",
          "b1",
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.recipe.create).not.toHaveBeenCalled();
    });

    it("same product in the SAME branch is rejected", async () => {
      const { ConflictException } = require("@nestjs/common");
      prisma.recipe.findUnique.mockResolvedValue({
        id: "r-b1",
        productId: "p1",
        branchId: "b1",
      });

      await expect(
        svc.create(
          {
            productId: "p1",
            ingredients: [validIngredient("flour", 100)],
          } as any,
          "t1",
          "b1",
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.recipe.create).not.toHaveBeenCalled();
    });
  });

  describe("update — duplicate-ingredient guard", () => {
    let prisma: any;
    let svc: RecipesService;

    beforeEach(() => {
      const txMock = {
        recipe: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: "r1" }),
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
            id: "r1",
            tenantId: "t1",
            productId: "p1",
            name: "Burger",
            ingredients: [],
            product: { id: "p1", name: "Burger" },
          }),
        },
        $transaction: jest
          .fn()
          .mockImplementation(async (fn: any) => fn(txMock)),
      };
      svc = new RecipesService(prisma, new RecipeCostingService());
    });

    it("rejects duplicate ingredients on update", async () => {
      await expect(
        svc.update(
          "r1",
          {
            ingredients: [
              validIngredient("flour-uuid", 200),
              validIngredient("flour-uuid", 100),
            ],
          } as any,
          SCOPE,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("allows omitting the ingredients array entirely (metadata-only update)", async () => {
      // Metadata-only update should still go through the txn but never
      // touch the dedup gate.
      await svc.update("r1", { name: "New name" } as any, SCOPE);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("fences both the pre-check read and the mutation on (tenantId, branchId)", async () => {
      const txMock = {
        recipe: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: "r1" }),
        },
        recipeIngredient: {
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
        stockItem: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const findFirst = jest.fn().mockResolvedValue({
        id: "r1",
        productId: "p1",
        name: "Burger",
        ingredients: [],
        product: { id: "p1", name: "Burger" },
      });
      const localPrisma: any = {
        recipe: { findFirst },
        $transaction: jest
          .fn()
          .mockImplementation(async (fn: any) => fn(txMock)),
      };
      const localSvc = new RecipesService(localPrisma, new RecipeCostingService());

      await localSvc.update("r1", { name: "New name" } as any, SCOPE);

      // findOne pre-check is branch-fenced.
      expect(findFirst.mock.calls[0][0].where).toEqual({
        id: "r1",
        tenantId: "t1",
        branchId: "b1",
      });
      // The mutation's own WHERE is branch-fenced (defence-in-depth IDOR).
      expect(txMock.recipe.updateMany.mock.calls[0][0].where).toEqual({
        id: "r1",
        tenantId: "t1",
        branchId: "b1",
      });
    });

    it("does NOT mutate a cross-branch recipe id (findOne fence → NotFound)", async () => {
      const findFirst = jest.fn().mockResolvedValue(null); // wrong-branch id
      const localPrisma: any = {
        recipe: { findFirst },
        $transaction: jest.fn(),
      };
      const localSvc = new RecipesService(localPrisma, new RecipeCostingService());
      const { NotFoundException } = require("@nestjs/common");

      await expect(
        localSvc.update("cross-branch-id", { name: "X" } as any, SCOPE),
      ).rejects.toBeInstanceOf(NotFoundException);
      // The mutating transaction must never run for a cross-branch id.
      expect(localPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("findAll — pagination", () => {
    let prisma: any;
    let svc: RecipesService;

    beforeEach(() => {
      prisma = {
        recipe: { findMany: jest.fn().mockResolvedValue([]) },
      };
      svc = new RecipesService(prisma, new RecipeCostingService());
    });

    it("applies a 500-row default take when no pagination passed", async () => {
      await svc.findAll(SCOPE);
      const call = prisma.recipe.findMany.mock.calls[0][0];
      expect(call.take).toBe(500);
      expect(call.skip).toBe(0);
    });

    it("caps take at the 2000 hard max", async () => {
      await svc.findAll(SCOPE, { limit: 50_000 });
      const call = prisma.recipe.findMany.mock.calls[0][0];
      expect(call.take).toBe(2000);
    });

    it("forwards a custom limit/offset within the cap", async () => {
      await svc.findAll(SCOPE, { limit: 100, offset: 200 });
      const call = prisma.recipe.findMany.mock.calls[0][0];
      expect(call.take).toBe(100);
      expect(call.skip).toBe(200);
    });

    it("fences the list read on (tenantId, branchId)", async () => {
      await svc.findAll(SCOPE);
      const where = prisma.recipe.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe("t1");
      expect(where.branchId).toBe("b1");
    });
  });

  describe("findOne / findByProduct — branch fence", () => {
    let prisma: any;
    let svc: RecipesService;

    beforeEach(() => {
      prisma = { recipe: { findFirst: jest.fn() } };
      svc = new RecipesService(prisma, new RecipeCostingService());
    });

    it("findOne scopes by id + (tenantId, branchId)", async () => {
      prisma.recipe.findFirst.mockResolvedValue({ id: "r1", ingredients: [] });
      await svc.findOne("r1", SCOPE);
      expect(prisma.recipe.findFirst.mock.calls[0][0].where).toEqual({
        id: "r1",
        tenantId: "t1",
        branchId: "b1",
      });
    });

    it("findOne throws NotFound for a cross-branch id (fence returns null)", async () => {
      prisma.recipe.findFirst.mockResolvedValue(null);
      const { NotFoundException } = require("@nestjs/common");
      await expect(svc.findOne("cross-branch", SCOPE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("findByProduct scopes by productId + (tenantId, branchId)", async () => {
      prisma.recipe.findFirst.mockResolvedValue({ id: "r1", ingredients: [] });
      await svc.findByProduct("p1", SCOPE);
      expect(prisma.recipe.findFirst.mock.calls[0][0].where).toEqual({
        productId: "p1",
        tenantId: "t1",
        branchId: "b1",
      });
    });
  });

  describe("remove — branch fence", () => {
    it("does NOT delete a cross-branch recipe id (findOne fence → NotFound)", async () => {
      const prisma: any = {
        recipe: {
          findFirst: jest.fn().mockResolvedValue(null),
          deleteMany: jest.fn(),
        },
      };
      const svc = new RecipesService(prisma, new RecipeCostingService());
      const { NotFoundException } = require("@nestjs/common");
      await expect(svc.remove("cross-branch", SCOPE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.recipe.deleteMany).not.toHaveBeenCalled();
    });

    it("deletes via a branch-fenced deleteMany when the recipe is in-branch", async () => {
      const prisma: any = {
        recipe: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: "r1", name: "Burger", productId: "p1" }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const svc = new RecipesService(prisma, new RecipeCostingService());
      await svc.remove("r1", SCOPE);
      expect(prisma.recipe.deleteMany.mock.calls[0][0].where).toEqual({
        id: "r1",
        tenantId: "t1",
        branchId: "b1",
      });
    });
  });
});

describe('RecipesService.create — sub-recipe ownership', () => {
  it('rejects a component sub-recipe not in the branch', async () => {
    const prisma: any = {
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', name: 'Dish' }) },
      recipe: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]), // foreign sub-recipe → not found in branch
      },
      stockItem: { findMany: jest.fn().mockResolvedValue([{ id: 'si1' }]) },
    };
    const svc = new (require('./recipes.service').RecipesService)(prisma, {} as any);
    await expect(
      svc.create(
        {
          productId: 'p1',
          ingredients: [{ stockItemId: 'si1', quantity: 1 }],
          components: [{ subRecipeId: 'foreign-recipe', quantity: 1 }],
        } as any,
        't1', 'b1',
      ),
    ).rejects.toThrow(/sub-recipes not found/);
  });
});
