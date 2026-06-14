import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Lost-update protection on updateStock. The previous read → compute →
 * write pattern lost concurrent decrement deltas; the atomic increment
 * + conditional gate fixes that. These specs pin the new contract.
 */
describe('ProductsService.updateStock', () => {
  let prisma: MockPrismaClient;
  let svc: ProductsService;

  // Minimal product shape the service uses; findOne wraps findFirst.
  const baseProduct = {
    id: 'p-1',
    tenantId: 't-1',
    name: 'Tea',
    stockTracked: true,
    currentStock: 10,
    isAvailable: true,
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    // The service's findOne goes through prisma.product.findFirst.
    prisma.product.findFirst.mockResolvedValue(baseProduct);
    // updateStock now runs its writes inside $transaction; drive the mock
    // so the callback executes against the same deep-mocked client (tx).
    (prisma.$transaction as any).mockImplementation((cb: any) => cb(prisma));
    svc = new ProductsService(prisma as any);
  });

  it('uses atomic increment with no gate when quantity is positive', async () => {
    prisma.product.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.product.findUniqueOrThrow.mockResolvedValue({ currentStock: 15 } as any);

    await svc.updateStock('p-1', 5, 't-1');

    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-1', tenantId: 't-1' },
      data: { currentStock: { increment: 5 } },
    });
  });

  it('adds a gte gate when quantity is negative so racing decrements cannot both win', async () => {
    prisma.product.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.product.findUniqueOrThrow.mockResolvedValue({ currentStock: 7 } as any);

    await svc.updateStock('p-1', -3, 't-1');

    // -quantity = 3, so the WHERE requires currentStock >= 3 atomically.
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-1', tenantId: 't-1', currentStock: { gte: 3 } },
      data: { currentStock: { increment: -3 } },
    });
  });

  it('throws InsufficientStock when the gate misses but the row exists', async () => {
    // First updateMany (the atomic claim) returns 0 — the gte gate failed.
    prisma.product.updateMany.mockResolvedValueOnce({ count: 0 } as any);
    // Disambiguation lookup confirms the row exists.
    prisma.product.findFirst.mockResolvedValueOnce(baseProduct);
    prisma.product.findFirst.mockResolvedValueOnce({ id: 'p-1' } as any);

    await expect(svc.updateStock('p-1', -50, 't-1')).rejects.toThrow(BadRequestException);
  });

  it('throws NotFound when the row was deleted under us', async () => {
    prisma.product.updateMany.mockResolvedValueOnce({ count: 0 } as any);
    // First findFirst was the initial findOne which succeeded; second
    // findFirst is the disambiguation and returns null (row gone).
    prisma.product.findFirst.mockResolvedValueOnce(baseProduct);
    prisma.product.findFirst.mockResolvedValueOnce(null);

    await expect(svc.updateStock('p-1', 5, 't-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects when stock tracking is disabled on the product', async () => {
    prisma.product.findFirst.mockResolvedValue({ ...baseProduct, stockTracked: false });
    await expect(svc.updateStock('p-1', 5, 't-1')).rejects.toThrow(BadRequestException);
  });

  it('runs the stock change and isAvailable sync inside one transaction (race-free)', async () => {
    // The decrement + the isAvailable re-derive must be one atomic, row-locked
    // unit. Otherwise a concurrent A.decrement→0 (computes false) interleaving
    // with B.increment→1 (computes true) can let A's stale `false` win the
    // last write, leaving currentStock>0 marked unavailable.
    prisma.product.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.product.findUniqueOrThrow.mockResolvedValue({ currentStock: 0 } as any);

    await svc.updateStock('p-1', -10, 't-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // isAvailable derived from the post-update re-read (0 → false), written
    // within the same transaction as the decrement.
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-1', tenantId: 't-1' },
      data: { isAvailable: false },
    });
  });
});

/**
 * Wave-C ADDITIVE pagination on findAll. Contract:
 *   - no pagination passed => take/skip undefined => Prisma returns the full
 *     list (byte-identical to the pre-pagination behaviour);
 *   - a valid limit/offset is forwarded as take/skip and slices the result;
 *   - junk params (NaN limit / negative offset) fall back to undefined so the
 *     query can't 500 and the caller still gets a (full) list.
 * The response shape stays a bare array (transformed), never an envelope.
 */
describe('ProductsService.findAll — pagination', () => {
  let prisma: MockPrismaClient;
  let svc: ProductsService;

  // A small deterministic dataset already in displayOrder/name order.
  const rows = [
    { id: 'a', tenantId: 't-1', name: 'A', productImages: [], modifierGroups: [] },
    { id: 'b', tenantId: 't-1', name: 'B', productImages: [], modifierGroups: [] },
    { id: 'c', tenantId: 't-1', name: 'C', productImages: [], modifierGroups: [] },
  ] as any[];

  beforeEach(() => {
    prisma = mockPrismaClient();
    // Honour take/skip so the slicing assertion exercises real behaviour the
    // way Prisma would (orderBy is deterministic at the DB layer).
    prisma.product.findMany.mockImplementation((args: any) => {
      const skip = args?.skip ?? 0;
      const end = args?.take == null ? undefined : skip + args.take;
      return Promise.resolve(rows.slice(skip, end)) as any;
    });
    svc = new ProductsService(prisma as any);
  });

  it('returns the full list with undefined take/skip when no pagination passed (old behavior)', async () => {
    const result = await svc.findAll('t-1');

    const call = prisma.product.findMany.mock.calls[0][0] as any;
    expect(call.take).toBeUndefined();
    expect(call.skip).toBeUndefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.map((p: any) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('forwards limit/offset as take/skip and slices correctly', async () => {
    const result = await svc.findAll('t-1', undefined, { limit: 1, offset: 1 });

    const call = prisma.product.findMany.mock.calls[0][0] as any;
    expect(call.take).toBe(1);
    expect(call.skip).toBe(1);
    expect(result.map((p: any) => p.id)).toEqual(['b']);
  });

  it('falls back to the full list (no 500) when params are junk', async () => {
    const result = await svc.findAll('t-1', undefined, {
      limit: NaN,
      offset: -10,
    } as any);

    const call = prisma.product.findMany.mock.calls[0][0] as any;
    expect(call.take).toBeUndefined();
    expect(call.skip).toBeUndefined();
    expect(result.map((p: any) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('still applies the categoryId filter alongside pagination', async () => {
    await svc.findAll('t-1', 'cat-9', { limit: 2 });

    const call = prisma.product.findMany.mock.calls[0][0] as any;
    expect(call.where).toEqual({ tenantId: 't-1', categoryId: 'cat-9' });
    expect(call.take).toBe(2);
  });
});
