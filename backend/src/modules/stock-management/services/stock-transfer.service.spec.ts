import { BadRequestException, ConflictException } from '@nestjs/common';
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
      stockItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
    expect(dstCall.data.currentStock.increment).toBe(5);
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
      stockItem: {
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 1 }) // source decrement OK
          .mockResolvedValueOnce({ count: 0 }), // dest increment matches nothing
      },
      ingredientMovement: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    await expect(svc.complete(SCOPE, 'tr1')).rejects.toThrow(/Destination stock item not found/);
    // no movement written when the transfer aborts
    expect(txMock.ingredientMovement.create).not.toHaveBeenCalled();
  });
});
