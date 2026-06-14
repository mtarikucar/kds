import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WasteLogsService } from "./waste-logs.service";
import { WasteReason } from "../../../common/constants/stock-management.enum";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Real-logic spec for WasteLogsService.
 *
 * The high-value unit here is the v2.8.97 FIFO batch-weighted cost: the
 * waste cost must reflect the cost of the OLDEST still-in-stock batches
 * actually consumed (FIFO), NOT the rolling-average stockItem.costPerUnit.
 * We pin:
 *  - the atomic-decrement guard (count===0 → ConflictException, no write)
 *  - FIFO consumption order (expiry asc nulls last, then receivedAt asc)
 *  - weighted-average cost across multiple batches → cost = qty * weightedAvg
 *  - fallback to stockItem.costPerUnit when no batch carries a cost
 *  - cost = null when neither batches nor stockItem provide a cost
 *  - the paired IngredientMovement (negated qty, WASTE type, reference)
 *  - getSummary's totalCost/totalCount mapping with the `|| 0` fallback
 */
describe("WasteLogsService", () => {
  const TENANT = "tenant-1";
  const BRANCH = "branch-1";
  // v3 branch-scope: read aggregates take a BranchScope; branchScope(scope)
  // fences the where on (tenantId, branchId).
  const SCOPE = {
    tenantId: TENANT,
    branchId: BRANCH,
    userId: "user-1",
    role: "ADMIN",
  } as const;
  let prisma: MockPrismaClient;
  let svc: WasteLogsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new WasteLogsService(prisma as any);
  });

  // Shared tx wiring used by create() tests.
  function wireTx(opts: {
    stockItem: any;
    batches: any[];
    decrementCount?: number;
    batchUpdateCount?: number;
  }) {
    const created = {
      wasteLog: { id: "wl-1" },
    };
    const tx: any = {
      stockItem: {
        findFirst: jest.fn().mockResolvedValue(opts.stockItem),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: opts.decrementCount ?? 1 }),
      },
      stockBatch: {
        findMany: jest.fn().mockResolvedValue(opts.batches),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: opts.batchUpdateCount ?? 1 }),
      },
      wasteLog: {
        create: jest.fn().mockResolvedValue(created.wasteLog),
      },
      ingredientMovement: {
        create: jest.fn().mockResolvedValue({ id: "mov-1" }),
      },
    };
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));
    return tx;
  }

  describe("create — atomic decrement guard", () => {
    it("throws Conflict when the conditional decrement matches 0 rows (over-waste)", async () => {
      const tx = wireTx({
        stockItem: {
          id: "si-1",
          name: "Milk",
          currentStock: 2,
          costPerUnit: 1,
          branchId: "br-1",
        },
        batches: [],
        decrementCount: 0,
      });

      await expect(
        svc.create(
          {
            stockItemId: "si-1",
            quantity: 5,
            reason: WasteReason.SPOILED,
          } as any,
          TENANT,
        ),
      ).rejects.toThrow(ConflictException);
      // No waste log / movement booked when the guard fails.
      expect(tx.wasteLog.create).not.toHaveBeenCalled();
      expect(tx.ingredientMovement.create).not.toHaveBeenCalled();
    });

    it("throws when the stock item does not exist", async () => {
      const tx = wireTx({ stockItem: null, batches: [] });
      tx.stockItem.findFirst.mockResolvedValue(null);

      await expect(
        svc.create(
          { stockItemId: "x", quantity: 1, reason: WasteReason.EXPIRED } as any,
          TENANT,
        ),
      ).rejects.toThrow("Stock item not found");
      expect(tx.stockItem.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("create — FIFO batch-weighted cost", () => {
    it("queries batches in FIFO order (expiry asc nulls last, then receivedAt asc)", async () => {
      const tx = wireTx({
        stockItem: {
          id: "si-1",
          name: "Milk",
          currentStock: 100,
          costPerUnit: 9,
          branchId: "br-1",
        },
        batches: [{ id: "b1", quantity: new Prisma.Decimal(10), costPerUnit: 2 }],
      });

      await svc.create(
        { stockItemId: "si-1", quantity: 3, reason: WasteReason.DAMAGED } as any,
        TENANT,
      );

      expect(tx.stockBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            stockItemId: "si-1",
            tenantId: TENANT,
            quantity: { gt: 0 },
          },
          orderBy: [
            { expiryDate: { sort: "asc", nulls: "last" } },
            { receivedAt: "asc" },
          ],
        }),
      );
    });

    it("weights cost across batches consumed FIFO (4@2 + 1@10 over qty 5 → 3.6)", async () => {
      // wasteQty = 5. Batch1 has 4 units @2, Batch2 has 10 units @10.
      // FIFO consumes 4 from b1 then 1 from b2.
      // weightedAcc = 4*2 + 1*10 = 18; consumed = 5; avg = 3.6.
      // cost = 5 * 3.6 = 18.0000
      const tx = wireTx({
        stockItem: {
          id: "si-1",
          name: "Milk",
          currentStock: 100,
          costPerUnit: 99,
          branchId: "br-1",
        },
        batches: [
          { id: "b1", quantity: new Prisma.Decimal(4), costPerUnit: 2 },
          { id: "b2", quantity: new Prisma.Decimal(10), costPerUnit: 10 },
        ],
      });

      await svc.create(
        { stockItemId: "si-1", quantity: 5, reason: WasteReason.SPOILED } as any,
        TENANT,
      );

      // Exactly two batch decrements (4 then 1), in order.
      const batchCalls = (tx.stockBatch.updateMany as any).mock.calls;
      expect(batchCalls).toHaveLength(2);
      expect(batchCalls[0][0].where.id).toBe("b1");
      expect(batchCalls[1][0].where.id).toBe("b2");

      const wasteArg = (tx.wasteLog.create as any).mock.calls[0][0];
      // cost = 18, costPerUnit weighted = 3.6 → recorded on the movement.
      expect(Number(wasteArg.data.cost)).toBeCloseTo(18, 4);

      const movArg = (tx.ingredientMovement.create as any).mock.calls[0][0];
      expect(Number(movArg.data.costPerUnit)).toBeCloseTo(3.6, 6);
    });

    it("stops consuming once remaining hits 0 (does not touch later batches)", async () => {
      // qty 3, first batch has 10 → only b1 is consumed.
      const tx = wireTx({
        stockItem: {
          id: "si-1",
          name: "Milk",
          currentStock: 100,
          costPerUnit: 99,
          branchId: "br-1",
        },
        batches: [
          { id: "b1", quantity: new Prisma.Decimal(10), costPerUnit: 2 },
          { id: "b2", quantity: new Prisma.Decimal(10), costPerUnit: 10 },
        ],
      });

      await svc.create(
        { stockItemId: "si-1", quantity: 3, reason: WasteReason.SPOILED } as any,
        TENANT,
      );

      const batchCalls = (tx.stockBatch.updateMany as any).mock.calls;
      expect(batchCalls).toHaveLength(1);
      expect(batchCalls[0][0].where.id).toBe("b1");
      // cost = 3 * 2 = 6
      const wasteArg = (tx.wasteLog.create as any).mock.calls[0][0];
      expect(Number(wasteArg.data.cost)).toBeCloseTo(6, 4);
    });

    it("skips a batch whose conditional decrement loses the race (count===0) and moves on", async () => {
      const tx = wireTx({
        stockItem: {
          id: "si-1",
          name: "Milk",
          currentStock: 100,
          costPerUnit: 99,
          branchId: "br-1",
        },
        batches: [
          { id: "b1", quantity: new Prisma.Decimal(4), costPerUnit: 2 },
          { id: "b2", quantity: new Prisma.Decimal(10), costPerUnit: 10 },
        ],
      });
      // First batch decrement loses (count 0) → remaining unchanged, fall to b2.
      tx.stockBatch.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      await svc.create(
        { stockItemId: "si-1", quantity: 4, reason: WasteReason.SPOILED } as any,
        TENANT,
      );

      // weightedAcc only counts b2's take (4 @10) since b1 was skipped.
      // consumed = 4, avg = 10, cost = 4 * 10 = 40.
      const wasteArg = (tx.wasteLog.create as any).mock.calls[0][0];
      expect(Number(wasteArg.data.cost)).toBeCloseTo(40, 4);
    });

    it("falls back to stockItem.costPerUnit when no batch carries a cost", async () => {
      const tx = wireTx({
        stockItem: {
          id: "si-1",
          name: "Milk",
          currentStock: 100,
          costPerUnit: 7,
          branchId: "br-1",
        },
        batches: [
          { id: "b1", quantity: new Prisma.Decimal(10), costPerUnit: null },
        ],
      });

      await svc.create(
        { stockItemId: "si-1", quantity: 2, reason: WasteReason.SPOILED } as any,
        TENANT,
      );

      // weightedCostAcc stays 0 → fall back to stockItem.costPerUnit=7.
      // cost = 2 * 7 = 14.
      const wasteArg = (tx.wasteLog.create as any).mock.calls[0][0];
      expect(Number(wasteArg.data.cost)).toBeCloseTo(14, 4);
    });

    it("records cost=null when there are no batches and no stockItem cost", async () => {
      const tx = wireTx({
        stockItem: {
          id: "si-1",
          name: "Milk",
          currentStock: 100,
          costPerUnit: null,
          branchId: "br-1",
        },
        batches: [],
      });

      await svc.create(
        { stockItemId: "si-1", quantity: 2, reason: WasteReason.SPOILED } as any,
        TENANT,
      );

      const wasteArg = (tx.wasteLog.create as any).mock.calls[0][0];
      // cost falls through to null → passed as undefined into create.
      expect(wasteArg.data.cost).toBeUndefined();
      const movArg = (tx.ingredientMovement.create as any).mock.calls[0][0];
      expect(movArg.data.costPerUnit).toBeUndefined();
    });
  });

  describe("create — paired IngredientMovement", () => {
    it("books a WASTE movement with negated qty, reference fields and branch", async () => {
      const tx = wireTx({
        stockItem: {
          id: "si-1",
          name: "Milk",
          currentStock: 100,
          costPerUnit: 5,
          branchId: "br-9",
        },
        batches: [],
      });

      await svc.create(
        {
          stockItemId: "si-1",
          quantity: 3,
          reason: WasteReason.EXPIRED,
          notes: "moldy",
        } as any,
        TENANT,
        "user-7",
      );

      const movArg = (tx.ingredientMovement.create as any).mock.calls[0][0];
      expect(movArg.data).toEqual(
        expect.objectContaining({
          type: "WASTE",
          referenceType: "WASTE_LOG",
          referenceId: "wl-1",
          stockItemId: "si-1",
          tenantId: TENANT,
          branchId: "br-9",
          createdById: "user-7",
          notes: "Waste: EXPIRED - moldy",
        }),
      );
      // quantity is negated (qty.neg()): 3 → -3.
      expect(Number(movArg.data.quantity)).toBe(-3);
    });

    it("omits the ` - notes` suffix when no notes are given", async () => {
      const tx = wireTx({
        stockItem: {
          id: "si-1",
          name: "Milk",
          currentStock: 100,
          costPerUnit: 5,
          branchId: "br-1",
        },
        batches: [],
      });

      await svc.create(
        { stockItemId: "si-1", quantity: 1, reason: WasteReason.DAMAGED } as any,
        TENANT,
      );

      const movArg = (tx.ingredientMovement.create as any).mock.calls[0][0];
      expect(movArg.data.notes).toBe("Waste: DAMAGED");
    });
  });

  describe("findAll — window guard + pagination", () => {
    beforeEach(() => {
      (prisma.wasteLog.findMany as any).mockResolvedValue([]);
    });

    it("maps stockItemId + reason into a branch-fenced where with default take 500", async () => {
      await svc.findAll(SCOPE, { stockItemId: "si-1", reason: "EXPIRED" });

      expect(prisma.wasteLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT,
            branchId: BRANCH,
            stockItemId: "si-1",
            reason: "EXPIRED",
          },
          take: 500,
          skip: 0,
          orderBy: { createdAt: "desc" },
        }),
      );
    });

    it("rejects an invalid endDate", async () => {
      await expect(
        svc.findAll(SCOPE, { endDate: "2025-02-30T99:99" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("does NOT find a cross-branch waste log (branchId fences the read)", async () => {
      await svc.findAll(SCOPE, {});
      const arg = (prisma.wasteLog.findMany as any).mock.calls[0][0];
      // The where carries OUR branchId, so a row written under another
      // branch can never match — Prisma applies the compound predicate.
      expect(arg.where.branchId).toBe(BRANCH);
      expect(arg.where.tenantId).toBe(TENANT);
    });
  });

  describe("getSummary", () => {
    it("aggregates byReason, totalCost (|| 0 fallback) and totalCount", async () => {
      (prisma.wasteLog.groupBy as any).mockResolvedValue([
        { reason: "EXPIRED", _sum: { quantity: 5, cost: 10 }, _count: 2 },
      ]);
      (prisma.wasteLog.aggregate as any).mockResolvedValue({
        _sum: { cost: null }, // null cost → must coerce to 0
        _count: 7,
      });
      (prisma.wasteLog.findMany as any).mockResolvedValue([{ id: "wl-1" }]);

      const res = await svc.getSummary(SCOPE, "2024-01-01", "2024-01-31");

      expect(res.totalCost).toBe(0);
      expect(res.totalCount).toBe(7);
      expect(res.byReason).toHaveLength(1);
      expect(res.recentLogs).toEqual([{ id: "wl-1" }]);
      // window applied to the aggregate where.createdAt, and the where is
      // branch-fenced across groupBy + aggregate + recentLogs.
      const aggArg = (prisma.wasteLog.aggregate as any).mock.calls[0][0];
      expect(aggArg.where.createdAt.gte).toEqual(new Date("2024-01-01"));
      expect(aggArg.where.tenantId).toBe(TENANT);
      expect(aggArg.where.branchId).toBe(BRANCH);
      const grpArg = (prisma.wasteLog.groupBy as any).mock.calls[0][0];
      expect(grpArg.where.branchId).toBe(BRANCH);
      const recentArg = (prisma.wasteLog.findMany as any).mock.calls[0][0];
      expect(recentArg.where.branchId).toBe(BRANCH);
    });

    it("passes through a non-null totalCost unchanged", async () => {
      (prisma.wasteLog.groupBy as any).mockResolvedValue([]);
      (prisma.wasteLog.aggregate as any).mockResolvedValue({
        _sum: { cost: 42.5 },
        _count: 3,
      });
      (prisma.wasteLog.findMany as any).mockResolvedValue([]);

      const res = await svc.getSummary(SCOPE);
      expect(res.totalCost).toBe(42.5);
    });
  });
});
