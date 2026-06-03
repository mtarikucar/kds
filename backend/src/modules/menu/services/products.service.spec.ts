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
});
