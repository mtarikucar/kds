import { BadRequestException } from "@nestjs/common";
import { PurchaseOrdersService } from "./purchase-orders.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { PurchaseOrderStatus } from "../../../common/constants/stock-management.enum";

/**
 * Iter-34 regression: the per-line poItem read in receive() MUST
 * happen on the txn client, not the bare prisma client. The earlier
 * code read poItem.quantityReceived from the outside-txn findOne
 * snapshot, so two concurrent partial receives both saw the same
 * `alreadyReceived=N`, both computed `N+their_qty`, and the second
 * UPDATE clobbered the first (lost update). Pin the query shape.
 */
describe("PurchaseOrdersService.receive (iter-34)", () => {
  let prisma: MockPrismaClient;
  let svc: PurchaseOrdersService;

  // v3 branch-scope: read/submit/receive/cancel take a BranchScope.
  // branchScope(scope) fences the PO read on (tenantId, branchId), so a
  // cross-branch PO id can never be received/cancelled (stock mutated).
  const SCOPE = {
    tenantId: "t1",
    branchId: "b1",
    userId: "user-1",
    role: "ADMIN",
  } as const;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new PurchaseOrdersService(prisma as any);
  });

  it("re-reads poItem on the txn client inside the transaction", async () => {
    // Outside-txn findOne (pre-flight status check)
    (prisma.purchaseOrder.findFirst as any).mockResolvedValue({
      id: "po-1",
      tenantId: "t1",
      status: PurchaseOrderStatus.SUBMITTED,
      orderNumber: "PO-00001",
      items: [
        {
          id: "poi-1",
          stockItemId: "stock-1",
          stockItem: { name: "Flour" },
          quantityReceived: "0",
          quantityOrdered: "10",
          unitPrice: "5",
        },
      ],
    });

    const txMock: any = {
      purchaseOrderItem: {
        // In-txn re-read — load-bearing for the lost-update fix.
        findFirst: jest.fn().mockResolvedValue({
          id: "poi-1",
          stockItemId: "stock-1",
          stockItem: { name: "Flour" },
          quantityReceived: "0",
          quantityOrdered: "10",
          unitPrice: "5",
        }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { quantityReceived: "5", quantityOrdered: "10" },
          ]),
      },
      stockItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: "stock-1",
          currentStock: "0",
          costPerUnit: "0",
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      stockBatch: { create: jest.fn().mockResolvedValue({}) },
      ingredientMovement: { create: jest.fn().mockResolvedValue({}) },
      purchaseOrder: { update: jest.fn().mockResolvedValue({}) },
    };
    (prisma.$transaction as any).mockImplementation(
      async (cb: any, _opts: any) => cb(txMock),
    );

    await svc.receive(
      "po-1",
      { items: [{ purchaseOrderItemId: "poi-1", quantityReceived: 5 }] } as any,
      SCOPE,
      "user-1",
    );

    // Load-bearing assertion: the second findFirst (per-line) lands on
    // the txn client. If a future refactor moves this back to bare
    // prisma, the txMock call count stays 0 and this test fails.
    expect(txMock.purchaseOrderItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "poi-1",
          purchaseOrderId: "po-1",
        }),
      }),
    );

    // The PO pre-flight read is branch-fenced — findOne builds its where
    // from branchScope(scope), so receive can only mutate stock for a PO
    // that belongs to the caller's (tenantId, branchId).
    expect(prisma.purchaseOrder.findFirst.mock.calls[0][0].where).toEqual({
      id: "po-1",
      tenantId: "t1",
      branchId: "b1",
    });
    // Stock + movement writes carry the scope's branchId (not re-derived).
    expect(txMock.stockBatch.create.mock.calls[0][0].data.branchId).toBe("b1");
    expect(
      txMock.ingredientMovement.create.mock.calls[0][0].data.branchId,
    ).toBe("b1");
  });

  it("does NOT receive (mutate stock for) a cross-branch PO id", async () => {
    // findOne is branch-fenced; a PO that lives in another branch is not
    // visible, so findFirst returns null → NotFound before any txn.
    (prisma.purchaseOrder.findFirst as any).mockResolvedValue(null);
    const { NotFoundException } = require("@nestjs/common");

    await expect(
      svc.receive(
        "cross-branch-po",
        {
          items: [{ purchaseOrderItemId: "poi-1", quantityReceived: 5 }],
        } as any,
        SCOPE,
        "user-1",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    // No stock-mutating transaction may run for a cross-branch PO.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects over-receive based on the FRESHLY-READ alreadyReceived (not the stale snapshot)", async () => {
    // Outside-txn snapshot says quantityReceived=0 (the stale view).
    (prisma.purchaseOrder.findFirst as any).mockResolvedValue({
      id: "po-1",
      tenantId: "t1",
      status: PurchaseOrderStatus.SUBMITTED,
      orderNumber: "PO-00001",
      items: [
        {
          id: "poi-1",
          stockItemId: "stock-1",
          stockItem: { name: "Flour" },
          quantityReceived: "0",
          quantityOrdered: "10",
          unitPrice: "5",
        },
      ],
    });

    const txMock: any = {
      purchaseOrderItem: {
        // In-txn fresh read says we ALREADY received 8 (a concurrent
        // call landed). New attempt of 5 would push us to 13 > 10.
        findFirst: jest.fn().mockResolvedValue({
          id: "poi-1",
          stockItemId: "stock-1",
          stockItem: { name: "Flour" },
          quantityReceived: "8",
          quantityOrdered: "10",
          unitPrice: "5",
        }),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      stockItem: { findUnique: jest.fn(), update: jest.fn() },
      stockBatch: { create: jest.fn() },
      ingredientMovement: { create: jest.fn() },
      purchaseOrder: { update: jest.fn() },
    };
    (prisma.$transaction as any).mockImplementation(
      async (cb: any, _opts: any) => cb(txMock),
    );

    await expect(
      svc.receive(
        "po-1",
        {
          items: [{ purchaseOrderItemId: "poi-1", quantityReceived: 5 }],
        } as any,
        SCOPE,
      ),
    ).rejects.toThrow(BadRequestException);

    // Critical: NO stock write happened — the guard fired before any
    // mutation, so the over-receive race is properly closed.
    expect(txMock.stockItem.update).not.toHaveBeenCalled();
    expect(txMock.stockBatch.create).not.toHaveBeenCalled();
  });
});

/**
 * deep-review M18 regression: cancel() must run under Serializable, re-read
 * the PO/items/batches INSIDE the txn, and reverse only the un-consumed
 * batch remainder — NOT the gross quantityReceived from the outside-txn
 * findOne snapshot. The prior code zeroed all batches and decremented by the
 * gross received qty, double-counting any stock FIFO had already consumed
 * (and missing receives that committed after findOne).
 */
describe("PurchaseOrdersService.cancel (deep-review M18)", () => {
  let prisma: MockPrismaClient;
  let svc: PurchaseOrdersService;

  const SCOPE = {
    tenantId: "t1",
    branchId: "b1",
    userId: "user-1",
    role: "ADMIN",
  } as const;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new PurchaseOrdersService(prisma as any);
  });

  it("reverses only the un-consumed batch remainder, not the gross received qty", async () => {
    // Pre-flight findOne snapshot: 5 received.
    (prisma.purchaseOrder.findFirst as any).mockResolvedValue({
      id: "po-1",
      tenantId: "t1",
      branchId: "b1",
      status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
      orderNumber: "PO-00001",
      items: [
        {
          id: "poi-1",
          stockItemId: "stock-1",
          quantityReceived: "5",
          unitPrice: "5",
        },
      ],
    });

    const txMock: any = {
      // In-txn re-claim — load-bearing for the M18 fix.
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: "po-1",
          status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
          orderNumber: "PO-00001",
          items: [
            {
              id: "poi-1",
              stockItemId: "stock-1",
              quantityReceived: "5",
              unitPrice: "5",
            },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      // FIFO already consumed 2 of the 5 → only 3 remain on hand.
      stockBatch: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "batch-1", quantity: "3" }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      stockItem: { update: jest.fn().mockResolvedValue({}) },
      ingredientMovement: { create: jest.fn().mockResolvedValue({}) },
      purchaseOrderItem: { update: jest.fn().mockResolvedValue({}) },
    };
    (prisma.$transaction as any).mockImplementation(
      async (cb: any, _opts: any) => cb(txMock),
    );

    await svc.cancel("po-1", SCOPE, "user-1");

    // The PO is re-claimed inside the txn (not trusting the outer snapshot).
    expect(txMock.purchaseOrder.findFirst).toHaveBeenCalledTimes(1);

    // Stock is decremented by the REMAINING 3, never the gross 5.
    expect(
      txMock.stockItem.update.mock.calls[0][0].data.currentStock.decrement.toString(),
    ).toBe("3");

    // The reversal movement records the actual reversed qty (-3).
    expect(
      txMock.ingredientMovement.create.mock.calls[0][0].data.quantity.toString(),
    ).toBe("-3");

    // Serializable isolation is requested (write-vs-write race → 40001).
    const opts = (prisma.$transaction as any).mock.calls[0][1];
    expect(opts.isolationLevel).toBe("Serializable");
  });

  it("skips stock reversal entirely when no batch quantity remains", async () => {
    (prisma.purchaseOrder.findFirst as any).mockResolvedValue({
      id: "po-1",
      tenantId: "t1",
      branchId: "b1",
      status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
      orderNumber: "PO-00001",
      items: [
        {
          id: "poi-1",
          stockItemId: "stock-1",
          quantityReceived: "5",
          unitPrice: "5",
        },
      ],
    });

    const txMock: any = {
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: "po-1",
          status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
          orderNumber: "PO-00001",
          items: [
            {
              id: "poi-1",
              stockItemId: "stock-1",
              quantityReceived: "5",
              unitPrice: "5",
            },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      // Fully consumed by FIFO — nothing left to reverse.
      stockBatch: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "batch-1", quantity: "0" }]),
        updateMany: jest.fn(),
      },
      stockItem: { update: jest.fn() },
      ingredientMovement: { create: jest.fn() },
      purchaseOrderItem: { update: jest.fn().mockResolvedValue({}) },
    };
    (prisma.$transaction as any).mockImplementation(
      async (cb: any, _opts: any) => cb(txMock),
    );

    await svc.cancel("po-1", SCOPE, "user-1");

    // No phantom decrement / movement when remaining is zero.
    expect(txMock.stockItem.update).not.toHaveBeenCalled();
    expect(txMock.ingredientMovement.create).not.toHaveBeenCalled();
    // quantityReceived is still cleared so the PO can't be re-cancelled into stock.
    expect(txMock.purchaseOrderItem.update).toHaveBeenCalled();
  });
});

