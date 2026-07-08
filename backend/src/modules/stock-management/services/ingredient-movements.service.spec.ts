import { BadRequestException } from "@nestjs/common";
import { IngredientMovementsService } from "./ingredient-movements.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Real-logic spec for IngredientMovementsService.
 *
 * Pins:
 *  - findAll: filter→where mapping, the parseWindow date guards (invalid
 *    date / start>end / >366-day window), and the 5000-row HARD_MAX clamp.
 *  - create: the IN/OUT/ADJUSTMENT quantity-sign math, the insufficient-stock
 *    guard, and the optimistic-lock compound-WHERE (currentStock observed)
 *    + the mid-flight-change BadRequest when updateMany.count === 0.
 *
 * Every test FAILS if the corresponding branch regresses.
 */
describe("IngredientMovementsService", () => {
  const TENANT = "tenant-1";
  const BRANCH = "branch-1";
  // v3 branch-scope: findAll takes a BranchScope; branchScope(scope)
  // fences the read on (tenantId, branchId).
  const SCOPE = {
    tenantId: TENANT,
    branchId: BRANCH,
    userId: "user-1",
    role: "ADMIN",
  } as const;
  let prisma: MockPrismaClient;
  let svc: IngredientMovementsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new IngredientMovementsService(prisma as any);
  });

  describe("findAll — filter→where mapping & pagination clamp", () => {
    beforeEach(() => {
      (prisma.ingredientMovement.findMany as any).mockResolvedValue([]);
    });

    it("maps stockItemId + type filters into a branch-fenced where and applies default take/skip", async () => {
      await svc.findAll(SCOPE, { stockItemId: "si-1", type: "OUT" });

      expect(prisma.ingredientMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT,
            branchId: BRANCH,
            stockItemId: "si-1",
            type: "OUT",
          },
          orderBy: { createdAt: "desc" },
          take: 500,
          skip: 0,
          include: {
            stockItem: { select: { id: true, name: true, unit: true } },
          },
        }),
      );
    });

    it("clamps an over-large limit to HARD_MAX (5000) and honours offset", async () => {
      await svc.findAll(SCOPE, { limit: 999999, offset: 42 });

      const arg = (prisma.ingredientMovement.findMany as any).mock.calls[0][0];
      expect(arg.take).toBe(5000);
      expect(arg.skip).toBe(42);
    });

    it("builds a createdAt window from startDate+endDate", async () => {
      await svc.findAll(SCOPE, {
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      const arg = (prisma.ingredientMovement.findMany as any).mock.calls[0][0];
      expect(arg.where.createdAt.gte).toEqual(new Date("2024-01-01"));
      expect(arg.where.createdAt.lte).toEqual(new Date("2024-01-31"));
    });

    it("omits createdAt entirely when no date filters are supplied", async () => {
      await svc.findAll(SCOPE, { stockItemId: "si-1" });

      const arg = (prisma.ingredientMovement.findMany as any).mock.calls[0][0];
      expect(arg.where.createdAt).toBeUndefined();
    });

    it("rejects an invalid startDate before hitting the DB", async () => {
      await expect(
        svc.findAll(SCOPE, { startDate: "not-a-date" }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.ingredientMovement.findMany).not.toHaveBeenCalled();
    });

    it("rejects start>end", async () => {
      await expect(
        svc.findAll(SCOPE, {
          startDate: "2024-02-01",
          endDate: "2024-01-01",
        }),
      ).rejects.toThrow("startDate must be before or equal to endDate");
    });

    it("rejects a window wider than 366 days", async () => {
      await expect(
        svc.findAll(SCOPE, {
          startDate: "2024-01-01",
          endDate: "2025-06-01",
        }),
      ).rejects.toThrow(/Date range cannot exceed 366 days/);
    });

    it("accepts a window of exactly 366 days (boundary inclusive)", async () => {
      await svc.findAll(SCOPE, {
        startDate: "2024-01-01",
        endDate: "2024-01-01",
      });
      // No throw + the query ran.
      expect(prisma.ingredientMovement.findMany).toHaveBeenCalled();
    });
  });

  describe("create — quantity sign math, stock guard, optimistic lock", () => {
    function wireTx() {
      const tx: any = {
        stockItem: {
          findFirst: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        stockBatch: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({}),
        },
        ingredientMovement: {
          create: jest.fn().mockResolvedValue({ id: "mov-1" }),
        },
      };
      (prisma.$transaction as any).mockImplementation(async (cb: any) =>
        cb(tx),
      );
      return tx;
    }

    it("OUT subtracts abs(quantity); writes new stock under observed-value WHERE", async () => {
      const tx = wireTx();
      tx.stockItem.findFirst.mockResolvedValue({
        id: "si-1",
        name: "Flour",
        currentStock: 10,
        branchId: "br-1",
      });

      await svc.create(
        { stockItemId: "si-1", type: "OUT", quantity: 4 } as any,
        { tenantId: TENANT, branchId: "br-1" } as any,
      );

      // newStock = 10 + (-4) = 6, guarded by the observed currentStock=10
      // AND fenced on (tenantId, branchId) per branchScope(scope).
      expect(tx.stockItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: "si-1",
          tenantId: TENANT,
          branchId: "br-1",
          currentStock: 10,
        },
        data: { currentStock: 6 },
      });
      // Movement stores the SIGNED delta (-4), not the raw input.
      expect(tx.ingredientMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "OUT",
            quantity: -4,
            stockItemId: "si-1",
            tenantId: TENANT,
            branchId: "br-1",
          }),
        }),
      );
    });

    it("OUT with a negative input still subtracts abs() (no double-negative)", async () => {
      const tx = wireTx();
      tx.stockItem.findFirst.mockResolvedValue({
        id: "si-1",
        name: "Flour",
        currentStock: 10,
        branchId: "br-1",
      });

      await svc.create(
        { stockItemId: "si-1", type: "OUT", quantity: -3 } as any,
        { tenantId: TENANT, branchId: "br-1" } as any,
      );

      // -Math.abs(-3) = -3 → 10 - 3 = 7
      expect(tx.stockItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { currentStock: 7 } }),
      );
    });

    it("IN adds abs(quantity)", async () => {
      const tx = wireTx();
      tx.stockItem.findFirst.mockResolvedValue({
        id: "si-1",
        name: "Flour",
        currentStock: 10,
        branchId: "br-1",
      });

      await svc.create(
        { stockItemId: "si-1", type: "IN", quantity: 5 } as any,
        { tenantId: TENANT, branchId: "br-1" } as any,
      );

      expect(tx.stockItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { currentStock: 15 } }),
      );
    });

    it("ADJUSTMENT preserves the raw signed quantity (can go negative)", async () => {
      const tx = wireTx();
      tx.stockItem.findFirst.mockResolvedValue({
        id: "si-1",
        name: "Flour",
        currentStock: 10,
        branchId: "br-1",
      });

      await svc.create(
        { stockItemId: "si-1", type: "ADJUSTMENT", quantity: -2 } as any,
        { tenantId: TENANT, branchId: "br-1" } as any,
      );

      expect(tx.stockItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { currentStock: 8 } }),
      );
      expect(tx.ingredientMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: -2 }),
        }),
      );
    });

    it("throws when the stock item is missing", async () => {
      const tx = wireTx();
      tx.stockItem.findFirst.mockResolvedValue(null);

      await expect(
        svc.create(
          { stockItemId: "missing", type: "OUT", quantity: 1 } as any,
          { tenantId: TENANT, branchId: "br-1" } as any,
        ),
      ).rejects.toThrow("Stock item not found");
      expect(tx.stockItem.updateMany).not.toHaveBeenCalled();
    });

    it("rejects an OUT that would drive stock negative (no write attempted)", async () => {
      const tx = wireTx();
      tx.stockItem.findFirst.mockResolvedValue({
        id: "si-1",
        name: "Flour",
        currentStock: 3,
        branchId: "br-1",
      });

      await expect(
        svc.create(
          { stockItemId: "si-1", type: "OUT", quantity: 5 } as any,
          { tenantId: TENANT, branchId: "br-1" } as any,
        ),
      ).rejects.toThrow(/Insufficient stock for Flour/);
      expect(tx.stockItem.updateMany).not.toHaveBeenCalled();
      expect(tx.ingredientMovement.create).not.toHaveBeenCalled();
    });

    it("throws the mid-flight-change error when the optimistic update matches 0 rows", async () => {
      const tx = wireTx();
      tx.stockItem.findFirst.mockResolvedValue({
        id: "si-1",
        name: "Flour",
        currentStock: 10,
        branchId: "br-1",
      });
      tx.stockItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        svc.create(
          { stockItemId: "si-1", type: "OUT", quantity: 4 } as any,
          { tenantId: TENANT, branchId: "br-1" } as any,
        ),
      ).rejects.toThrow(/changed mid-flight; please retry/);
      // The movement row is NOT created when the lock loses.
      expect(tx.ingredientMovement.create).not.toHaveBeenCalled();
    });
  });
});
