import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { StockTransferService } from './stock-transfer.service';

describe('StockTransferService.complete', () => {
  const SCOPE = { tenantId: 't1', branchId: 'bA', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: StockTransferService;

  beforeEach(() => {
    prisma = { $transaction: jest.fn() };
    svc = new StockTransferService(prisma);
  });

  it('decrements source, increments dest and writes OUT/IN movements', async () => {
    const txMock: any = {
      stockTransfer: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tr1', transferNumber: 'TRF-00001', fromBranchId: 'bA', toBranchId: 'bB',
          items: [{ sourceStockItemId: 'sA', destStockItemId: 'sB', quantity: 5, unitCost: 2 }],
        }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'bB' }) },
      stockItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ id: 'sB', currentStock: 0, costPerUnit: 0 }),
      },
      stockBatch: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      ingredientMovement: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));

    await svc.complete(SCOPE, 'tr1');

    // source decremented at fromBranch, dest incremented at toBranch
    const srcCall = txMock.stockItem.updateMany.mock.calls[0][0];
    expect(srcCall.where).toMatchObject({ id: 'sA', branchId: 'bA' });
    expect(srcCall.data.currentStock.decrement).toBe(5);
    const dstCall = txMock.stockItem.updateMany.mock.calls[1][0];
    expect(dstCall.where).toMatchObject({ id: 'sB', branchId: 'bB' });
    expect(dstCall.data.currentStock.increment.toString()).toBe('5');
    // dest cost basis carried (unitCost 2 → costPerUnit set + a batch created)
    expect(txMock.stockBatch.create).toHaveBeenCalled();
    // two movements: OUT (source) then IN (dest)
    const [out, inn] = txMock.ingredientMovement.create.mock.calls.map((c: any) => c[0].data);
    expect(out.type).toBe('TRANSFER_OUT');
    expect(out.branchId).toBe('bA');
    expect(out.quantity.toString()).toBe('-5');
    expect(inn.type).toBe('TRANSFER_IN');
    expect(inn.branchId).toBe('bB');
  });

  it('aborts when the source has insufficient stock', async () => {
    const txMock: any = {
      stockTransfer: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tr1', transferNumber: 'TRF-1', fromBranchId: 'bA', toBranchId: 'bB',
          items: [{ sourceStockItemId: 'sA', destStockItemId: 'sB', quantity: 5, unitCost: 2 }],
        }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'bB' }) },
      stockItem: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, // gte guard fails
      ingredientMovement: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));

    await expect(svc.complete(SCOPE, 'tr1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects completing a non-pending transfer', async () => {
    const txMock: any = {
      stockTransfer: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    await expect(svc.complete(SCOPE, 'tr1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('StockTransferService.complete — destination guard (no silent stock loss)', () => {
  const SCOPE = { tenantId: 't1', branchId: 'bA', userId: 'u1', role: 'ADMIN' } as const;
  it('aborts if the destination item is not in the destination branch', async () => {
    const prisma: any = { $transaction: jest.fn() };
    const svc = new StockTransferService(prisma);
    const txMock: any = {
      stockTransfer: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tr1', transferNumber: 'TRF-1', fromBranchId: 'bA', toBranchId: 'bB',
          items: [{ sourceStockItemId: 'sA', destStockItemId: 'sB', quantity: 5, unitCost: 2 }],
        }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'bB' }) },
      stockItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), // source decrement OK
        findFirst: jest.fn().mockResolvedValue(null), // dest item not in the branch
      },
      stockBatch: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      ingredientMovement: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    await expect(svc.complete(SCOPE, 'tr1')).rejects.toThrow(/Destination stock item not found/);
    // no movement written when the transfer aborts
    expect(txMock.ingredientMovement.create).not.toHaveBeenCalled();
  });
});

describe('StockTransferService — party-branch authorization', () => {
  it('complete claim is scoped to a party branch (source or dest)', async () => {
    const prisma: any = { $transaction: jest.fn() };
    const svc = new StockTransferService(prisma);
    const txMock: any = {
      stockTransfer: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, // not party → claim 0
    };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    await expect(svc.complete({ tenantId: 't1', branchId: 'A', userId: 'u', role: 'MANAGER' } as any, 'tr1'))
      .rejects.toThrow(/not found or not pending/);
    const where = txMock.stockTransfer.updateMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ fromBranchId: 'A' }, { toBranchId: 'A' }]);
  });
});

describe('StockTransferService.create — destination authorization (pass-9)', () => {
  const SCOPE = { tenantId: 't1', branchId: 'bA', userId: 'u1', role: 'MANAGER' } as const;
  const dto = {
    toBranchId: 'bB',
    items: [{ sourceStockItemId: 'sA', destStockItemId: 'sB', quantity: 2 }],
  };

  function wire() {
    const prisma: any = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'bB' }) },
      stockItem: { count: jest.fn().mockResolvedValue(1) },
      stockTransfer: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'tr1', items: [] }),
      },
    };
    return { prisma, svc: new StockTransferService(prisma) };
  }

  it('requires the destination branch to be ACTIVE (archived branches are write-proof)', async () => {
    const { prisma, svc } = wire();
    await svc.create(SCOPE, 'u1', dto as any, []);
    const where = prisma.branch.findFirst.mock.calls[0][0].where;
    expect(where.status).toBe('active');
  });

  it('rejects a destination outside a narrowed allow-list', async () => {
    const { svc } = wire();
    await expect(
      svc.create(SCOPE, 'u1', dto as any, ['bA', 'bC']), // bB not allowed
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('wildcard (empty allow-list) may target any active tenant branch', async () => {
    const { prisma, svc } = wire();
    await svc.create(SCOPE, 'u1', dto as any, []);
    expect(prisma.stockTransfer.create).toHaveBeenCalled();
  });
});

describe('StockTransferService.complete — destination must be active (pass-9)', () => {
  it('aborts when the destination branch was archived after create', async () => {
    const prisma: any = { $transaction: jest.fn() };
    const svc = new StockTransferService(prisma);
    const txMock: any = {
      stockTransfer: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tr1', transferNumber: 'TRF-1', fromBranchId: 'bA', toBranchId: 'bB',
          items: [{ sourceStockItemId: 'sA', destStockItemId: 'sB', quantity: 5, unitCost: 2 }],
        }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue(null) }, // dest not active
      stockItem: { updateMany: jest.fn() },
      ingredientMovement: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    await expect(
      svc.complete({ tenantId: 't1', branchId: 'bA', userId: 'u1', role: 'ADMIN' } as any, 'tr1'),
    ).rejects.toThrow(/[Dd]estination branch is not active/);
    expect(txMock.stockItem.updateMany).not.toHaveBeenCalled();
  });
});