/**
 * Purchase-unit (UOM) conversion on receive. When a PO line carries a
 * conversionFactor, quantities/price are in the purchase unit (BOX) and receive
 * converts to the base stock unit: base qty = qty × factor, base cost =
 * unitPrice ÷ factor. Total receipt cost is invariant. Lines without a factor
 * are unaffected.
 */
describe('PurchaseOrdersService.receive — purchase-unit (UOM) conversion', () => {
  let prisma: any;
  let svc: PurchaseOrdersService;
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;

  beforeEach(() => {
    prisma = {
      purchaseOrder: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    svc = new PurchaseOrdersService(prisma as any);
  });

  it('converts a BOX-of-12 line to base PCS on receive (qty×12, cost÷12)', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1', tenantId: 't1', status: PurchaseOrderStatus.SUBMITTED, orderNumber: 'PO-1',
      items: [{ id: 'poi-1', stockItemId: 'stock-1', stockItem: { name: 'Cola' }, quantityReceived: '0', quantityOrdered: '5', unitPrice: '60', conversionFactor: '12' }],
    });
    const txMock: any = {
      purchaseOrderItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'poi-1', stockItemId: 'stock-1', stockItem: { name: 'Cola' },
          quantityReceived: '0', quantityOrdered: '5', unitPrice: '60', conversionFactor: '12',
        }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ quantityReceived: '2', quantityOrdered: '5' }]),
      },
      stockItem: {
        findUnique: jest.fn().mockResolvedValue({ id: 'stock-1', currentStock: '0', costPerUnit: '0' }),
        update: jest.fn().mockResolvedValue({}),
      },
      stockBatch: { create: jest.fn().mockResolvedValue({}) },
      ingredientMovement: { create: jest.fn().mockResolvedValue({}) },
      purchaseOrder: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));

    await svc.receive('po-1', { items: [{ purchaseOrderItemId: 'poi-1', quantityReceived: 2 }] } as any, SCOPE, 'u1');

    // Base stock += 2 boxes × 12 = 24 PCS.
    expect(txMock.stockItem.update.mock.calls[0][0].data.currentStock.increment.toString()).toBe('24');
    // Batch + movement are in base units at the per-base-unit cost (60 ÷ 12 = 5).
    expect(txMock.stockBatch.create.mock.calls[0][0].data.quantity.toString()).toBe('24');
    expect(txMock.stockBatch.create.mock.calls[0][0].data.costPerUnit.toString()).toBe('5');
    expect(txMock.ingredientMovement.create.mock.calls[0][0].data.quantity.toString()).toBe('24');
    expect(txMock.ingredientMovement.create.mock.calls[0][0].data.costPerUnit.toString()).toBe('5');
    // The PO line's received qty stays in purchase units (2 BOX, not 24).
    expect(txMock.purchaseOrderItem.update.mock.calls[0][0].data.quantityReceived.toString()).toBe('2');
  });
});

describe('PurchaseOrdersService — approval gate (submit + approve)', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: PurchaseOrdersService;
  const draftPo = { id: 'po1', status: 'DRAFT', items: [{ quantityOrdered: 10, unitPrice: 100 }] }; // total 1000

  beforeEach(() => {
    prisma = {
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue(draftPo),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'po1' }),
      },
      stockSettings: { findFirst: jest.fn() },
    };
    svc = new PurchaseOrdersService(prisma);
  });

  it('routes submit to PENDING_APPROVAL when total ≥ threshold', async () => {
    prisma.stockSettings.findFirst.mockResolvedValue({ poApprovalThreshold: 500 });
    await svc.submit('po1', SCOPE);
    expect(prisma.purchaseOrder.updateMany.mock.calls[0][0].data.status).toBe('PENDING_APPROVAL');
  });

  it('routes submit straight to SUBMITTED below threshold', async () => {
    prisma.stockSettings.findFirst.mockResolvedValue({ poApprovalThreshold: 5000 });
    await svc.submit('po1', SCOPE);
    expect(prisma.purchaseOrder.updateMany.mock.calls[0][0].data.status).toBe('SUBMITTED');
  });

  it('routes submit to SUBMITTED when no threshold is configured', async () => {
    prisma.stockSettings.findFirst.mockResolvedValue(null);
    await svc.submit('po1', SCOPE);
    expect(prisma.purchaseOrder.updateMany.mock.calls[0][0].data.status).toBe('SUBMITTED');
  });

  it('approve() moves PENDING_APPROVAL → SUBMITTED with approver audit', async () => {
    await svc.approve('po1', SCOPE, 'mgr1');
    const call = prisma.purchaseOrder.updateMany.mock.calls[0][0];
    expect(call.where.status).toBe('PENDING_APPROVAL');
    expect(call.data.status).toBe('SUBMITTED');
    expect(call.data.approvedById).toBe('mgr1');
  });

  it('approve() rejects a PO that is not awaiting approval', async () => {
    prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.approve('po1', SCOPE, 'mgr1')).rejects.toThrow();
  });
});
